/**
 * Participante do documento. O ENDEREÇO (uf/codMunIBGE) não é opcional na
 * prática: sem UF o Exportar SAGE não consegue cadastrar o participante
 * (registro E010) e a importação inteira cai em cascata.
 */
export interface XmlParticipanteNfe {
    cnpj: string | null;
    nome: string | null;
    uf: string | null;
    codMunIBGE: string | null;
    ie: string | null;
}

export interface XmlParticipantesNfe {
    emitente: XmlParticipanteNfe;
    destinatario: XmlParticipanteNfe;
}

export function competenciaFromDhEmi(value: unknown): string | null;
export function extrairParticipantesNfe(xml: string): XmlParticipantesNfe;

export function direcaoEfetivaDoc(
    d: { direcao?: string | null; tpNF?: string | number | null } | null | undefined,
): string | undefined;

/**
 * CNPJ/CPF do bloco <autXML> da NF-e — a PROVA de que o cliente autorizou o
 * escritório a baixar o XML da saída dele (sem isso, Rejeição 641).
 */
export function extrairAutXml(xml: string): string[];
export function autorizadoNoXml(xml: string, cnpjEscritorio: string): boolean;
