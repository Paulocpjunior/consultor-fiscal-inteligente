export const QUOTA_VALOR_MINIMO: number;
export const RECEITAS_TRIMESTRAIS_QUOTA: Set<string>;

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

export function planejarQuotas(p: {
    valor: number; anoPA: number; mesPA: number; quotas?: number; hoje: string; aceitaQuota?: boolean;
}): PlanoQuotas;

export function resumoDoPlano(plano: PlanoQuotas | null): string | null;
