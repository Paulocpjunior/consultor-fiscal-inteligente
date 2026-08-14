// Tipos do núcleo do webhook do WhatsApp (F1 do módulo 💬 Comunicação).

export interface ConfigWebhook {
    verifyToken: string;
    appSecret: string;
}

export interface MensagemRecebida {
    metaMessageId: string;
    de: string;
    nomePerfil: string | null;
    tipo: string;
    texto: string | null;
    midia: {
        metaMediaId: string | null;
        mime: string | null;
        nomeArquivo: string | null;
        sha256: string | null;
    } | null;
    respostaA: string | null;
    timestamp: string | null;
    phoneNumberId: string | null;
}

export interface StatusEntrega {
    metaMessageId: string;
    destinatario: string | null;
    status: string;
    timestamp: string | null;
    erro: { codigo: number | null; titulo: string | null; detalhe: string | null } | null;
    phoneNumberId: string | null;
}

export function configWebhook(env?: Record<string, string | undefined>): ConfigWebhook;
export function faltasDaConfigWebhook(cfg: ConfigWebhook): string[];
export function responderVerificacao(
    query: Record<string, unknown> | undefined,
    cfg: ConfigWebhook,
): { ok: true; challenge: string } | { ok: false; motivo: string };
export function assinaturaValida(
    rawBody: Buffer | string | undefined,
    headerAssinatura: string | string[] | undefined,
    appSecret: string,
): boolean;
export function extrairEventos(payload: unknown): {
    valido: boolean;
    motivo?: string;
    mensagens: MensagemRecebida[];
    statuses: StatusEntrega[];
};
export function traduzirStatusEntrega(status: string): string;
export function interpretarErroEntrega(codigo: number | null | undefined, detalhe?: string): string;
export function janela24hAte(timestampIso: string | null | undefined): string | null;
export function resumoParaConversa(msg: Pick<MensagemRecebida, 'tipo' | 'texto' | 'midia'>): string;
export function caminhoStorageMidia(msg: Pick<MensagemRecebida, 'metaMessageId' | 'de' | 'midia'>): string;

export const _internals: Record<string, unknown>;
