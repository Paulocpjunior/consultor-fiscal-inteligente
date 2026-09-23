export declare const ALIQ_LEGAL: { pis: number; cofins: number; csll: number };
export declare const MIN_MOTIVO: number;

export function decomporCsrf(p?: {
    base?: unknown;
    csrf?: unknown;
    tolerancia?: number;
}): {
    fecha: boolean;
    motivo?: string;
    aliquota?: number | null;
    valores: { pis: number; cofins: number; csll: number } | null;
    soma?: number;
};

export function validarAjusteRetencao(entrada?: Record<string, unknown>): {
    ok: boolean;
    erros: string[];
    valores: {
        ir?: number; pis?: number; cofins?: number; csll?: number; inss?: number;
        motivo: string; autor: string; soma: number; algum: boolean;
    } | null;
};

export type OrigemRetencao =
    | 'ajuste-declarado'
    | 'csrf-decomposta'
    | 'csll-derivada-da-base'
    | 'documento-suspeito'
    | 'documento';

export interface RetencaoEfetiva {
    ir: number;
    pis: number;
    cofins: number;
    csll: number;
    inss: number;
    origem: OrigemRetencao;
    exigeAjuste: boolean;
    ressalva: string | null;
    ajustadoPor?: string | null;
    ajustadoEm?: string | null;
    motivo?: string | null;
    doDocumento: { ir: number; pis: number; cofins: number; csll: number; inss: number };
}

export function retencaoEfetivaDaNota(p?: {
    nota?: Record<string, unknown>;
    /** O diagnóstico de `conferirRetencaoFederal` — é ele que decide a origem. */
    coerencia?: { situacao?: string; motivo?: string; acao?: string | null; exigeAcao?: boolean } | null;
    ajuste?: Record<string, unknown> | null;
}): RetencaoEfetiva;

export function chaveDoAjuste(nota?: Record<string, unknown>): string;

export function resumirRetencoesEfetivas(linhas?: Array<{ retencao?: RetencaoEfetiva }>): {
    ajustadas: number;
    csrfDecomposta: number;
    csllDerivada: number;
    exigemAjuste: number;
};

export function idAjustesDaCompetencia(cnpj: unknown, competencia: unknown): string;
