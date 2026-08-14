export const ALIQUOTA_ART31: number;
export const ALIQUOTA_CPRB: number;

export interface ConferenciaBaseInss {
    situacao: 'base-e-o-bruto' | 'aliquota-ambigua-cprb-ou-deducao'
        | 'base-deduzida-nao-informada' | 'aliquota-fora-da-regua' | 'sem-dados';
    aliquotaAparente: number | null;
    base: number | null;
    baseOrigem: 'bruto-sem-deducao' | 'derivada-da-retencao' | null;
    indCPRB: number | null;
    exigeAcao: boolean;
    motivo: string;
    acao: string | null;
}

/**
 * A BASE não é o bruto quando houve dedução de material/insumo (IN RFB 971,
 * arts. 121-124) — provado contra o evtServTom aceito de 06/2026, onde o bruto
 * é 5.755,54 e a base é 4.604,43.
 */
export function conferirBaseRetencaoInss(p: { bruto?: number; retido?: number }): ConferenciaBaseInss;
export function normalizarServicoTomado(d: unknown): any;
export function montarPayloadR2010(p: { cnpjTomador?: string; competencia?: string; documentos?: unknown[] }): any;
