/**
 * Descrição oficial do CFOP (Anexo II do Convênio s/nº 15/12/1970, redação do
 * Ajuste SINIEF 03/24) — e a AUSÊNCIA nomeada quando o código não consta.
 * O `.d.ts` entra no mesmo PR que o módulo.
 */
export const FONTE_CFOP: { titulo: string; url: string; redacao: string };
export const CFOP_DESCRICOES: Record<string, string>;

/** A descrição oficial, ou **null** quando o código NÃO CONSTA da tabela em vigor. */
export function descricaoCfop(codigo: unknown): string | null;

/** O código consta da tabela em vigor? */
export function cfopExiste(codigo: unknown): boolean;

/** Quantos códigos o catálogo conhece. */
export function tamanhoDoCatalogo(): number;

/** Frase para a tela: descrição quando existe, ausência nomeada quando não. */
export function textoDoCfop(codigo: unknown): {
    temDescricao: boolean;
    texto: string;
    fonte: { titulo: string; url: string; redacao: string } | null;
};

/** Os CFOPs de uma lista que NÃO constam da tabela — a conferência contra a NORMA. */
export function cfopsInexistentes(codigos: Array<string | number | null | undefined>): string[];
