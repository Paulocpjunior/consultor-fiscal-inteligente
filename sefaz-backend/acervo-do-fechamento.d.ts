// Tipos de `acervo-do-fechamento.js` — o acervo que o fim de mês congelou.
//
// ⚠️ `.d.ts` à mão é a armadilha das duas formas com outra roupa (20/08): tipo
// e implementação são duas declarações do mesmo fato e divergem em silêncio.
// Export novo no `.js` entra aqui no MESMO PR.

/** Campos que uma projeção `.select()` precisa trazer para `chegouEmMs`
 *  responder. Campo fora da projeção some da leitura, e o recorte viraria
 *  "não consegui conferir nenhum" — indistinguível de "todos chegaram antes". */
export const CAMPOS_PARA_CHEGADA: readonly string[];

/**
 * QUANDO este documento entrou na nossa base, em ms — ou `null`.
 *
 * Lê `createdAt` e `importadoEm` nas quatro formas em que eles são gravados
 * (string ISO, número, Timestamp do SDK e Timestamp em JSON), porque cada
 * trilho de captura grava de um jeito.
 *
 * ⚠️ `dhEmi` fica de fora: ele diz quando a nota foi EMITIDA, não quando ela
 * chegou aqui.
 */
export function chegouEmMs(doc: unknown): number | null;

export interface RecorteDoAcervo<T = any> {
    /** O que entra no livro/arquivo. */
    docs: T[];
    /** Chegou DEPOIS do corte — nomeado, nunca sumido em silêncio. */
    foraDoCorte: T[];
    /** Instante ilegível — FICA no arquivo, e é dito. */
    semCarimboDeChegada: T[];
    corte: string | null;
    documentosNoCarimbo: number | null;
}

/**
 * Recorta o acervo pelo que o fim de mês congelou.
 *
 * Sem fechamento — ou com a competência REABERTA — devolve tudo intocado: quem
 * não usar o ato gera exatamente como antes.
 */
export function recortarPeloFechamento<T = any>(
    documentos: T[] | null | undefined,
    fechamento: unknown,
): RecorteDoAcervo<T>;

/** A causa junto do número. Nasce VAZIO quando não há fechamento. */
export function avisosDoRecorte(recorte: RecorteDoAcervo | null | undefined): string[];
