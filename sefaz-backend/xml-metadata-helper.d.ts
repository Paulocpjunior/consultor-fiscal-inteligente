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

export interface DocParaDirecao {
    direcao?: string | null;
    tpNF?: string | number | null;
    cnpjEmit?: string | null;
    empresaCnpj?: string | null;
    emitente?: { cnpj?: string | null; cnpjCpf?: string | null } | null;
    itens?: Array<{ cfop?: string | null } | null | undefined> | null;
}

export function direcaoEfetivaDoc(d: DocParaDirecao | null | undefined): string | undefined;

/** CFOP de ENTRADA: 1xxx (interna), 2xxx (interestadual), 3xxx (exterior). */
export function ehCfopDeEntrada(cfop: unknown): boolean;

/**
 * A nota é NOTA PRÓPRIA DE ENTRADA (art. 136, I, "a" do RICMS/SP)? A régua é o
 * `tpNF`, e só ele — ver o aviso no módulo sobre por que o CFOP NÃO decide isto.
 */
export function ehNotaPropriaDeEntrada(
    d: DocParaDirecao | null | undefined,
    empresaCnpj?: string | null,
): { sim: boolean; prova: 'tpNF' | null };

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

/**
 * O VALOR do documento, em TODAS as formas em que ele é gravado — `valorTotal`
 * (importer principal), `totais.vNF` (import pelo NAVEGADOR, que NÃO grava
 * `valorTotal`), `valor`/`totalNota`/`valorServicos`, `valores.total` e `vNF`
 * na raiz.
 *
 * Devolve **NaN** quando nenhuma forma tem número — de propósito: "documento de
 * R$ 0,00" e "não achei o valor" são coisas diferentes, e foi o zero silencioso
 * que produziu 37 A100 zerados num arquivo entregue à Receita.
 *
 * ⚠️ `valores.liquido` fica FORA: na NFS-e ele é o líquido de retenções.
 */
export function valorDoDocumento(nota: unknown): number;
/** Nome antigo da MESMA função (a pergunta nunca foi específica de serviço). */
export function valorDoDocumentoServico(nota: unknown): number;
