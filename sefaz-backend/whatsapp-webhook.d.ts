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
export interface MidiaDaMensagem {
    nomeArquivo?: string | null;
    mime?: string | null;
    tipo?: string | null;
    tamanhoBytes?: number | null;
}
/** Documento de mensagem, na forma que a frase do erro precisa dele. */
export interface MensagemParaErro {
    direcao?: string | null;
    texto?: string | null;
    midia?: MidiaDaMensagem | null;
    enviadoPor?: string | null;
}
/**
 * Saiu por OUTRA plataforma? (sem `enviadoPor`, sem texto e sem mídia). Na
 * dúvida — documento ausente — devolve false: afirmar que um envio NOSSO é de
 * outro faria o colaborador ignorar a falha dele.
 */
export function saiuPorOutraPlataforma(mensagem: MensagemParaErro | null | undefined): boolean;
/**
 * O documento que `interpretarErroEntrega` deve enxergar para este
 * `metaMessageId`: quando `existeDoc` é false, sintetiza `{direcao:'saida'}`
 * — nosso envio SEMPRE grava o doc antes de a Meta poder chamar o webhook,
 * então documento ausente é prova estrutural de "outra plataforma", não
 * dúvida. Ver whatsapp-webhook.js para o caso real que motivou isto.
 */
export function mensagemDoStatus(existeDoc: boolean, dadosDoDoc: MensagemParaErro | null | undefined): MensagemParaErro;
/**
 * `mensagem` é o DOCUMENTO da mensagem que falhou: dele saem o ARQUIVO (o
 * 131053 sem isso é beco) e a resposta de QUEM mandou — prescrever conversão
 * de arquivo a quem não enviou nada é ação impossível.
 */
export function interpretarErroEntrega(
    codigo: number | null | undefined, detalhe?: string, mensagem?: MensagemParaErro | null): string;
export function janela24hAte(timestampIso: string | null | undefined): string | null;
export function resumoParaConversa(msg: Pick<MensagemRecebida, 'tipo' | 'texto' | 'midia'>): string;
export function caminhoStorageMidia(msg: Pick<MensagemRecebida, 'metaMessageId' | 'de' | 'midia'>): string;

export const _internals: Record<string, unknown>;
