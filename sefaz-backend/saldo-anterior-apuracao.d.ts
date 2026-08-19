/**
 * O saldo credor que vem da competência anterior — e o aviso honesto quando o
 * arquivo declara ZERO sem ninguém ter conferido.
 * O `.d.ts` entra no mesmo PR que o módulo (convenção do projeto).
 */

/** Houve movimento no período? (é o que faz o E500/E520 existir) */
export function temMovimento(deb: unknown, cred: unknown): boolean;

export function avisosDeSaldoAnterior(p?: {
    /** O que foi para o E110 campo 10. */
    icmsAnterior?: number;
    /** De onde ele veio — número sem origem não se confere depois. */
    origemIcms?: string;
    /** O que foi para o E520 VL_SD_ANT_IPI (ligado 19/08, caso PWR). */
    ipiAnterior?: number;
    /** De onde ele veio. */
    origemIpi?: string;
    /** O bloco E500/E520 saiu de fato? (nunca "a empresa tem IPI no cadastro") */
    geraIpi?: boolean;
    /** O bloco E200/E210 saiu de fato? */
    geraSt?: boolean;
}): string[];
