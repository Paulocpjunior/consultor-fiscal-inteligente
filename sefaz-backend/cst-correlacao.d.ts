/** Tipos de cst-correlacao.js — o CST que a escrituração usa quando o CFOP foi reclassificado. */

export type SituacaoCst =
    | 'convertido'
    | 'preservado'
    | 'preservado-por-situacao'
    | 'nao-decidido'
    | 'informado'
    | 'sem-cst';

export interface CstDoLancamento {
    /** CST de 3 dígitos (origem + tributação). Null só quando o item não tem CST. */
    cst: string | null;
    /** O CST como veio do XML do fornecedor, normalizado a 3 dígitos. */
    original: string | null;
    /** Rótulo do destino ('uso ou consumo', 'ativo imobilizado (compra)'…). */
    destino: string | null;
    situacao: SituacaoCst;
    /** A causa junto do número — vai no title da célula e no PDF. */
    motivo: string;
}

export function partesDoCst(cst: unknown): { origem: string; tributacao: string } | null;

/**
 * @param cstInformado Tributação informada NAQUELA nota (2 dígitos). Vence a
 * régua; a ORIGEM continua vindo do item, porque ela é fato da mercadoria.
 */
export function cstDoLancamento(
    cstDoItem: unknown,
    cfopEscriturado: unknown,
    cstInformado?: unknown,
): CstDoLancamento;

/** Trava do campo digitado: vazio é resposta, fora da Tabela B é recusado. */
export function validarCstEscriturado(
    valor: unknown,
): { ok: true; cst: string } | { ok: false; motivo: string };

export const TRIBUTACOES_ICMS: Set<string>;

export function resumirCst(
    itens: Array<{ cst?: unknown; cfop?: unknown }> | null | undefined,
): { convertidos: number; avisos: string[]; semDecisao: Array<[string, number]> };

export const CST_POR_DESTINO: Record<string, { cst: string; rotulo: string; fonte: string }>;
export const DESTINOS_SEM_DECISAO: Record<string, string>;
export const SITUACOES_CONVERTIVEIS: Set<string>;
