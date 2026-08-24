export interface ConfigWhatsapp {
    token: string;
    phoneNumberId: string;
    template: string;
    idioma: string;
}

export function configWhatsapp(env?: Record<string, string | undefined>): ConfigWhatsapp;
export function faltasDaConfig(cfg: ConfigWhatsapp): string[];
/**
 * Identificador do WhatsApp como a Meta escreveu (E.164 sem "+"). Para
 * `wa_id`, id de conversa e nome de pasta do backup — NUNCA re-normalizar.
 */
export function numeroCanonicoWhatsapp(numero?: string | null): string | null;
/** Número DIGITADO por gente (régua BR; "+" declara outro país). */
export function normalizarNumeroBr(numero?: string | null): string | null;

export interface MensagemTemplateInput {
    para: string;
    template: string;
    idioma?: string;
    variaveis?: Array<string | number | null | undefined>;
    documentoId?: string | null;
    nomeArquivo?: string | null;
}
export interface MensagemTemplatePayload {
    messaging_product: string;
    to: string;
    type: string;
    template: {
        name: string;
        language: { code: string };
        components?: Array<{ type: string; parameters: Array<Record<string, any>> }>;
    };
}
export function montarMensagemTemplate(p: MensagemTemplateInput): MensagemTemplatePayload;

export interface ContatoParaCartao {
    numero: string;
    nome?: string | null;
    empresa?: string | null;
}
export interface MensagemContatoPayload {
    messaging_product: string;
    to: string;
    type: string;
    contacts: Array<{
        name: { formatted_name: string; first_name: string; last_name?: string };
        phones: Array<{ phone: string; type: string; wa_id: string }>;
        org?: { company: string };
    }>;
}
export function montarMensagemContato(
    p: { para: string; contatos?: ContatoParaCartao[] }): MensagemContatoPayload;
export function enviarContatoWhatsapp(
    p: { para: string; contatos: ContatoParaCartao[] },
    deps?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; cfg?: ConfigWhatsapp },
): Promise<RespostaWhatsapp & { configuracaoIncompleta?: boolean }>;

export interface RespostaWhatsapp {
    ok: boolean;
    messageId: string | null;
    contato?: string | null;
    code?: number | null;
    erro?: string;
    acao?: string;
}
export function interpretarRespostaWhatsapp(status: number, corpo: unknown): RespostaWhatsapp;

export interface EnvioGuiaWhatsappResultado extends RespostaWhatsapp {
    numeroEnviado?: string;
    configuracaoIncompleta?: boolean;
    indeterminado?: boolean;
}
export function enviarGuiaWhatsapp(
    p: { para: string; variaveis?: Array<string | number | null | undefined>; pdfBase64?: string | null; nomeArquivo?: string | null },
    deps?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; cfg?: ConfigWhatsapp },
): Promise<EnvioGuiaWhatsappResultado>;

/**
 * Texto livre DENTRO da janela de 24h. `para` é CANÔNICO (wa_id / id da
 * conversa) — quem digita normaliza antes, na porta de entrada.
 */
export function enviarTextoLivre(
    p: { para: string; texto: string },
    deps?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; cfg?: ConfigWhatsapp },
): Promise<EnvioGuiaWhatsappResultado>;
/**
 * Anexo na conversa. `para` também é CANÔNICO. `mediaId` OU `link` — ao
 * menos um dos dois.
 */
export function enviarMidiaWhatsapp(
    p: { para: string; tipo: string; mediaId?: string; link?: string; nomeArquivo?: string | null; legenda?: string | null },
    deps?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; cfg?: ConfigWhatsapp },
): Promise<EnvioGuiaWhatsappResultado>;

export function subirPdf(
    p: { pdfBase64: string; nomeArquivo?: string | null },
    deps?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; cfg?: ConfigWhatsapp },
): Promise<string>;

// ─── Assinatura da WABA (a 2ª amarração do webhook) ─────────────────────────
export function listarAppsAssinadosNaWaba(deps?: Record<string, unknown>): Promise<{
    ok: boolean; wabaId?: string; erro?: string;
    apps?: { id: string | null; nome: string | null }[];
}>;
export function assinarWaba(deps?: Record<string, unknown>): Promise<{
    ok: boolean; wabaId?: string; erro?: string; acao?: string;
}>;
export function interpretarAppsAssinados(corpo: unknown): { id: string | null; nome: string | null }[];
export const GRAPH_BASE: string;
/** Base do Graph da CHAMADA (v23+ por padrão — a v20 do envio não conhece o call_permission_request). */
export function graphBaseChamadas(env?: Record<string, string | undefined>): string;

// 📝 Criar template NOVO na Meta (a validação de forma é do whatsapp-templates).
export function criarTemplateNaMeta(
    p: { nome: string; idioma: string; categoria: string; corpo: string; exemplos?: string[] },
    deps?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; cfg?: ConfigWhatsapp },
): Promise<{ ok: boolean; id?: string | null; status?: string; categoria?: string; erro?: string; detalheMeta?: unknown; faltas?: string[] }>;

export function enviarPedidoPermissaoLigacao(
    p: { para: string },
    deps?: { cfg?: unknown; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; base?: string },
): Promise<{
    ok: boolean; erro?: string; acao?: string; code?: number | null;
    messageId?: string | null; semIdDaMeta?: boolean; bruto?: unknown;
    indeterminado?: boolean; configuracaoIncompleta?: boolean; numeroEnviado?: string;
}>;

export function iniciarChamadaParaCliente(
    p: { para: string },
    deps?: { cfg?: unknown; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; base?: string },
): Promise<{
    ok: boolean; callId?: string | null; erro?: string; acao?: string; code?: number | null;
    bruto?: unknown; indeterminado?: boolean; configuracaoIncompleta?: boolean;
}>;

export function registrarNumeroNaCloudApi(
    p: { phoneNumberId: string; pin: string },
    deps?: { cfg?: unknown; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch },
): Promise<{
    ok: boolean; erro?: string; acao?: string; code?: number | null;
    bruto?: unknown; indeterminado?: boolean; configuracaoIncompleta?: boolean;
}>;

export function statusDoNumeroNaMeta(
    p: { phoneNumberId: string },
    deps?: { cfg?: unknown; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch },
): Promise<{ ok: boolean; numero?: Record<string, unknown>; erro?: string; code?: number | null; bruto?: unknown; configuracaoIncompleta?: boolean }>;
