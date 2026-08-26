// ============================================================================
// services/spConnectService.ts — I/O do SP Connect (inbox do WhatsApp)
// O backend é o dono do escopo (requireAuth + filas quando existirem);
// aqui é só a chamada, no padrão canônico do rotinaFiscalService.
// ============================================================================
import { getAuth } from 'firebase/auth';
import { ConfigAtendimento, ConversaResumo, FilaAtendimento, MensagemInbox } from './spConnect';

async function req<T>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' } as any;
    const token = await u.getIdToken();
    const res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    // 🚨 A RECUSA VIAJA INTEIRA (24/08). Antes só o `error` sobrevivia, e o
    // backend manda junto o que a pessoa precisa pra RESOLVER: `acao`
    // ("assuma a conversa antes"), `code` (o número da Meta), `emConducaoPor`,
    // `janelaFechada`. Quem chama lê esses campos — e eles chegavam
    // `undefined`, então a tela mostrava o problema sem o caminho. Foi assim
    // que o pedido de permissão de ligação parou por CONDUÇÃO e a tela não
    // disse "assuma a conversa": alarme sem ação é o que faz a pessoa
    // concluir que o app está quebrado.
    if (!res.ok) return { ...data, ok: false, error: data.error || `HTTP ${res.status}` } as any;
    return data;
}

export const listarConversas = () =>
    req<{
        conversas: ConversaResumo[]; filas: FilaAtendimento[]; minhasFilas: string[] | null;
        papel: 'admin' | 'gestor' | 'colaborador';
        /** Teto de leitura atingido (nº do teto) — a lista mostra as N mais recentes, não a carteira toda. */
        limiteLeitura?: number | null;
        /** ⚡ Frases do composer (config resolvida — vai de carona porque todo atendente já lê esta rota). */
        respostasRapidas?: string[];
    }>('/api/admin/whatsapp/conversas');

/**
 * Mensagens de uma conversa — as 500 mais recentes. `antesDe` (o timestamp da
 * mais antiga que já está na tela) traz as 500 ANTERIORES: cursor por VALOR,
 * então mensagem que chegar no meio do caminho não desloca a janela.
 */
export const listarMensagens = (numero: string, antesDe?: string | null) =>
    req<{
        mensagens: MensagemInbox[];
        /** Há chance de existir conversa mais antiga (página veio cheia). */
        temMais?: boolean;
        /** Timestamp da mais antiga desta fatia — é o cursor da próxima. */
        maisAntiga?: string | null;
        /** Índice ainda construindo: a fatia veio sem ordem e NÃO pagina. */
        semOrdem?: boolean;
    }>(`/api/admin/whatsapp/conversas/${encodeURIComponent(numero)}/mensagens${antesDe ? `?antesDe=${encodeURIComponent(antesDe)}` : ''}`);

/**
 * 🔎 Procura no BANCO INTEIRO — a outra metade do teto menor da lista.
 * Acha por NÚMERO (prefixo, completo) e por NOME (pedaço, sem acento/caixa).
 * NÃO procura no texto das mensagens — isso segue sendo só na conversa aberta.
 */
export const procurarConversas = (termo: string) =>
    req<{
        termo: string;
        conversas: ConversaResumo[];
        total: number;
        truncado: boolean;
        contatosVarridos: number;
        contatosTruncados: boolean;
    }>(`/api/admin/whatsapp/conversas/procurar?termo=${encodeURIComponent(termo)}`);

export const marcarLida = (numero: string) =>
    req<{}>(`/api/admin/whatsapp/conversas/${encodeURIComponent(numero)}/lida`, { method: 'POST' });

/**
 * Inicia conversa por TEMPLATE aprovado (regra da Meta pra fora da janela).
 * Template com documento é recusado pelo backend — guia sai pelas telas de guia.
 */
export const iniciarConversa = (p: {
    para: string; nomeContato?: string; departamento: string;
    template?: string; variaveis?: Record<string, string>;
    /** Template APROVADO direto da Meta (sem cadastro na ⚙️) + valores posicionais {{1}},{{2}}… */
    templateDireto?: { nome: string; idioma: string };
    variaveisPosicionais?: string[];
}) =>
    req<{ numero: string; messageId: string; opcoes?: string[]; faltando?: string[]; acao?: string }>(
        '/api/admin/whatsapp/conversas/iniciar',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });

/** Responde com texto livre (janela de 24h aberta E conversa não conduzida
 *  por OUTRO — o backend trava as duas; responder sem dono auto-assume). */
export const responderConversa = (numero: string, texto: string) =>
    req<{ mensagem: MensagemInbox; acao?: string; janelaFechada?: boolean; autoAssumida?: boolean; emConducaoPor?: string }>(
        `/api/admin/whatsapp/conversas/${encodeURIComponent(numero)}/responder`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texto }),
        });

// ─── 📎 Mídia: abrir a recebida e enviar anexo ──────────────────────────────

/**
 * Baixa o anexo COM o token (o backend valida a visibilidade da fila) e
 * devolve um object URL pra tela. `<img src>` não manda header, então o
 * caminho é fetch → blob — e é isso que permite exigir login pra abrir
 * anexo de cliente, em vez de link assinado que qualquer um repassa.
 */
export async function abrirMidia(numero: string, mensagemId: string): Promise<
    { ok: true; url: string; mime: string } | { ok: false; error: string; acao?: string }
> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' };
    const token = await u.getIdToken();
    const res = await fetch(
        `/api/admin/whatsapp/conversas/${encodeURIComponent(numero)}/midia/${encodeURIComponent(mensagemId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
        const data = await res.json().catch(() => ({} as any));
        return { ok: false, error: data.error || `HTTP ${res.status}`, acao: data.acao };
    }
    const blob = await res.blob();
    return { ok: true, url: URL.createObjectURL(blob), mime: blob.type };
}

/** Envia anexo (dentro da janela de 24h; o backend trava tamanho e tipo). */
export const enviarAnexo = (numero: string, p: { base64: string; nomeArquivo: string; mime: string; legenda?: string }) =>
    req<{ mensagem: MensagemInbox; legendaIgnorada?: boolean; copiaGuardada?: boolean; acao?: string; janelaFechada?: boolean; emConducaoPor?: string }>(
        `/api/admin/whatsapp/conversas/${encodeURIComponent(numero)}/anexo`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });

// ─── F3: config do atendimento + ações de conversa ──────────────────────────
// O escopo (quem vê o quê, quem grava) é do BACKEND; aqui é só a chamada.

const post = <T>(url: string, body?: unknown, metodo: 'POST' | 'PATCH' | 'DELETE' = 'POST') =>
    req<T>(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
    });

const urlConversa = (numero: string, acao: string) =>
    `/api/admin/whatsapp/conversas/${encodeURIComponent(numero)}/${acao}`;

// ☎️ `ligarParaCliente` FOI DELETADA em 25/08. A Meta recusa chamada por API em
// número no modo SIP (código 131055, provado em 24/08), então a porta só servia
// a uma ação de tela que já não existia — porta de fetch órfã é o convite para
// religar um botão que não disca. A rota do backend continua de pé com as
// travas dela; quando este número sair do modo SIP, a porta volta COM o botão.

/** ☎️ Pede ao cliente a permissão de ligação (cartão "Permitir" no WhatsApp). */
export const pedirPermissaoLigacao = (numero: string) =>
    post<{
        mensagem: MensagemInbox; acao?: string; janelaFechada?: boolean; emConducaoPor?: string;
        /** Código da Meta na recusa — é por ele que se acha a causa (a mensagem dela muda, o código não). */
        code?: number | null;
    }>(urlConversa(numero, 'pedir-permissao-ligacao'));

/** Config do atendimento (bot, horário, mensagens, menu) — leitura de qualquer logado. */
export const atendimentoConfig = () =>
    req<{ config: ConfigAtendimento; filas: FilaAtendimento[] }>('/api/admin/whatsapp/atendimento-config');

/** Gravação SÓ admin (o backend recusa o resto). */
export const salvarAtendimentoConfig = (config: ConfigAtendimento) =>
    post<{ config: ConfigAtendimento }>('/api/admin/whatsapp/atendimento-config', { config });

/**
 * Sobe a imagem enviada junto da confirmação de UMA fila (a arte do
 * departamento — Paulo, 20/08, olhando a Ultra Fox). Substitui a anterior
 * daquela fila; sem imagem cadastrada o bot segue mandando só o texto.
 */
export const subirImagemFila = (fila: string, base64: string, mime: string) =>
    post<{ config: ConfigAtendimento; url: string }>('/api/admin/whatsapp/atendimento-config/imagem-fila', { fila, base64, mime });

/** Tira a imagem de uma fila — volta a mandar só o texto de confirmação. */
export const removerImagemFila = (fila: string) =>
    post<{ config: ConfigAtendimento }>(`/api/admin/whatsapp/atendimento-config/imagem-fila/${encodeURIComponent(fila)}`, undefined, 'DELETE');

/** Transferir de fila: limpa o dono, grava nota automática (recado opcional)
 *  e — se a chave estiver ligada — avisa o cliente (só com janela aberta). */
export const transferirFila = (numero: string, fila: string, recado?: string) =>
    post<{ numero: string; fila: string; transferidaDe: string; avisoCliente: string; nota: MensagemInbox }>(
        urlConversa(numero, 'fila'), { fila, recado });

/** 🟢 Presença: o inbox aberto bate aqui. Marca a PRÓPRIA — sem destinatário. */
export const baterPresenca = () =>
    post<{ intervaloMs: number }>('/api/admin/whatsapp/presenca', {});

export interface PessoaNaFila {
    email: string; nome: string;
    situacao: 'no-ar' | 'sem-sinal' | 'sem-registro';
    texto: string; minutos: number | null;
}
export interface PresencaDaFila {
    fila: string; total: number; noAr: number;
    pessoas: PessoaNaFila[];
    /** Só existe quando há o que avisar — fila coberta não ganha alarme. */
    aviso: string | null;
}

/** 🟢 Quem da fila está no ar AGORA — a pergunta da hora de transferir. */
export const presencaDaFila = (fila: string) =>
    req<PresencaDaFila>(`/api/admin/whatsapp/presenca/fila/${encodeURIComponent(fila)}`);

/** Assumir a conversa (liberar=true devolve pra fila). */
export const assumirConversa = (numero: string, liberar = false) =>
    post<{ numero: string }>(urlConversa(numero, 'assumir'), { liberar });

/** Encerrar/reabrir: admin e gestor qualquer; colaborador só o que conduz.
 *  Encerrando com a pesquisa ligada, a resposta diz se o convite saiu. */
export const mudarSituacao = (numero: string, situacao: 'aberta' | 'resolvida') =>
    post<{ numero: string; situacao: string; avaliacao?: string }>(urlConversa(numero, 'situacao'), { situacao });

/** Nota interna: entra na thread mas NUNCA sai pro cliente. */
export const criarNota = (numero: string, texto: string) =>
    post<{ mensagem: MensagemInbox }>(urlConversa(numero, 'nota'), { texto });

/** Vincular contato ↔ cliente do cadastro (empresaId vazio DESVINCULA). */
export const vincularCliente = (numero: string, empresaId: string, empresaNome?: string) =>
    post<{}>(urlConversa(numero, 'vincular'), { empresaId, empresaNome });

/** Cliente 360 da conversa (pós-vínculo): empresa, responsáveis da carteira
 *  e últimas guias do rito #293 — nenhuma conta nova, só leitura. */
export interface ClienteDaConversa {
    vinculado: boolean;
    empresa?: { id: string; nome: string; cnpj: string | null; regime: string | null; excluida?: boolean; naoEncontrada?: boolean };
    responsaveis?: { nome: string; papel: string }[];
    guias?: { tipo: string | null; competencia: string | null; valor: number | null; canal: string | null; enviadoPor: string | null; enviadoEm: string | null }[];
    totalGuias?: number;
}

export const clienteDaConversa = (numero: string) =>
    req<ClienteDaConversa>(urlConversa(numero, 'cliente'));

export const buscarClientes = (q: string) =>
    req<{ clientes: { id: string; nome: string; cnpj: string; origem: string }[] }>(
        `/api/admin/whatsapp/clientes-busca?q=${encodeURIComponent(q)}`);

/** 🔗 Quem é o cliente dos números sem vínculo — MEDIÇÃO, não decisão.
 *  Os quatro desfechos vêm separados porque as ações são diferentes. */
export interface SugestoesDeVinculo {
    total: number;
    empresasNoCadastro: number;
    empresasComNumero: number;
    sugestoes: { numero: string; nome: string | null; empresaId: string; nomeEmpresa: string; campo: string }[];
    ambiguos: { numero: string; nome: string | null; candidatos: { empresaId: string; nomeEmpresa: string; campo: string }[] }[];
    semCadastro: { numero: string; nome: string | null }[];
    semNumeroLegivel: { numero: string; nome: string | null; canal: string | null }[];
}

export const sugestoesDeVinculo = () =>
    req<SugestoesDeVinculo>('/api/admin/whatsapp/vinculo-sugestoes');

// ─── 📞 Canais (2º número / 2ª WABA) ────────────────────────────────────────

export interface CanalWhatsapp {
    id: string; rotulo: string; numeroExibicao: string | null;
    phoneNumberId: string | null; wabaId: string | null; envToken: string | null;
    origem: 'env' | 'cadastro'; ativo?: boolean; pronto: boolean; faltas?: string[];
}

export const listarCanais = () =>
    req<{ canais: CanalWhatsapp[]; multiCanal: boolean; padraoId: string; conflitos: { id: string; motivo: string }[] }>(
        '/api/admin/whatsapp/canais');

/** Cadastra o 2º número. `envToken` é o NOME da variável do Cloud Run. */
export const salvarCanal = (p: {
    id: string; rotulo: string; phoneNumberId: string; envToken: string;
    numeroExibicao?: string; wabaId?: string; ativo?: boolean;
}) => post<{ id: string; canais: CanalWhatsapp[] }>('/api/admin/whatsapp/canais', p);

/**
 * 📱 Ativa o número na Cloud API (o `/register` que o painel da Meta manda
 * fazer). O PIN é a verificação em duas etapas DO NÚMERO — ele viaja na
 * chamada e não é guardado em lugar nenhum.
 */
/** 🔬 O que a META diz do número — leitura pura (status, verificação, plataforma). */
export const statusDoCanal = (id: string) =>
    req<{ numero: Record<string, unknown>; code?: number | null }>(
        `/api/admin/whatsapp/canais/${encodeURIComponent(id)}/status`);

export const registrarCanal = (id: string, pin: string) =>
    post<{ rotulo: string; acao?: string; code?: number | null }>(
        `/api/admin/whatsapp/canais/${encodeURIComponent(id)}/registrar`, { pin });

// ─── 📇 Contatos e 🏷 etiquetas ─────────────────────────────────────────────

export interface Etiqueta {
    id: string; rotulo: string; cor: string; ordem: number;
    finalidade: string; baseLegal: string; origem?: string;
}

export interface PendenciaLgpd {
    etiqueta: string; tipo: string; motivo: string; acao: string;
}

export interface Contato {
    numero: string;
    nomePerfil: string | null;
    empresaId: string | null;
    empresaNome: string | null;
    empresaNomeSugerido: string | null;
    etiquetas: string[];
    consentimentos: Record<string, { em?: string | null; como?: string | null; revogadoEm?: string | null }>;
    origem: string | null;
    criadoEm: string | null;
    observacao: string | null;
    pendenciasLgpd?: PendenciaLgpd[];
}

export const listarContatos = (p: { busca?: string; etiqueta?: string; semEtiqueta?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (p.busca) q.set('busca', p.busca);
    if (p.etiqueta) q.set('etiqueta', p.etiqueta);
    if (p.semEtiqueta) q.set('semEtiqueta', 'true');
    return req<{
        contatos: Contato[]; total: number; totalFiltrado: number; truncado: boolean;
        limiteLeitura: number | null; semEtiquetaTotal: number;
        porEtiqueta: Record<string, number>; etiquetas: Etiqueta[];
    }>(`/api/admin/whatsapp/contatos${q.toString() ? `?${q}` : ''}`);
};

export const criarContato = (p: { numero: string; nome?: string; etiquetas?: string[] }) =>
    post<{ numero: string; jaExiste?: boolean; acao?: string }>('/api/admin/whatsapp/contatos', p);

/** Excluir o CADASTRO do contato — o backend só aceita de gestor/admin. */
export const excluirContato = (numero: string) =>
    post<Record<string, never>>(`/api/admin/whatsapp/contatos/${numero}`, undefined, 'DELETE');

export const atualizarContato = (numero: string, p: {
    etiquetas?: string[]; nome?: string; observacao?: string;
    consentimento?: { etiqueta: string; como?: string; revogar?: boolean };
}) => post<{ pendenciasLgpd: PendenciaLgpd[] }>(`/api/admin/whatsapp/contatos/${numero}`, p, 'PATCH');

// ─── 🔒 Direitos do titular (LGPD art. 18) ──────────────────────────────────
// Selo sem mecanismo é afirmação enganosa: é isto que dá lastro à frase do
// rodapé. Ambas são admin — atender pedido de titular é ato do escritório.

export interface RelatorioTitular {
    numero: string; geradoEm: string | null; temCadastro: boolean;
    cadastro: { nome: string | null; empresaVinculada: string | null; origem: string | null; criadoEm: string | null; observacao: string | null } | null;
    etiquetas: { id: string; rotulo: string; finalidade: string; baseLegal: string | null }[];
    consentimentos: { etiqueta: string; registradoEm: string | null; como: string | null; revogadoEm: string | null }[];
    conversa: { fila: string | null; situacao: string | null; ultimaAtualizacao: string | null } | null;
    mensagens: { total: number; itens: { em: string | null; direcao: string | null; tipo: string | null; texto: string | null; temAnexo: boolean }[] };
    enviosDeGuia: { total: number; itens: unknown[] };
    guardaObrigatoria: { id: string; rotulo: string; motivo: string }[];
}

export interface PlanoEliminacao {
    numero: string;
    remove: { item: string; quantidade: number }[];
    mantem: { item: string; motivo: string }[];
    nadaARemover: boolean;
    aviso: string;
}

/** Acesso (art. 18, II) — o relatório de tudo o que o app guarda da pessoa. */
export const relatorioTitular = (numero: string) =>
    req<{ relatorio: RelatorioTitular }>(`/api/admin/whatsapp/lgpd/titular/${encodeURIComponent(numero)}`);

/** Eliminação (art. 18, VI). SEM `confirmar` devolve só o PLANO — nada some
 *  antes de a pessoa ver o que sai e o que fica. */
export const eliminarDadosTitular = (numero: string, p: { confirmar?: boolean; motivo?: string } = {}) =>
    post<{ plano: PlanoEliminacao; confirmado: boolean; removidas?: number; aviso?: string }>(
        `/api/admin/whatsapp/lgpd/titular/${encodeURIComponent(numero)}/eliminar`, p);

export const listarEtiquetas = () =>
    req<{ etiquetas: Etiqueta[]; basesLegais: Record<string, { rotulo: string; artigo: string; pedeConsentimento: boolean }>; cores: string[] }>(
        '/api/admin/whatsapp/etiquetas');

export const salvarEtiqueta = (p: { rotulo: string; finalidade: string; baseLegal: string; cor?: string; ordem?: number }) =>
    post<{ etiquetas: Etiqueta[] }>('/api/admin/whatsapp/etiquetas', p);

// ─── 🔔 Aviso nativo do Teams (Paulo, 23/08) ────────────────────────────────
// O webview do Teams não deixa a página mostrar popup do sistema; quem avisa
// lá é o PRÓPRIO Teams (sino de Atividade, via Graph). O teste manda um aviso
// para o USUÁRIO LOGADO — a recusa do Graph volta crua, é ela que diz o que
// falta (consent, manifest, app não instalado).
export const testarAvisoTeams = () =>
    post<{
        resultado: { ok: true } | { ok: false; etapa: string; erro: string; bruto?: unknown };
        status: { graphConfigurado: boolean; clientId: string | null; teamsAppId: string };
    }>('/api/admin/whatsapp/teams-aviso/testar', {});

// ─── ☎️ Chamada de voz/vídeo — SONDA, não interruptor ───────────────────────
// Ela pergunta à Meta e relata. Ligar a chamada abre um botão no WhatsApp de
// TODOS os clientes: é decisão do Paulo, com destino de atendimento definido
// antes — não efeito colateral de um clique de diagnóstico.

export interface SondaChamada {
    candidato: string; rotulo: string; hipotese: string;
    situacao: 'ligado' | 'desligado' | 'nao-declarado' | 'nao-reconhecido' | 'sem-permissao' | 'indeterminado';
    motivo: string; acao?: string; campo?: string; bruto?: unknown;
}

/** Horário do atendimento (o dono das mensagens) × o que a Meta tem gravado. */
export interface HorariosChamada {
    mensagens: { dias: number[]; turnos: { inicio: string; fim: string }[] } | null;
    conferencia: { situacao: 'igual' | 'diverge' | 'sem-call-hours' | 'horario-ilegivel'; motivo: string };
    calling: Record<string, unknown> | null;
    /** 🚨 Os interruptores que o painel não lia: calling.status e sip.status.
     *  Servidor GRAVADO não é tronco LIGADO. Ausente vira 'nao-declarado'. */
    interruptores?: {
        estado: { chamada: string; sip: string; icone: string; horarios: string; servidores: number };
        impedimentos: { campo: string; motivo: string; acao: string }[];
        ok: boolean;
    } | null;
}

export const sondarChamadas = () =>
    req<{
        conclusao: { veredito: SondaChamada['situacao']; motivo: string; acao?: string; respondeuPor?: string | null };
        sondas: SondaChamada[];
        antesDeLigar: { titulo: string; texto: string }[];
        horarios?: HorariosChamada | null;
    }>('/api/admin/whatsapp/chamadas/sondar');

export interface SondaSbc {
    hostname?: string | null;
    porta?: number;
    /** De onde saiu o alvo: as settings da Meta, ou informado no pedido. */
    origemDoAlvo?: string | null;
    sipDaMeta?: Record<string, unknown> | null;
    dns?: { ok: boolean; erro?: string | null; enderecos?: string[] };
    tcp?: { ok: boolean; erro?: string | null };
    tls?: { ok: boolean; erro?: string | null; protocolo?: string | null };
    cert?: {
        autorizado?: boolean; erroAutorizacao?: string | null; sujeitoCN?: string | null;
        emissor?: string | null; alternativos?: string[]; validoAte?: string | null;
    };
    sip?: { respondeu: boolean; motivo?: string; codigo?: number; frase?: string | null; servidor?: string | null } | null;
    certificado?: { situacao: string; grave: boolean; motivo: string; acao: string | null } | null;
    conclusao: { veredito: 'aprovado' | 'reprovado' | 'indeterminado'; motivo: string; acao: string; ressalvas?: string[] };
    levouMs?: number;
}

/**
 * 🔌 A Meta CONSEGUE falar com o nosso SBC? A sonda de settings responde "o
 * que ela tem gravado"; esta abre a conexão do jeito que ela abre — DNS, TLS,
 * certificado e um SIP OPTIONS. É o que separa "tudo verde e a ligação é
 * recusada" de uma causa com nome.
 */
/**
 * 🔎 Os eventos de CHAMADA que a Meta mandou, CRUS. Existe porque a tela dela
 * promete "peça um retorno de ligação e entraremos em contato" — e o leiaute
 * desse pedido não está provado aqui. Não processa nada: entrega o evento real
 * para a régua nascer DELE.
 */
export const eventosCrusDeChamada = () =>
    req<{
        achados: { em: string | null; rotulo: string; payload: unknown }[];
        amostra: number;
        ultimoEventoEm: string | null;
    }>('/api/admin/whatsapp/chamadas/eventos-crus');

export const sondarSbc = (p?: { hostname?: string; porta?: number }) =>
    post<SondaSbc>('/api/admin/whatsapp/chamadas/sondar-sbc', p || {});

/** 🛠 Escrita EXPLÍCITA na Meta (Paulo, 23/08) — a rota re-lê e devolve o que
 *  ficou GRAVADO; recusa da Meta volta crua, nunca engolida. */
export const configurarChamadas = (p:
    { acao: 'horarios' } | { acao: 'icone'; iconeVisivel: boolean } | { acao: 'sip'; hostname: string; porta: number }) =>
    post<{
        acao: string;
        aplicado: Record<string, unknown>;
        calling: Record<string, unknown> | null;
        conferencia: HorariosChamada['conferencia'] | null;
        brutoGravado?: unknown;
        bruto?: unknown;
    }>('/api/admin/whatsapp/chamadas/configurar', p);

// ── 📷 Sonda do Instagram (Paulo, 18/08) — mesma decisão: só pergunta ───────

export interface SondaInstagram {
    candidato: string; rotulo: string; hipotese: string;
    situacao: 'token-ok' | 'conta-encontrada' | 'pagina-sem-instagram' | 'sem-pagina'
        | 'sem-permissao' | 'nao-reconhecido' | 'indeterminado';
    motivo: string; acao?: string;
    pagina?: { id: string; nome: string };
    instagram?: { id: string; username: string | null };
    bruto?: unknown;
}

export const sondarInstagram = () =>
    req<{
        conclusao: {
            veredito: 'conta-encontrada' | 'pagina-sem-instagram' | 'sem-pagina' | 'sem-permissao' | 'indeterminado';
            motivo: string; acao?: string;
            pagina?: { id: string; nome: string };
            instagram?: { id: string; username: string | null };
        };
        sondas: SondaInstagram[];
        sobreRestringirAtendentes: { titulo: string; texto: string };
    }>('/api/admin/whatsapp/instagram/sondar');

/** Estado persistido do recebimento das DMs (null = 📡 nunca clicado). */
export interface EstadoInstagram {
    ligadoEm: string; ligadoPor: string | null;
    appId: string; callback: string;
    pageId: string; igId: string | null; igUsername: string | null;
}

/** Contagem de eventos CRUS do IG no webhook — null = não deu pra conferir. */
export interface EventosInstagram {
    amostra: number; doInstagram: number; ultimoEm: string | null;
}

/** O que a META diz que está assinado (fonte, não a memória do clique). */
export interface AssinaturasInstagram {
    appId: string;
    doApp: { objeto: string; ativa: boolean; callback: string | null; campos: string[] }[];
    daPagina: { appId: string; campos: string[] }[] | null;
}

/** Último aperto de mão no GET do webhook — navegador × Meta × token errado. */
export interface VerificacaoWebhook {
    em: string; ok: boolean; motivo: string | null; pareceNavegador: boolean;
}

export const estadoInstagram = () =>
    req<{
        estado: EstadoInstagram | null;
        eventos?: EventosInstagram | null;
        assinaturas?: AssinaturasInstagram | null;
        verificacao?: VerificacaoWebhook | null;
        /** Último POST recusado por assinatura — "a Meta bateu e a chave não conferiu". */
        postRecusado?: { em: string; motivo: string; objeto: string | null } | null;
        /** PRESENÇA (nunca o valor) das envs do modo "login do Instagram" na revisão que serve. */
        envs?: { instagramAppSecret: boolean; instagramAccessToken: boolean };
    }>('/api/admin/whatsapp/instagram/estado');

/** 📡 Liga o recebimento das DMs (assina webhook + Página na Meta). Idempotente. */
export const ligarInstagram = () =>
    post<EstadoInstagram>('/api/admin/whatsapp/instagram/ligar', {});

// ─── Atendentes ↔ filas (admin) ─────────────────────────────────────────────

export interface Atendente {
    uid: string; email: string | null; nome: string | null; role: string;
    papelAtendimento: string;
    departamentos: string[]; filasAtendimento: string[];
    /** 👑 Dono do escritório — vê tudo por construção. Quem responde é o
     *  BACKEND (`ehDono`, que tem a env); a tela só imprime o selo. */
    dono?: boolean;
}

export const listarAtendentes = () =>
    req<{ atendentes: Atendente[]; filas: FilaAtendimento[] }>('/api/admin/whatsapp/atendentes');

export const salvarFilasAtendente = (uid: string, filas: string[]) =>
    post<{ uid: string; filas: string[] }>(`/api/admin/whatsapp/atendentes/${encodeURIComponent(uid)}/filas`, { filas });

/** Papel do atendimento (colaborador/gestor) — só admin grava. */
export const salvarPapelAtendente = (uid: string, papel: 'colaborador' | 'gestor') =>
    post<{ uid: string; papel: string }>(`/api/admin/whatsapp/atendentes/${encodeURIComponent(uid)}/papel`, { papel });

// ─── 📊 Avaliações (admin/gestor: todas · colaborador: as próprias) ─────────

export interface AvaliacaoAtendimento {
    id: string; numero: string; nota: number; em: string;
    atendente: string | null; encerradaPor: string | null; fila: string; protocolo: string | null;
}

export const listarAvaliacoes = () =>
    req<{
        escopo: 'todas' | 'minhas'; total: number; media: number | null;
        porNota: { nota: number; quantidade: number }[];
        avaliacoes: AvaliacaoAtendimento[];
    }>('/api/admin/whatsapp/avaliacoes');

// ─── 📥 Importar backup da Ultra Fox (admin; preview antes de gravar) ───────

export interface ImportPreview {
    preview?: boolean; tipo: string; total: number;
    amostra?: unknown[]; autores?: string[]; avisos?: string[];
    descartados?: { linha?: number; valor?: string; motivo: string }[];
    descartadas?: { linha?: number; trecho?: string; motivo: string }[];
    totalDescartados?: number; totalDescartadas?: number;
    criados?: number; jaExistiam?: number; gravadas?: number; conversas?: number;
}

export const importarUltrafox = (p: {
    tipo: 'contatos' | 'mensagens-txt' | 'mensagens-csv';
    conteudo: string; confirmar: boolean;
    numero?: string; autoresEscritorio?: string[];
}) => post<ImportPreview>('/api/admin/whatsapp/importar-ultrafox', p);

/**
 * Grava UM bloco do lote. As mensagens já vêm lidas (o parser roda no
 * navegador, na máquina de quem importa) — mas quem decide ENTRADA × SAÍDA e
 * quem calcula o id de cada mensagem é o servidor.
 */
export const importarUltrafoxLote = (p: {
    conversas: { numero: string; mensagens: { em: string; autor: string; texto: string }[] }[];
    autoresEscritorio: string[];
}) => post<{ gravadas?: number; conversas?: number; totalRecusadas?: number; recusadas?: { numero: string; motivo: string }[] }>(
    '/api/admin/whatsapp/importar-ultrafox/lote', p,
);

/**
 * 🗄 Arquiva AGORA a mídia das conversas no SharePoint (o cron faz o mesmo
 * sozinho, de carona no ciclo do arquivo fiscal). Regra do manual: tudo que
 * não for texto vai pro SharePoint — árvore genérica "SP Connect/", porque
 * muito contato (currículo, lead) não é cliente cadastrado.
 */
export interface ResultadoArquivoSp {
    escopo?: string; lidos?: number; candidatos?: number; arquivados?: number;
    semMidia?: number; notasInternas?: number; outrosSkip?: number;
    erros?: number; errosDetalhe?: string[];
    cicloCompleto?: boolean; pausadoPorTeto?: boolean; duracaoMs?: number;
}
export const arquivarMidiasNoSharePoint = (maxDocs?: number) =>
    post<ResultadoArquivoSp>('/api/admin/whatsapp/arquivo-sp', maxDocs ? { maxDocs } : {});

/**
 * 📈 Relatório de atendimento (admin/gestor): volume por fila/atendente e
 * tempo de 1ª resposta HUMANA. A conta é do backend (núcleo puro) — a tela
 * só desenha. `parcial` ≠ null = o período estourou o teto de leitura e o
 * número é PISO, não total.
 */
export interface RelatorioAtendimento {
    dias: number;
    conversasComMovimento: number;
    recebidas: number;
    enviadasHumanas: number;
    enviadasBot: number;
    semRespostaHumana: number;
    porFila: {
        fila: string; conversas: number; recebidas: number; enviadasHumanas: number;
        enviadasBot: number; respondidas: number; semRespostaHumana: number;
        tempoMedio1aRespostaMin: number | null;
    }[];
    porAtendente: { atendente: string; enviadas: number; conversas: number }[];
    parcial?: number | null;
}
export const relatorioAtendimento = (dias: number) =>
    req<RelatorioAtendimento>(`/api/admin/whatsapp/relatorio?dias=${dias}`);
