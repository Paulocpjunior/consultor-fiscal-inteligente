/**
 * Barrar o segundo envio do MESMO débito — o `.d.ts` entra no mesmo PR.
 * A unidade é o débito (código+extensão), nunca a guia.
 */
export function chaveDebito(d: unknown): string | null;
export function chavesDaGuia(debitos?: unknown[]): string[];
/** Só `email-graph` e `whatsapp-api` provam que a mensagem saiu (05/08). */
export function canalProvaEnvio(canal: unknown): boolean;

export interface RepeticaoDebito {
    chave: string; descricao: string;
    valorAgora: number | null; valorAntes: number | null;
    /** Valor diferente = provável retificação. O app diz os dois; não escolhe. */
    valorMudou: boolean;
    canal: string | null; prova: boolean;
    enviadoPor: string | null; enviadoEm: string | null;
    tipo: string | null; logId: string | null;
}

export interface ConferenciaRepeticao {
    repetidos: RepeticaoDebito[];
    /** Envios antigos que não gravaram a composição — ressalva, não silêncio. */
    semComposicao: Array<{ id: string | null; tipo: string | null; canal: string | null; enviadoPor: string | null; enviadoEm: string | null; prova: boolean }>;
    temRepetidoComProva: boolean;
    bloqueia: boolean;
    incerto: boolean;
}

export function conferirDebitosJaEnviados(p: {
    debitosDaGuia?: unknown[];
    enviosAnteriores?: unknown[];
    logIdAtual?: string | null;
}): ConferenciaRepeticao;

export function avisoDeRepeticao(conferencia: ConferenciaRepeticao | null | undefined):
    { titulo: string; texto: string; acao: string; severidade: 'erro' | 'atencao' } | null;
