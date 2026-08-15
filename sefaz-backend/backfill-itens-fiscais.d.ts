/**
 * Recuperação de campos de ITEM a partir do XML-fonte (Cloud Storage).
 *
 * O `.d.ts` entra NO MESMO PR que o módulo: foi a falta dele que derrubou o
 * deploy 487 — o teste importava a função e o typecheck do CI não a conhecia.
 */

/** Campos que o extrator aprendeu depois e que este backfill recupera. */
export const CAMPOS_RECUPERAVEIS: string[];

export interface ItemFiscal {
    nItem?: string | number | null;
    cstIpi?: string | null;
    cEnqIpi?: string | null;
    vBcIpi?: number | null;
    cstPis?: string | null;
    cstCofins?: string | null;
    [k: string]: unknown;
}

/**
 * Pareia itens gravados × itens do XML. Por `nItem` (a identidade do item
 * dentro da nota) e, na falta dele, por índice SÓ com as contagens iguais —
 * gravar por posição em listas de tamanhos diferentes escreveria o CST de um
 * produto em outro, e o arquivo sairia ACEITO declarando outra coisa.
 */
export function parearItens(
    gravados?: ItemFiscal[],
    doXml?: ItemFiscal[],
): { pares: Array<[ItemFiscal, ItemFiscal]>; criterio: 'nItem' | 'indice'; motivo?: string };

/**
 * Mescla os campos recuperáveis. NÃO apaga e NÃO sobrescreve: preenche só o
 * que está vazio (`0` não é vazio — zero é resposta).
 */
export function mesclarItensRelidos(
    gravados: ItemFiscal[] | null | undefined,
    doXml: ItemFiscal[] | null | undefined,
    campos?: string[],
): {
    itens: ItemFiscal[];
    alterados: number;
    campos: Record<string, number>;
    criterio: 'nItem' | 'indice';
    motivo?: string;
};
