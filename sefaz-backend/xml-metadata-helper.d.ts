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
 * Cancelamento EFETIVO do documento — mesma lição da direção: o status gravado
 * pode mentir (evento 155 não virava o status; merge stub→nota ressuscitava a
 * cancelada). Decide na LEITURA pelo status, pelo cStat legado da própria nota
 * (101/151) e pelos eventos[] de cancelamento (110111 com cStat 135/155).
 */
export function docCancelado(d: unknown): boolean;
export const CSTAT_EVENTO_CANCELAMENTO: Set<string>;

/**
 * CNPJ/CPF do bloco <autXML> da NF-e — a PROVA de que o cliente autorizou o
 * escritório a baixar o XML da saída dele (sem isso, Rejeição 641).
 */
export function extrairAutXml(xml: string): string[];
export function autorizadoNoXml(xml: string, cnpjEscritorio: string): boolean;

/**
 * Direção do documento pela ótica da EMPRESA-CLIENTE.
 *
 * `tpNF` decide quando a empresa é a EMITENTE: nota própria de ENTRADA
 * (tpNF=0, RICMS/SP art. 136 — compra de produtor rural PF) tem emit=empresa e
 * mesmo assim é entrada. Régua ÚNICA: o import da SEFAZ e o import manual do
 * frontend leem daqui.
 */
export function decidirDirecaoPorTpNF(
    cnpjEmit: unknown,
    cnpjDest: unknown,
    empresaCnpj: unknown,
    tpNF: unknown,
): 'entrada' | 'saida' | 'desconhecida';
