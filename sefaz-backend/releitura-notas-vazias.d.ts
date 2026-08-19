/**
 * A régua de quando a releitura do XML guardado resolve a nota "vazia"
 * (sem itens/nº) e quando não resolve. O `.d.ts` entra no mesmo PR (convenção).
 */

/** nNF extraído da chave de acesso (posições 26-34); null quando a chave não tem 44 dígitos. */
export function numeroDaChave(chave: unknown): string | null;

/** Sem itens gravados ou sem número — o alvo da releitura. */
export function ehNotaVazia(d: unknown): boolean;

export type CausaReleitura = 'fora-do-escopo' | 'completa' | 'resumo-gravado' | 'sem-arquivo' | 'alvo';

/** Cada causa tem ação própria — o resultado do botão responde POR CAUSA. */
export function classificarParaReleitura(d: unknown): CausaReleitura;

/** Patch que SÓ preenche o que está vazio (backfill não apaga, 13/08). */
export function patchDaReleitura(
    d: unknown,
    lido?: { itens?: unknown[]; numero?: string | null },
): { itens?: unknown[]; temItens?: boolean; numero?: string };
