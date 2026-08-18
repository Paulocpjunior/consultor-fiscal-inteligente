/**
 * Descrição oficial do CFOP — e a lacuna NOMEADA quando ela não está cadastrada.
 * O `.d.ts` entra no mesmo PR que o módulo.
 */
export const FONTE_CFOP: { titulo: string; url: string };
export const CFOP_DESCRICOES: Record<string, string>;

/** A descrição oficial, ou **null** quando não está cadastrada (nunca uma frase genérica). */
export function descricaoCfop(codigo: unknown): string | null;

/** Quantos códigos o catálogo conhece — é o número que denuncia a lacuna. */
export function tamanhoDoCatalogo(): number;

/** Frase para a tela: descrição quando existe, lacuna nomeada quando não. */
export function textoDoCfop(codigo: unknown): {
    temDescricao: boolean;
    texto: string;
    fonte: { titulo: string; url: string } | null;
};
