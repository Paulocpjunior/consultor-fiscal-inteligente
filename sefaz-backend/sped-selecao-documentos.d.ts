/**
 * Qual documento entra em qual bloco do SPED — o modelo vem da RÉGUA (chave),
 * nunca do campo cru `modelo`, que o importer principal não grava.
 * O `.d.ts` entra no mesmo PR que o módulo (convenção do projeto).
 */

/** Rótulo do documento num aviso: o número é o que a pessoa procura na tela. */
export function rotuloDoDoc(d: unknown): string;

/** É um RESUMO da SEFAZ (resNFe/resNFCe — sem itens por natureza)? */
export function ehResumoSefaz(d: unknown): boolean;

/** NF-e (55) ou NFC-e (65) — bloco C. O tipo é julgado ANTES do modelo. */
export function ehNotaDeMercadoria(d: unknown): boolean;

/** CT-e (57) / CT-e OS (67) — bloco D. */
export function ehConhecimentoDeTransporte(d: unknown): boolean;

export interface SelecaoBlocoC<T = any> {
    /** As que se escrituram (cancelada entra: C100 sem filhos). */
    notas: T[];
    /** Só o resumo na base — a ação é importar o XML completo / ♻️. */
    soResumo: string[];
    /** Válidas sem itens — produziriam C100 sem C190, que o PVA recusa. */
    semItens: string[];
}

export function selecionarNotasBlocoC<T = any>(notas: T[] | null | undefined): SelecaoBlocoC<T>;

export function selecionarCtesBlocoD<T = any>(notas: T[] | null | undefined): T[];

/** O que ficou de fora do arquivo, dito com a ação — nunca calado. */
export function avisosDaSelecao(p?: { soResumo?: string[]; semItens?: string[] }): string[];
