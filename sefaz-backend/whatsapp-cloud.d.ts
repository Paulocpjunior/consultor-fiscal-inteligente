export interface ConfigWhatsapp {
    token: string;
    phoneNumberId: string;
    template: string;
    idioma: string;
}

export function configWhatsapp(env?: Record<string, string | undefined>): ConfigWhatsapp;
export function faltasDaConfig(cfg: ConfigWhatsapp): string[];
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
