/** Tipos de cte-escrituracao.js — o CT-e na FORMA do item, para passar pela MESMA régua da nota de mercadoria. */

export interface ItemSinteticoCte {
    sintetico: 'cte';
    cfop: string;
    cst: string;
    descricao: string;
    vProd: number;
    vDesc: number;
    vBC?: number;
    vICMS?: number;
    aliqIcms?: number;
}

export const CST_CTE_SEM_CABECALHO: string;

export function cfopDoCte(nota: unknown): string;
export function cstDoCte(nota: unknown): string;
export function itemSinteticoDoCte(nota: unknown): ItemSinteticoCte;
export function ehItemSinteticoDeCte(item: unknown): boolean;
/** Os itens do documento, ou o sintético quando é CT-e. Sem itens e sem ser CT-e: []. */
export function itensParaEscriturar(doc: unknown): any[];
export function icmsDestacadoDoCte(nota: unknown): number;
export function avisosDeCteSemCredito(
    semCredito: Array<{ numero: string; destacado: number; por: 'informado' | 'regime' }>,
    regime?: string,
): string[];
