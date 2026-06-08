/**
 * reformaTributariaConfig — cronograma e aliquotas de transicao da Reforma
 * Tributaria (EC 132/2023 + LC 214/2025).
 *
 * Cronograma resumido (LC 214/2025 art. 343 e seguintes):
 *
 *   2026  fase de TESTE
 *         - CBS = 0,9% e IBS = 0,1% (total nominal 1,0%)
 *         - Valor recolhido eh COMPENSADO com PIS/COFINS apurados no mesmo
 *           periodo - resultado liquido = 0. Empresa apura PIS/COFINS
 *           normalmente; o registro CBS/IBS eh obrigatorio mas nao gera
 *           DARF adicional.
 *
 *   2027  CBS PLENA + extincao PIS/COFINS
 *         - PIS e COFINS sao EXTINTOS.
 *         - CBS entra com aliquota cheia (~9,3% - definida em ato infralegal).
 *         - IS (Imposto Seletivo) entra (alguns produtos).
 *         - IBS continua em fase de testes (0,05% a 0,1%).
 *
 *   2029-2032  IBS gradual + reducao ICMS/ISS
 *         - 2029: ICMS/ISS reduzem 10%; IBS sobe equivalente
 *         - 2030: 20%
 *         - 2031: 30%
 *         - 2032: 40%
 *
 *   2033  IBS PLENO
 *         - ICMS e ISS extintos.
 *         - IBS 100% (~17,7%).
 *
 * Aliquotas indicativas (referencia interna do escritorio - confirmar nos
 * atos infralegais quando publicados; o Senado fixa em Lei Complementar).
 */

export type FaseReforma = 'pre-reforma' | 'teste-2026' | 'cbs-2027' | 'transicao-ibs' | 'reforma-completa';

export interface AliquotasReforma {
    fase: FaseReforma;
    ano: number;
    /** Aliquota CBS (federal). 0 se nao ativa ainda. */
    cbs: number;
    /** Aliquota IBS (estadual+municipal). 0 se nao ativa ainda. */
    ibs: number;
    /** PIS/COFINS ainda vigente? false a partir de 2027. */
    pisCofinsVigente: boolean;
    /**
     * Fator de reducao do ICMS/ISS (0..1). 1 = aliquota cheia, 0 = extinto.
     *  2029 = 0.90, 2030 = 0.80, 2031 = 0.70, 2032 = 0.60, >= 2033 = 0.
     */
    fatorIcmsIss: number;
    /**
     * No periodo de teste 2026, o CBS+IBS recolhido eh compensado com
     * PIS/COFINS - liquido zero no fluxo de caixa.
     */
    compensavelComPisCofins: boolean;
    observacao: string;
}

// Aliquotas indicativas - revisar quando LC 214/2025 tiver atos regulamentares
const CBS_PLENA = 0.088;   // ~8,8% (estimativa Tesouro/Receita)
const IBS_PLENA = 0.177;   // ~17,7%
const IBS_2026 = 0.001;
const IBS_2027 = 0.001;    // ainda em teste em 2027
const CBS_2026 = 0.009;

export function aliquotasReformaPorAno(ano: number): AliquotasReforma {
    if (ano < 2026) {
        return {
            fase: 'pre-reforma', ano,
            cbs: 0, ibs: 0,
            pisCofinsVigente: true,
            fatorIcmsIss: 1,
            compensavelComPisCofins: false,
            observacao: 'PIS/COFINS, ICMS e ISS vigentes (regime antigo).',
        };
    }
    if (ano === 2026) {
        return {
            fase: 'teste-2026', ano,
            cbs: CBS_2026, ibs: IBS_2026,
            pisCofinsVigente: true,
            fatorIcmsIss: 1,
            compensavelComPisCofins: true,
            observacao: 'Fase de teste: CBS 0,9% + IBS 0,1% sao COMPENSADOS com PIS/COFINS no mesmo periodo (liquido R$ 0). Registro obrigatorio.',
        };
    }
    if (ano === 2027 || ano === 2028) {
        return {
            fase: 'cbs-2027', ano,
            cbs: CBS_PLENA, ibs: IBS_2027,
            pisCofinsVigente: false,
            fatorIcmsIss: 1,
            compensavelComPisCofins: false,
            observacao: 'PIS/COFINS EXTINTOS. CBS plena (~8,8%). IBS em teste (0,1%). ICMS e ISS vigentes.',
        };
    }
    if (ano >= 2029 && ano <= 2032) {
        const reducaoPorAno = (ano - 2028) * 0.10;   // 2029=10%, 2030=20%...
        const fator = 1 - reducaoPorAno;
        const proporcaoIbs = 1 - fator;
        return {
            fase: 'transicao-ibs', ano,
            cbs: CBS_PLENA,
            ibs: IBS_PLENA * proporcaoIbs,
            pisCofinsVigente: false,
            fatorIcmsIss: fator,
            compensavelComPisCofins: false,
            observacao: `Transicao IBS: ICMS/ISS a ${(fator * 100).toFixed(0)}% e IBS a ${(proporcaoIbs * 100).toFixed(0)}%.`,
        };
    }
    return {
        fase: 'reforma-completa', ano,
        cbs: CBS_PLENA, ibs: IBS_PLENA,
        pisCofinsVigente: false,
        fatorIcmsIss: 0,
        compensavelComPisCofins: false,
        observacao: 'ICMS e ISS EXTINTOS. IBS pleno (~17,7%) + CBS pleno (~8,8%).',
    };
}

/**
 * Faz parse de competencia "MM/YYYY" e devolve as aliquotas vigentes.
 * Para tirar duvidas em telas que mostram impostos por competencia.
 */
export function aliquotasReformaPorCompetencia(competencia: string): AliquotasReforma {
    const ano = parseInt(competencia.split('/')[1] || String(new Date().getFullYear()), 10);
    return aliquotasReformaPorAno(isNaN(ano) ? new Date().getFullYear() : ano);
}

/**
 * Devolve uma string curta de status pra exibir em UI (banner/badge).
 */
export function statusReforma(ano: number = new Date().getFullYear()): string {
    const a = aliquotasReformaPorAno(ano);
    switch (a.fase) {
        case 'pre-reforma': return 'Pre-reforma';
        case 'teste-2026': return 'Teste CBS/IBS (compensavel)';
        case 'cbs-2027': return 'CBS plena - PIS/COFINS extintos';
        case 'transicao-ibs': return `Transicao IBS (${a.ano - 2028}/4)`;
        case 'reforma-completa': return 'Reforma completa';
    }
}
