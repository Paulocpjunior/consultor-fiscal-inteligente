export interface MensagemConversaTxt {
    em: string;
    autor: string;
    texto: string;
}

export interface LinhaDescartada {
    trecho: string;
    motivo: string;
}

export function dataBrParaIso(dataStr: unknown, horaStr: unknown): string | null;
export function interpretarConversaTxt(texto: unknown): {
    mensagens: MensagemConversaTxt[];
    autores: string[];
    descartadas: LinhaDescartada[];
};
