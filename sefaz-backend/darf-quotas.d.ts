export const QUOTA_VALOR_MINIMO: number;
export const RECEITAS_TRIMESTRAIS_QUOTA: Set<string>;

/** Lança quando `valor` não é número finito > 0 — plano de R$ 0,00 não avisa ninguém. */
export function dividirEmQuotas(valor: number, n: number): number[];
export function mesDaQuota(anoPA: number, mesPA: number, cota: number): { ano: number; mes: number };
export function vencimentoQuotaTrimestral(anoPA: number, mesPA: number, cota: number): string;

export interface LinhaQuota {
    cota: number | null;
    totalCotas: number | null;
    valorPrincipal: number;
    vencimento: string | null;
    emitirAgora: boolean;
    motivo: string | null;
}

export interface PlanoQuotas {
    quotasEfetivas: number;
    aviso: string | null;
    linhas: LinhaQuota[];
    agora: LinhaQuota[];
    depois: LinhaQuota[];
}

/** Lança quando `valor` é inválido ou `hoje` não é `AAAA-MM-DD` — `hoje` torto
 *  fazia TODA quota sair agora (o defeito que o módulo existe para impedir). */
export function planejarQuotas(p: {
    valor: number; anoPA: number; mesPA: number; quotas?: number; hoje: string; aceitaQuota?: boolean;
}): PlanoQuotas;

export function resumoDoPlano(plano: PlanoQuotas | null): string | null;
