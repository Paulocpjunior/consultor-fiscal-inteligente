/**
 * Receita de APLICAÇÃO FINANCEIRA no EFD-Contribuições (CF BANK 1109, 24/08).
 * O `.d.ts` entra no MESMO PR que o módulo — lição do deploy 634.
 */
export const FONTE_APLICACAO_FINANCEIRA: string;

/**
 * Alíquotas da receita de aplicação financeira — DONO ÚNICO.
 * `services/lucroService.ts` (que calcula a guia) importa daqui: duas cópias
 * fariam a guia e o SPED declararem números diferentes sobre o mesmo rendimento.
 */
export const ALIQUOTAS_APLICACAO_FINANCEIRA: { readonly pis: number; readonly cofins: number };

/** CST do F100 — tributável a alíquota DIFERENCIADA. */
export const CST_APLICACAO_FINANCEIRA: '02';

/** COD_CONT do M210/M610 — apuração a alíquota diferenciada (Tabela 4.3.5). */
export const COD_CONT_APLICACAO_FINANCEIRA: '02';

/**
 * Códigos de receita do M205/M605 desta apuração. NUM_CAMPO 08 = não-cumulativa
 * a recolher. ⚠️ NÃO são os do não-cumulativo comum.
 */
export const CODIGOS_RECEITA_APLICACAO_FINANCEIRA: {
    readonly numCampo: string; readonly pis: string; readonly cofins: string;
};

/** A receita de aplicação financeira da competência, nas duas formas da ficha. */
export function receitaFinanceiraDaFicha(ficha: unknown): number;

export function montarReceitaFinanceira(p?: { receita?: number | null }): {
    receita: number; pis: number; cofins: number; cst: string;
    aliqPis: number; aliqCofins: number;
} | null;

/** Natureza da conta — 04 = contas de RESULTADO. */
export const COD_NAT_CC_RESULTADO: '04';
/** Conta ANALÍTICA — a única que um lançamento pode referenciar. */
export const IND_CTA_ANALITICA: 'A';

/**
 * O 0500 da conta da receita financeira. Sem NOME_CTA/NIVEL cadastrados
 * devolve `{falta}` — e aí o COD_CTA também não sai no F100, porque
 * referenciar conta não declarada é a recusa que o 0500 existe para evitar.
 */
export function montar0500ContaReceita(p?: {
    codConta?: string | null; nomeConta?: string | null;
    nivel?: string | number | null; ano?: string | number | null;
}): { campos: {
    dtAlt: string; codNatCc: string; indCta: string;
    nivel: string; codCta: string; nomeCta: string;
} } | { falta: string[]; codConta: string } | null;
