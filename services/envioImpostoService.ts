/**
 * envioImpostoService.ts — ORDEM TÉCNICA do envio de imposto ao cliente
 * (Paulo, 24/07/2026). Todo imposto/guia/obrigação enviado pelo app segue:
 *
 *   1. Cópia do arquivo na pasta IMPOSTOS do cliente no SharePoint
 *      (Empresas/{grupo}/DEPARTAMENTO FISCAL/{ano}/{mês}-{ano}/{pasta}/IMPOSTOS);
 *   2. Cópia automática ao gestor (alexandre@) em TODO envio;
 *   3. Baixa da obrigação correspondente na aba Vencimentos e Obrigações
 *      (o reverso da pendência que o cron mensal cria — e que zera todo mês);
 *   4. Auditoria central (impostos_enviados).
 *
 * O backend executa 1/3/4 via POST /api/admin/envio-imposto/registrar; o
 * mailto daqui garante o 2 no fluxo "e-mail padrão do colaborador".
 */
import { getAuth } from 'firebase/auth';

export const GESTOR_EMAIL = 'alexandre@spassessoriacontabil.com.br';

export interface EnvioImpostoInput {
    empresaId?: string;
    empresaCnpj: string;
    empresaNome: string;
    /** 'DAS' | 'DARF' | 'DCTFWEB' | 'DARE' | 'FGTS' | 'SPED' | ... */
    tipo: string;
    /** 'AAAA-MM' ou 'MM/AAAA' */
    competencia: string;
    canal: 'email-app' | 'email-graph' | 'whatsapp' | 'fora-do-app';
    para?: string;
    pdfBase64?: string | null;
    pdfFileName?: string;
    valor?: number;
    /** Composição da guia — é o que barra o segundo envio do mesmo débito. */
    debitos?: Array<{ codigo: string; extensao?: string | null; descricao?: string | null; valor?: number | null; departamento?: string | null }>;
    /** Reenvio proposital: motivo escrito, gravado com quem seguiu. */
    reenvioMotivo?: string | null;
    /** 📋 Só no canal 'fora-do-app' — a declaração. O backend RECUSA sem ela. */
    meio?: string;
    comoFoi?: string;
    quando?: string;
}

/** Um meio de envio fora do app — a lista vem do BACKEND, nunca copiada. */
export interface MeioForaDoApp { id: string; label: string; }

/**
 * 📋 Os meios de envio fora do app.
 *
 * ⚠️ Ela é LIDA do backend de propósito: copiar a lista para cá criaria a
 * segunda cópia, e no dia em que um meio entrar a tela ofereceria um id que o
 * backend RECUSA — o erro chegaria como "escolha o meio" sobre um meio
 * escolhido.
 */
export async function meiosForaDoApp(): Promise<MeioForaDoApp[]> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    const token = await u.getIdToken();
    const res = await fetch('/api/admin/envio-imposto/meios-fora-do-app', {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data.meios || [];
}

/**
 * 📋 REGISTRA UM ENVIO QUE ACONTECEU FORA DO APP.
 *
 * Caso AC MASON (27/08): a guia já tinha ido ao cliente, a etapa 5 travava o
 * fim de mês, e reenviar pelo app DUPLICARIA a guia. O que o app não pode é
 * fingir que enviou: o canal é `fora-do-app`, `canalComprovaEnvio` devolve
 * **false** para ele, e a declaração (meio + texto + data + autor) fica gravada
 * na auditoria. O mês fecha; a ressalva fica.
 */
export async function registrarEnvioForaDoApp(
    input: Omit<EnvioImpostoInput, 'canal' | 'para' | 'pdfBase64'>
        & { meio: string; comoFoi: string; quando: string },
): Promise<RitoResultado & { declaracao?: { texto: string } | null }> {
    return registrarEnvioImposto({ ...input, canal: 'fora-do-app' });
}

export interface RitoResultado {
    ok: boolean;
    error?: string;
    gestor?: string;
    sharePoint?: { status: 'arquivado' | 'sem-config' | 'sem-pdf' | 'erro'; motivo?: string; folder?: string; filename?: string };
    baixa?: { status: 'baixada' | 'sem-tarefa' | 'erro'; motivo?: string; obrigacao?: string; competencia?: string; tarefas?: number };
    logId?: string | null;
}

/** Registra o envio no backend — executa SharePoint + baixa + auditoria. */
export async function registrarEnvioImposto(input: EnvioImpostoInput): Promise<RitoResultado> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    const token = await u.getIdToken();
    const res = await fetch('/api/admin/envio-imposto/registrar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}

/**
 * Monta o link mailto: do envio pelo e-mail PADRÃO do colaborador — com o
 * e-mail de cadastro do cliente no Para e o gestor SEMPRE em cópia (regra 2
 * da ordem técnica; espelho do montarMailtoEnvio do backend).
 * Obs.: mailto não anexa arquivo — o colaborador anexa o PDF baixado; a
 * cópia de arquivo da ordem técnica é garantida pelo SharePoint (regra 1).
 */
export function montarMailtoEnvio(p: { para: string; assunto?: string; corpo?: string; cc?: string[] }): string {
    const dest = String(p.para || '').trim();
    const listaCc = [...new Set([GESTOR_EMAIL, ...(p.cc || [])]
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e && e !== dest.toLowerCase()))];
    const qs = new URLSearchParams();
    if (listaCc.length) qs.set('cc', listaCc.join(','));
    if (p.assunto) qs.set('subject', p.assunto);
    if (p.corpo) qs.set('body', p.corpo);
    const query = qs.toString().replace(/\+/g, '%20');
    return `mailto:${encodeURIComponent(dest)}${query ? `?${query}` : ''}`;
}

export type ModoComposicao = 'outlook-web' | 'app-instalado';

/**
 * Link de composição do OUTLOOK WEB.
 *
 * POR QUE EXISTE (equipe, 05/08): *"clico nessa aba e nada acontece, não vai
 * nem pra rascunhos"*. O `mailto:` depende de um programa de e-mail INSTALADO
 * e registrado no sistema como handler do protocolo. Quem usa só o Outlook no
 * navegador — 90% do escritório, pela licença — não tem esse handler: o clique
 * não faz nada, silenciosamente, e o app ainda dizia "e-mail aberto".
 *
 * O deep link do Outlook Web abre a composição numa aba, já preenchida.
 */
export function montarLinkOutlookWeb(p: { para: string; assunto?: string; corpo?: string; cc?: string[] }): string {
    const dest = String(p.para || '').trim();
    const listaCc = [...new Set([GESTOR_EMAIL, ...(p.cc || [])]
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e && e !== dest.toLowerCase()))];
    const qs = new URLSearchParams();
    qs.set('to', dest);
    if (listaCc.length) qs.set('cc', listaCc.join(';'));
    if (p.assunto) qs.set('subject', p.assunto);
    if (p.corpo) qs.set('body', p.corpo);
    return `https://outlook.office.com/mail/deeplink/compose?${qs.toString()}`;
}

export interface ComposicaoAberta {
    modo: ModoComposicao;
    /** false quando o navegador barrou a janela (pop-up bloqueado). */
    aberta: boolean;
    link: string;
}

/**
 * Abre a janela de composição no e-mail do colaborador.
 *
 * O retorno diz se a janela ABRIU — só o Outlook Web dá esse sinal (o
 * `window.open` devolve null quando o pop-up é barrado). No mailto não há
 * sinal nenhum: o navegador não conta se existe handler, e é por isso que a
 * mensagem da tela não pode afirmar que o e-mail abriu.
 */
export function abrirComposicaoEmail(
    p: { para: string; assunto?: string; corpo?: string; cc?: string[] },
    modo: ModoComposicao = 'outlook-web',
): ComposicaoAberta {
    if (modo === 'app-instalado') {
        const link = montarMailtoEnvio(p);
        window.open(link, '_self');
        return { modo, aberta: true, link };
    }
    const link = montarLinkOutlookWeb(p);
    const janela = window.open(link, '_blank', 'noopener');
    return { modo, aberta: !!janela, link };
}

/**
 * Fluxo completo do envio pelo e-mail do colaborador: abre a composição
 * (cliente no Para, gestor em cópia) E registra o envio no backend
 * (SharePoint + baixa + auditoria). Retorna o resultado do rito pra UI mostrar
 * o farol honesto — inclusive se a janela de composição abriu.
 *
 * ATENÇÃO ao que este canal significa: o app abre a composição; quem clica em
 * "Enviar" é a pessoa, fora do app. Por isso a auditoria marca `email-app`,
 * que NÃO é prova de que a mensagem saiu (ver canalComprovaEnvio no painel).
 * Quando existe trilho pelo servidor (o "Enviar email" do DAS, via Graph), ele
 * é o caminho com prova — e o único que anexa o PDF sozinho.
 */
export async function enviarPorEmailDoColaborador(
    input: Omit<EnvioImpostoInput, 'canal'> & { assunto?: string; corpo?: string; modo?: ModoComposicao },
): Promise<RitoResultado & { composicao?: ComposicaoAberta }> {
    if (!input.para || !input.para.includes('@')) {
        return { ok: false, error: 'E-mail do cliente ausente — preencha o e-mail no cadastro da empresa (dados fiscais).' };
    }
    const composicao = abrirComposicaoEmail(
        { para: input.para, assunto: input.assunto, corpo: input.corpo },
        input.modo || 'outlook-web',
    );
    const { assunto: _a, corpo: _c, modo: _m, ...resto } = input;
    const rito = await registrarEnvioImposto({ ...resto, canal: 'email-app' });
    return { ...rito, composicao };
}

/**
 * Frase honesta pro toast depois de abrir a composição. Nunca afirma que o
 * e-mail foi enviado — porque o app não viu isso acontecer.
 */
export function mensagemComposicao(c: ComposicaoAberta | undefined): string {
    if (!c) return '';
    if (c.modo === 'app-instalado') {
        return `Pedimos ao seu computador para abrir o programa de e-mail com ${GESTOR_EMAIL} em cópia.`
            + ' Se nada abriu, você usa o Outlook no navegador — clique em "Abrir no Outlook Web".';
    }
    if (!c.aberta) {
        return 'O navegador BLOQUEOU a janela do Outlook Web. Libere o pop-up deste site e clique de novo.';
    }
    return `Composição aberta no Outlook Web com ${GESTOR_EMAIL} em cópia. O e-mail só sai quando VOCÊ clicar em Enviar.`;
}


// ── Painel do rito (#293) ───────────────────────────────────────────────────

export interface PainelEnvios {
    ok: boolean;
    competencia?: string | null;
    total?: number;
    completos?: number;
    incompletos?: number;
    /** Envios sem registro das etapas do rito — não são completos nem pendência. */
    naoConferidos?: string[];
    porTipo?: Record<string, number>;
    pendencias?: Record<string, { qtd: number; acao: string; empresas: string[] }>;
    semGestorEmCopia?: string[];
    valorTotal?: number;
    farol?: 'ok' | 'atencao' | 'vazio';
    resumo?: string;
    gestor?: string;
    error?: string;
}

/**
 * Agregado dos envios de imposto da competência: quantos saíram COMPLETOS
 * (cópia no SharePoint + baixa da obrigação) e, quando não, a causa agrupada
 * com a ação. Envio pela metade não é sucesso.
 */
export async function painelEnviosImposto(competencia?: string): Promise<PainelEnvios> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada' };
    const token = await u.getIdToken();
    const q = competencia ? `?competencia=${encodeURIComponent(competencia)}` : '';
    const res = await fetch(`/api/admin/envio-imposto/painel${q}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ...data, ok: true };
}

// ─── Envio PELO SERVIDOR (Graph) ────────────────────────────────────────────

export interface EnvioGraphResultado extends RitoResultado {
    para?: string;
    /** Caixa que apareceu como remetente pro cliente. */
    remetente?: string;
    fonteRemetente?: 'colaborador' | 'padrao';
    avisoRemetente?: string | null;
    copiaPara?: string[];
    anexouPdf?: boolean;
}

/**
 * Envia a guia PELO SERVIDOR, com o PDF anexado e o gestor em cópia oculta.
 *
 * Diferença que importa (equipe, 05/08): aqui o app ENVIA — o Graph aceita a
 * mensagem e a cópia fica em Itens Enviados da caixa do colaborador. Isso é
 * prova. O mailto/Outlook Web só abre a composição.
 *
 * O remetente é a caixa de QUEM CLICOU (Paulo, 05/08) — a resposta do cliente
 * volta pra pessoa da carteira, não pro dono do escritório.
 */
export async function enviarGuiaPeloServidor(input: {
    empresaId?: string;
    empresaCnpj: string;
    empresaNome: string;
    tipo: string;
    competencia: string;
    para: string;
    assunto?: string;
    mensagem: string;
    pdfBase64?: string;
    pdfFileName?: string;
    /**
     * Guias ADICIONAIS da MESMA cobrança. O Integra Contador emite 1 DARF por
     * CÓDIGO, então um vencimento pode ter 2-3 arquivos — e eles vão na MESMA
     * mensagem: um e-mail por código encheria a caixa do cliente pela mesma
     * cobrança, e ele não saberia se são guias diferentes ou repetidas.
     */
    pdfs?: Array<{ nome: string; base64: string }>;
    valor?: number;
    vencimento?: string | null;
    /**
     * A COMPOSIÇÃO da guia — é o que permite barrar o SEGUNDO envio do mesmo
     * débito (Paulo, 17/08). Sem ela a auditoria sabe que "um DARF saiu" e não
     * sabe O QUE ele cobrava, e dois departamentos cobram o mesmo código.
     */
    debitos?: Array<{ codigo: string; extensao?: string | null; descricao?: string | null; valor?: number | null; departamento?: string | null }>;
    /** Reenvio proposital: o motivo fica gravado com quem seguiu. */
    reenvioMotivo?: string | null;
}): Promise<EnvioGraphResultado> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada' };
    const token = await u.getIdToken();
    const res = await fetch('/api/admin/envio-imposto/enviar-graph', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}

// ─── Envio PELO SERVIDOR (WhatsApp oficial — Cloud API) ─────────────────────

export interface EnvioWhatsappResultado extends RitoResultado {
    whatsappMessageId?: string;
    numeroEnviado?: string;
    gestorNotificado?: boolean;
    acao?: string;
    indeterminado?: boolean;
}

/** O canal está pronto? Se não, `faltas` diz o quê — o botão explica. */
export async function statusCanalWhatsapp(): Promise<{ ok: boolean; pronto: boolean; faltas: string[] }> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, pronto: false, faltas: ['sessão expirada'] };
    const token = await u.getIdToken();
    const res = await fetch('/api/admin/envio-imposto/whatsapp-status', {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, pronto: false, faltas: [data.error || `HTTP ${res.status}`] };
    return { ok: true, pronto: Boolean(data.pronto), faltas: data.faltas || [] };
}

/**
 * Envia a guia pelo WHATSAPP OFICIAL (Cloud API da Meta, WABA da S&P) — o
 * servidor envia e a Meta devolve o id da mensagem: PROVA de envio, mesma
 * classe do e-mail Graph. Roda o MESMO rito #293 (SharePoint com canal
 * whatsapp-api + baixa da obrigação + auditoria) e notifica o gestor por
 * e-mail. ≠ do botão wa.me, que só abre a composição.
 */
export async function enviarGuiaPorWhatsapp(input: {
    empresaId?: string;
    empresaCnpj: string;
    empresaNome: string;
    tipo: string;
    competencia: string;
    paraWhatsapp: string;
    pdfBase64?: string;
    pdfFileName?: string;
    valor?: number;
    vencimento?: string | null;
    /**
     * A COMPOSIÇÃO da guia — é o que permite barrar o SEGUNDO envio do mesmo
     * débito (Paulo, 17/08). Sem ela a auditoria sabe que "um DARF saiu" e não
     * sabe O QUE ele cobrava, e dois departamentos cobram o mesmo código.
     */
    debitos?: Array<{ codigo: string; extensao?: string | null; descricao?: string | null; valor?: number | null; departamento?: string | null }>;
    /** Reenvio proposital: o motivo fica gravado com quem seguiu. */
    reenvioMotivo?: string | null;
}): Promise<EnvioWhatsappResultado> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada' };
    const token = await u.getIdToken();
    const res = await fetch('/api/admin/envio-imposto/enviar-whatsapp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const acao = data.acao ? ` ${data.acao}` : '';
        return { ok: false, error: `${data.error || `HTTP ${res.status}`}${acao}`, indeterminado: Boolean(data.indeterminado) };
    }
    return data;
}

/** Frase do toast do WhatsApp — afirma só o que a Meta confirmou. */
export function mensagemEnvioWhatsapp(r: EnvioWhatsappResultado): string {
    const partes = [`WhatsApp ENVIADO para ${r.numeroEnviado || 'o cliente'} (comprovante ${r.whatsappMessageId || '—'})`];
    if (r.sharePoint?.status === 'arquivado') partes.push('cópia no SharePoint');
    if (r.baixa?.status === 'baixada') partes.push(`baixa de ${r.baixa.tarefas} obrigação(ões)`);
    partes.push(r.gestorNotificado ? 'gestor avisado por e-mail' : '⚠ aviso ao gestor FALHOU — confira com ele');
    return `${partes.join(' · ')}.`;
}

/** Frase do toast depois do envio pelo servidor — afirma o que de fato houve. */
export function mensagemEnvioServidor(r: EnvioGraphResultado): string {
    const partes = [`E-mail ENVIADO para ${r.para || 'o cliente'}`];
    if (r.anexouPdf) partes.push('com a guia em anexo');
    if (r.remetente) partes.push(`pela caixa ${r.remetente}`);
    const base = `${partes.join(' ')}.`;
    const copia = r.copiaPara?.length ? ` Cópia oculta a ${r.copiaPara.join(', ')}.` : '';
    const aviso = r.avisoRemetente ? ` ⚠ ${r.avisoRemetente}.` : '';
    return `${base}${copia}${aviso} A cópia fica em Itens Enviados da caixa remetente.`;
}


/**
 * 🚨 ESTE DÉBITO JÁ FOI ENVIADO NESTA COMPETÊNCIA?
 *
 * PORTA FINA, não régua: quem CONFERE é `sefaz-backend/debito-ja-enviado.js`,
 * chamado pelo backend. O nome é diferente de propósito — `conferir*` aqui faria
 * a varredura da régua única ler isto como segunda cópia, e com razão: função
 * com o mesmo nome nos dois lados é o começo de duas respostas divergentes.
 *
 * Paulo, 17/08: *"pode fazer, barrar o segundo envio do mesmo débito"*. Quem
 * responde é o BACKEND, contra a auditoria `impostos_enviados` — a resposta não
 * pode sair do que esta tela lembra, porque o outro envio foi de outra pessoa,
 * possivelmente de outro departamento, em outra máquina.
 *
 * Falha de rede devolve `indeterminado`, NUNCA "não foi enviado": afirmar que
 * nunca saiu porque a consulta piscou é justamente o que dobra a cobrança.
 */
export async function perguntarDebitosJaEnviados(input: {
    cnpj: string;
    competencia: string;
    debitos: Array<{ codigo: string; extensao?: string | null; descricao?: string | null; valor?: number | null }>;
}): Promise<{
    ok: boolean;
    indeterminado?: boolean;
    error?: string;
    conferencia?: { bloqueia: boolean; incerto: boolean; temRepetidoComProva: boolean; repetidos: any[]; semComposicao: any[] };
    aviso?: { titulo: string; texto: string; acao: string; severidade: string } | null;
}> {
    try {
        const u = getAuth().currentUser;
        if (!u) return { ok: false, indeterminado: true, error: 'Sessão expirada' };
        const token = await u.getIdToken();
        const res = await fetch('/api/admin/envio-imposto/debitos-ja-enviados', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
            return { ok: false, indeterminado: true, error: data?.error || `HTTP ${res.status}` };
        }
        return data;
    } catch (e: any) {
        return { ok: false, indeterminado: true, error: e?.message || 'falha na consulta' };
    }
}
