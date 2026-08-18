/** Tipos de cst-correlacao.js — o CST que a escrituração usa quando o CFOP foi reclassificado. */

export type SituacaoCst =
    | 'convertido'
    | 'preservado'
    | 'preservado-por-situacao'
    | 'nao-decidido'
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

export function cstDoLancamento(cstDoItem: unknown, cfopEscriturado: unknown): CstDoLancamento;

export function resumirCst(
    itens: Array<{ cst?: unknown; cfop?: unknown }> | null | undefined,
): { convertidos: number; avisos: string[]; semDecisao: Array<[string, number]> };

export const CST_POR_DESTINO: Record<string, { cst: string; rotulo: string; fonte: string }>;
export const DESTINOS_SEM_DECISAO: Record<string, string>;
export const SITUACOES_CONVERTIVEIS: Set<string>;
