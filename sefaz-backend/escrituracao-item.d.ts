export interface EscrituracaoDoItem {
    /** CFOP informado (4 dígitos) ou '' quando só o CST foi informado. */
    cfop: string;
    /** Tributação do CST informada (2 dígitos) ou ''. */
    cst: string;
    por: string | null;
    em: string | null;
}

/** A chave do item no mapa `escrituracaoItens` — o `nItem` sem zeros à esquerda; '' sem identidade. */
export function chaveDoItem(item: unknown): string;
/** O que foi informado para ESTE item, ou null. Precedência é de quem aplica (cfopDoLancamento/cstDoLancamento). */
export function escrituracaoDoItem(doc: unknown, item: unknown): EscrituracaoDoItem | null;
export function cfopInformadoDoItem(doc: unknown, item: unknown): string;
export function resumoEscrituracaoItens(doc: unknown): { total: number; nItens: string[] };
