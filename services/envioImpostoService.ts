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
    canal: 'email-app' | 'email-graph' | 'whatsapp';
    para?: string;
    pdfBase64?: string | null;
    pdfFileName?: string;
    valor?: number;
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
