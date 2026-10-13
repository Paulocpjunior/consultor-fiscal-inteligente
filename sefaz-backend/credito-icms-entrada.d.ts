export interface CreditoIcmsEntradaCtx {
    /** Vocabulário de regime-tributario.js: SIMPLES · LUCRO_PRESUMIDO · … */
    regime?: string | null;
    direcao?: string | null;
    /** Cadastro (Dados Fiscais): 'sim' | 'nao' | '' — "nao" tira o crédito de IPI da entrada. */
    contribuinteIpi?: string | null;
}

export interface CreditoIcmsEntradaResposta {
    credita: boolean;
    motivo: string | null;
    baseLegal: string | null;
}

export function entradaGeraCreditoIcms(ctx?: CreditoIcmsEntradaCtx): CreditoIcmsEntradaResposta;

/** Simples ou NÃO contribuinte do IPI declarado no cadastro: o IPI da compra é CUSTO. */
export function entradaGeraCreditoIpi(ctx?: CreditoIcmsEntradaCtx): CreditoIcmsEntradaResposta;

/** O ICMS-ST retido pelo fornecedor nunca é crédito de quem recebe — em regime nenhum. */
export function ICMS_ST_NAO_E_CREDITO(): CreditoIcmsEntradaResposta;

export function colunaDoCstInformado(
    cst: string | null | undefined,
): 'isentas' | 'outras' | 'tributada' | null;
