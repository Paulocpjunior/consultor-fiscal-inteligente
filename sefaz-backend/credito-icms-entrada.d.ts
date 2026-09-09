export interface CreditoIcmsEntradaCtx {
    /** Vocabulário de regime-tributario.js: SIMPLES · LUCRO_PRESUMIDO · … */
    regime?: string | null;
    direcao?: string | null;
}

export interface CreditoIcmsEntradaResposta {
    credita: boolean;
    motivo: string | null;
    baseLegal: string | null;
}

export function entradaGeraCreditoIcms(ctx?: CreditoIcmsEntradaCtx): CreditoIcmsEntradaResposta;

export function colunaDoCstInformado(
    cst: string | null | undefined,
): 'isentas' | 'outras' | 'tributada' | null;
