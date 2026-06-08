import { LucroInput, LucroResult, DetalheImposto, PlanoCotas, ItemFinanceiroAvulso } from '../types';

// Alíquotas Base
const ALIQ_PIS_CUMULATIVO = 0.0065; // 0.65%
const ALIQ_COFINS_CUMULATIVO = 0.03; // 3.00%

const ALIQ_PIS_NAO_CUMULATIVO = 0.0165; // 1.65%
const ALIQ_COFINS_NAO_CUMULATIVO = 0.076; // 7.60%

const ALIQ_IRPJ = 0.15; // 15%
const ADICIONAL_IRPJ = 0.10; // 10%
const ALIQ_CSLL = 0.09; // 9%

// Alíquotas Especiais
const ALIQ_PIS_APLICACAO = 0.0065;
const ALIQ_COFINS_APLICACAO = 0.04;
const ALIQ_PIS_IMPORTACAO = 0.021;
const ALIQ_COFINS_IMPORTACAO = 0.0965;

// Limites Adicional IRPJ (Conforme Legislação)
const LIMITE_ADICIONAL_MENSAL = 20000;
const LIMITE_ADICIONAL_TRIMESTRAL = 60000;

// Presunção Lucro Presumido
const PRESUNCAO_IRPJ_COMERCIO = 0.08;
const PRESUNCAO_IRPJ_INDUSTRIA = 0.08;
const PRESUNCAO_IRPJ_SERVICO_PADRAO = 0.32;
const PRESUNCAO_IRPJ_SERVICO_REDUZIDA = 0.16; // IN RFB 1.700/17 (Receita <= 120k)

const PRESUNCAO_CSLL_COMERCIO = 0.12;
const PRESUNCAO_CSLL_INDUSTRIA = 0.12;
const PRESUNCAO_CSLL_SERVICO = 0.32;

// Presunção Equiparação Hospitalar
const PRESUNCAO_IRPJ_HOSPITALAR = 0.08;
const PRESUNCAO_CSLL_HOSPITALAR = 0.12;

// ============================================================================
// MAJORAÇÃO LC 224/2025 + IN RFB 2.305/2025 + IN RFB 2.306/2026
// ----------------------------------------------------------------------------
// Acréscimo de 10% nos percentuais de presunção de IRPJ e CSLL,
// incidente APENAS sobre a parcela da receita bruta que exceder R$ 5.000.000
// no ano-calendário (R$ 1.250.000 proporcional por trimestre).
//
// VIGÊNCIA ASSIMÉTRICA EM 2026:
//   - IRPJ: desde 01/01/2026 (1T) → limite anual R$ 5.000.000
//   - CSLL: desde 01/04/2026 (2T) → limite anual R$ 3.750.000 (3/4 do padrão)
// ============================================================================
const FATOR_AUMENTO_PRESUNCAO_LC224 = 1.10;
const LIMITE_ANUAL_LC224_PADRAO = 5_000_000;
const LIMITE_ANUAL_LC224_CSLL_2026 = 3_750_000;
const SUBLIMITE_TRIMESTRAL_LC224 = 1_250_000; // IN RFB 2.305/2025, art. 15 §2º

type TributoLC224 = 'IRPJ' | 'CSLL';

/**
 * Determina se a majoração da LC 224/2025 está vigente para o tributo na competência.
 * Respeita a anterioridade nonagesimal da CSLL em 2026.
 */
const majoracaoLc224Vigente = (tributo: TributoLC224, ano: number, trimestre: number): boolean => {
    if (ano < 2026) return false;
    if (ano === 2026) {
        if (tributo === 'IRPJ') return true;           // vigente desde 1T/2026
        if (tributo === 'CSLL') return trimestre >= 2;  // vigente desde 2T/2026
    }
    return true; // 2027+ ambos vigentes
};

const obterLimiteAnualLc224 = (tributo: TributoLC224, ano: number): number => {
    if (tributo === 'CSLL' && ano === 2026) return LIMITE_ANUAL_LC224_CSLL_2026;
    return LIMITE_ANUAL_LC224_PADRAO;
};

/**
 * Calcula a proporção da receita do TRIMESTRE atual que deve sofrer presunção majorada,
 * conforme IN RFB 2.305/2025 art. 15 §§ 1º a 4º (com redação da IN 2.306/2026):
 *
 * - § 2º: sublimite trimestral de R$ 1.250.000.
 * - § 3º: receita superior ao sublimite → majora APENAS o excedente.
 * - § 4º: receita inferior ao sublimite → diferença vira carry-forward para os
 *         trimestres seguintes do mesmo ano-calendário.
 * - Regra dos trimestres subsequentes (consolidada pela RFB): uma vez ultrapassado
 *   o limite anual, 100% da receita dos trimestres seguintes é majorada.
 *
 * Para apuração mensal: aplicamos sublimite proporcional ao mês (1/3 do trimestral).
 *
 * @param receitaPeriodoAtual receita bruta do trimestre (ou mês) que sofre presunção
 * @param receitaAnoAcumuladaAnterior receita bruta acumulada nos períodos ANTERIORES do mesmo ano
 * @param tributo IRPJ ou CSLL (define o limite anual aplicável)
 * @param ano ano-calendário
 * @param trimestre 1 a 4
 * @param periodoApuracao 'Mensal' ou 'Trimestral'
 */
const calcularProporcaoMajoradaLc224 = (
    receitaPeriodoAtual: number,
    receitaAnoAcumuladaAnterior: number,
    tributo: TributoLC224,
    ano: number,
    trimestre: number,
    periodoApuracao: 'Mensal' | 'Trimestral'
): number => {
    if (receitaPeriodoAtual <= 0) return 0;
    if (!majoracaoLc224Vigente(tributo, ano, trimestre)) return 0;

    const limiteAnual = obterLimiteAnualLc224(tributo, ano);

    // Regra dos trimestres subsequentes: limite anual já estourado em períodos anteriores
    // → 100% da receita do período atual é majorada (independente do sublimite).
    if (receitaAnoAcumuladaAnterior >= limiteAnual) {
        return 1;
    }

    // Sublimite acumulado proporcional para verificação trimestral (art. 15 §§ 1º-2º).
    // Para o IRPJ: 1.250.000 × N (onde N = trimestre atual).
    // Para a CSLL em 2026: o limite anual reduzido (3,75 mi) é distribuído nos 3 trimestres
    //   em que a majoração vigora (2T, 3T, 4T) → mantém-se o sublimite de 1,25 mi/trimestre.
    //
    // NOTA: a LC 224/25 majora a PRESUNÇÃO do Lucro Presumido. Lucro Presumido
    // e trimestral por lei (Lei 9.430/96 art. 1º). Lucro Real nao usa presuncao
    // (logo nao chama esta funcao). Portanto periodoApuracao aqui e sempre
    // 'Trimestral' na pratica. O parametro fica preservado pra compat futura
    // (caso a Receita venha a regulamentar apuracao mensal).
    const sublimiteAcumuladoAteAgora = SUBLIMITE_TRIMESTRAL_LC224 * trimestre;
    const sublimiteDisponivelPeriodo = sublimiteAcumuladoAteAgora - receitaAnoAcumuladaAnterior;

    if (receitaPeriodoAtual <= sublimiteDisponivelPeriodo) return 0;
    if (sublimiteDisponivelPeriodo < 0) return 1; // já estourou todo o sublimite acumulado

    const excedente = receitaPeriodoAtual - sublimiteDisponivelPeriodo;
    return Math.min(1, Math.max(0, excedente / receitaPeriodoAtual));
};

/**
 * Aplica a majoração proporcional a uma base presumida.
 * Se proporcaoMajorada = 0 → retorna base * presunção normal.
 * Se proporcaoMajorada = 1 → retorna base * presunção majorada (presunção * 1,10).
 * Caso intermediário → rateia proporcionalmente.
 */
const aplicarMajoracaoProporcional = (
    base: number,
    presuncaoNormal: number,
    proporcaoMajorada: number
): number => {
    if (base <= 0) return 0;
    const presuncaoMajorada = presuncaoNormal * FATOR_AUMENTO_PRESUNCAO_LC224;
    const parcelaNormal = base * (1 - proporcaoMajorada) * presuncaoNormal;
    const parcelaMajorada = base * proporcaoMajorada * presuncaoMajorada;
    return parcelaNormal + parcelaMajorada;
};

/**
 * Extrai ano e trimestre de uma string no formato "YYYY-MM".
 * Retorna { ano: 0, trimestre: 0 } se inválido.
 */
const extrairAnoTrimestre = (mesReferencia?: string): { ano: number; trimestre: number } => {
    if (!mesReferencia) return { ano: 0, trimestre: 0 };
    const parts = mesReferencia.split('-');
    const ano = parseInt(parts[0] || '0');
    const mes = parseInt(parts[1] || '0');
    if (!ano || !mes) return { ano, trimestre: 0 };
    const trimestre = Math.ceil(mes / 3);
    return { ano, trimestre };
};

const fmt = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

/**
 * Calcula se o imposto pode ser parcelado em quotas
 * Regra Solicitada: > 10k (Mensal) ou > 30k (Trimestral)
 * Regra Legal Mínima: Parcela > R$ 1.000,00
 */
export const calcularCotasDisponiveis = (valorImposto: number, periodo: 'Mensal' | 'Trimestral'): PlanoCotas | undefined => {
    // Cotas só fazem sentido para apuração TRIMESTRAL de IRPJ/CSLL.
    if (periodo !== 'Trimestral') return undefined;

    const numCotas = 3;
    const valorCota = valorImposto / numCotas;

    // Receita Federal: cada cota deve ser >= R$ 1.000,00.
    // Permite parcelar sempre que o valor trimestral total for >= R$ 3.000,00,
    // garantindo que CSLL apareça com a mesma opção do IRPJ quando aplicável.
    if (valorCota < 1000) return undefined;

    return {
        disponivel: true,
        numeroCotas: numCotas,
        valorPrimeiraCota: valorCota,
        valorDemaisCotas: valorCota,
        // Lei 9.430/96 art. 5o §2o: 1a cota sem juros. Demais ganham SELIC
        // acumulada do(s) mes(es) anterior(es) + 1% no mes do pagamento.
        // Labels antigos diziam "Juros 1%" puro (errado).
        vencimentos: [
            'Quota Única ou 1ª Quota (Sem Juros)',
            '2ª Quota (SELIC do mes anterior + 1% no mes do pagamento)',
            '3ª Quota (SELIC acumulada 2 meses + 1% no mes do pagamento)',
        ],
    };
};

const calcularISS = (input: LucroInput): DetalheImposto | null => {
    if (input.issConfig.tipo === 'sup_fixo') {
        const qtde = input.issConfig.qtdeSocios || 0;
        const valorPorSocio = input.issConfig.valorPorSocio || 0;
        const valorTotal = qtde * valorPorSocio;

        if (valorTotal <= 0) return null;

        return {
            imposto: 'ISS-SUP (Fixo por Sócio)',
            baseCalculo: qtde,
            aliquota: 0,
            valor: valorTotal,
            observacao: `${qtde} sócio(s) x ${fmt(valorPorSocio)}`
        };
    } else {
        const aliquota = input.issConfig.aliquota || 0;

        const baseIss = input.faturamentoServico + (input.faturamentoServicoHospitalar || 0) +
                        (input.faturamentoFiliais?.servicoHospitalar || 0);

        if (baseIss <= 0 || aliquota <= 0) return null;

        return {
            imposto: `ISS (${aliquota}%)`,
            baseCalculo: baseIss,
            aliquota: aliquota,
            valor: baseIss * (aliquota / 100),
            observacao: 'Incide apenas sobre serviços próprios (sem retenção) e hospitalares.'
        };
    }
};

export const calcularLucro = (input: LucroInput): LucroResult => {
    let result: LucroResult;
    if (input.regimeSelecionado === 'Real') {
        result = calcularLucroReal(input);
    } else {
        result = calcularLucroPresumido(input);
    }

    // Aplica lógica de cotas nos impostos federais (IRPJ/CSLL)
    result.detalhamento = result.detalhamento.map(det => {
        if (det.imposto.includes('IRPJ') || det.imposto.includes('CSLL')) {
            return {
                ...det,
                cotaInfo: calcularCotasDisponiveis(det.valor, input.periodoApuracao)
            };
        }
        return det;
    });

    return result;
};

const calcularLucroPresumido = (input: LucroInput): LucroResult => {
    // 1. Consolidar Faturamento Global do Mês (Matriz + Filiais) - VALOR DA NOTA (INCLUINDO IPI)
    const fatComercioMes = input.faturamentoComercio + (input.faturamentoFiliais?.comercio || 0);
    const fatIndustriaMes = input.faturamentoIndustria + (input.faturamentoFiliais?.industria || 0);

    // Serviços: Consolida todas as vertentes para cálculo federal
    const fatServicoProprio = input.faturamentoServico + (input.faturamentoFiliais?.servico || 0);
    const fatServicoRetido = (input.faturamentoServicoRetido || 0) + (input.faturamentoFiliais?.servicoRetido || 0);
    const fatLocacao = (input.faturamentoLocacao || 0) + (input.faturamentoFiliais?.locacao || 0);

    const fatServicoMesTotal = fatServicoProprio + fatServicoRetido + fatLocacao;

    const fatServicoHospMes = (input.faturamentoServicoHospitalar || 0) + (input.faturamentoFiliais?.servicoHospitalar || 0);

    // Total Faturado Bruto (Antes de Deduções)
    const totalFaturadoInputs = fatComercioMes + fatIndustriaMes + fatServicoMesTotal + fatServicoHospMes;

    // 2. Aplicação de Deduções da Receita Bruta (IPI e Devoluções)
    const valorIpi = input.valorIpi || 0;
    const valorDevolucoes = input.valorDevolucoes || 0;

    let fatIndustriaDeduzidoIpi = Math.max(0, fatIndustriaMes - valorIpi);
    let restoDeducaoIpi = Math.max(0, valorIpi - fatIndustriaMes);

    const totalSemIpi = totalFaturadoInputs - valorIpi;

    const ratioComercio = totalSemIpi > 0 ? fatComercioMes / totalSemIpi : 0;
    const ratioIndustria = totalSemIpi > 0 ? fatIndustriaDeduzidoIpi / totalSemIpi : 0;
    const ratioServico = totalSemIpi > 0 ? fatServicoMesTotal / totalSemIpi : 0;
    const ratioServicoHosp = totalSemIpi > 0 ? fatServicoHospMes / totalSemIpi : 0;

    // Bases Finais para Presunção (Líquidas de IPI e Devoluções, mas COM ICMS) -> Base IRPJ/CSLL
    const baseComercioFinal = Math.max(0, fatComercioMes - (valorDevolucoes * ratioComercio) - (restoDeducaoIpi > 0 ? restoDeducaoIpi : 0));
    const baseIndustriaFinal = Math.max(0, fatIndustriaDeduzidoIpi - (valorDevolucoes * ratioIndustria));
    const baseServicoFinal = Math.max(0, fatServicoMesTotal - (valorDevolucoes * ratioServico));
    const baseServicoHospFinal = Math.max(0, fatServicoHospMes - (valorDevolucoes * ratioServicoHosp));

    const receitaBrutaEfetiva = baseComercioFinal + baseIndustriaFinal + baseServicoFinal + baseServicoHospFinal;
    const receitaTotalMes = receitaBrutaEfetiva + (input.receitaFinanceira || 0);

    const detalhamento: DetalheImposto[] = [];

    // ========================================================================
    // ANÁLISE DA MAJORAÇÃO LC 224/2025 (separada para IRPJ e CSLL)
    // Conforme IN RFB 2.305/2025 art. 15 §§ 1º-4º (com redação da IN 2.306/2026):
    //   - Sublimite trimestral de R$ 1.250.000 (§2º)
    //   - Majora apenas o EXCEDENTE do sublimite trimestral (§3º)
    //   - Diferença não usada vira carry-forward (§4º)
    // ========================================================================
    const { ano, trimestre } = extrairAnoTrimestre(input.mesReferencia);

    // Soma do acumulado trimestral informado pela UI (meses anteriores DESTE trimestre).
    const somaAcumuladoTrimestre = input.acumuladoTrimestre
        ? (input.acumuladoTrimestre.comercio || 0)
          + (input.acumuladoTrimestre.industria || 0)
          + (input.acumuladoTrimestre.servico || 0)
          + (input.acumuladoTrimestre.servicoHospitalar || 0)
        : 0;

    // Receita BRUTA do período de apuração para fins da majoração:
    //   - Se Trimestral: receita do mês + acumulado trimestral (= receita bruta do trimestre)
    //   - Se Mensal: receita do mês apenas
    // Não inclui receita financeira (não sofre presunção, vide art. 15 caput LC 224/25).
    const receitaPeriodoParaLc224 = input.periodoApuracao === 'Trimestral'
        ? receitaBrutaEfetiva + somaAcumuladoTrimestre
        : receitaBrutaEfetiva;

    // Receita acumulada do ANO nos períodos ANTERIORES (do mesmo ano-calendário).
    // - Em apuração trimestral, isso é o faturamento dos trimestres anteriores.
    // - Em apuração mensal, é o faturamento dos meses anteriores do ano.
    // O usuário informa via campo "acumuladoAno" no dashboard.
    const receitaAnoAcumuladaAnterior = input.acumuladoAno || 0;

    const proporcaoMajoradaIrpj = calcularProporcaoMajoradaLc224(
        receitaPeriodoParaLc224,
        receitaAnoAcumuladaAnterior,
        'IRPJ',
        ano,
        trimestre,
        input.periodoApuracao
    );

    const proporcaoMajoradaCsll = calcularProporcaoMajoradaLc224(
        receitaPeriodoParaLc224,
        receitaAnoAcumuladaAnterior,
        'CSLL',
        ano,
        trimestre,
        input.periodoApuracao
    );

    const aplicouLc224 = proporcaoMajoradaIrpj > 0 || proporcaoMajoradaCsll > 0;

    // ISS
    const issItem = calcularISS(input);
    if (issItem) detalhamento.push(issItem);

    const retencaoPis = input.retencaoPis || 0;
    const retencaoCofins = input.retencaoCofins || 0;
    const retencaoIrpj = input.retencaoIrpj || 0;
    const retencaoCsll = input.retencaoCsll || 0;

    // PIS/COFINS (inalterados pela LC 224)
    const icmsVendas = input.icmsVendas || 0;
    const valorMonofasico = input.faturamentoMonofasico || 0;
    const basePisCofins = Math.max(0, receitaBrutaEfetiva - icmsVendas - valorMonofasico);

    const obsPisCofinsBase = icmsVendas > 0 ? `Base Deduzida de ICMS (${fmt(icmsVendas)}). ` : `Base: Receita Bruta Efetiva. `;
    const obsPisCofinsMonofasico = valorMonofasico > 0 ? `Deduzido Monofásico (${fmt(valorMonofasico)}). ` : '';

    if (basePisCofins > 0) {
        detalhamento.push({
            imposto: 'PIS (Cumulativo)',
            baseCalculo: basePisCofins,
            aliquota: ALIQ_PIS_CUMULATIVO * 100,
            valor: Math.max(0, (basePisCofins * ALIQ_PIS_CUMULATIVO) - retencaoPis),
            observacao: obsPisCofinsBase + obsPisCofinsMonofasico + (retencaoPis > 0 ? `Retenção abatida: ${fmt(retencaoPis)}` : '')
        });
        detalhamento.push({
            imposto: 'COFINS (Cumulativo)',
            baseCalculo: basePisCofins,
            aliquota: ALIQ_COFINS_CUMULATIVO * 100,
            valor: Math.max(0, (basePisCofins * ALIQ_COFINS_CUMULATIVO) - retencaoCofins),
            observacao: obsPisCofinsBase + obsPisCofinsMonofasico + (retencaoCofins > 0 ? `Retenção abatida: ${fmt(retencaoCofins)}` : '')
        });
    }

    processarItensEspeciais(input.itensAvulsos, detalhamento);

    // ========================================================================
    // IRPJ / CSLL — Base de Presunção com majoração LC 224 proporcional
    // ========================================================================
    let baseCalculoIrpjComercio = baseComercioFinal;
    let baseCalculoIrpjIndustria = baseIndustriaFinal;
    let baseCalculoIrpjServico = baseServicoFinal;
    let baseCalculoIrpjServicoHosp = baseServicoHospFinal;
    let baseCalculoReceitaFinanceira = input.receitaFinanceira || 0;

    let obsTrimestre = "";

    if (input.periodoApuracao === 'Trimestral' && input.acumuladoTrimestre) {
        baseCalculoIrpjComercio += input.acumuladoTrimestre.comercio;
        baseCalculoIrpjIndustria += input.acumuladoTrimestre.industria;
        baseCalculoIrpjServico += input.acumuladoTrimestre.servico;
        baseCalculoIrpjServicoHosp += (input.acumuladoTrimestre.servicoHospitalar || 0);
        baseCalculoReceitaFinanceira += input.acumuladoTrimestre.financeira;
        obsTrimestre = ` (Inclui Out/Nov/Dez)`;
    }

    const presuncaoServicoUsada = input.isPresuncaoReduzida16
        ? PRESUNCAO_IRPJ_SERVICO_REDUZIDA
        : PRESUNCAO_IRPJ_SERVICO_PADRAO;

    // --- IRPJ: aplica majoração apenas sobre a proporção excedente ---
    const baseIrpjComercio = aplicarMajoracaoProporcional(baseCalculoIrpjComercio, PRESUNCAO_IRPJ_COMERCIO, proporcaoMajoradaIrpj);
    const baseIrpjIndustria = aplicarMajoracaoProporcional(baseCalculoIrpjIndustria, PRESUNCAO_IRPJ_INDUSTRIA, proporcaoMajoradaIrpj);
    const baseIrpjServico = aplicarMajoracaoProporcional(baseCalculoIrpjServico, presuncaoServicoUsada, proporcaoMajoradaIrpj);
    const baseIrpjServicoHosp = aplicarMajoracaoProporcional(baseCalculoIrpjServicoHosp, PRESUNCAO_IRPJ_HOSPITALAR, proporcaoMajoradaIrpj);

    const baseIrpjTotal = baseIrpjComercio + baseIrpjIndustria + baseIrpjServico + baseIrpjServicoHosp + baseCalculoReceitaFinanceira;

    if (baseIrpjTotal > 0) {
        let valorIrpj = baseIrpjTotal * ALIQ_IRPJ;
        const limiteAdicional = input.periodoApuracao === 'Trimestral' ? LIMITE_ADICIONAL_TRIMESTRAL : LIMITE_ADICIONAL_MENSAL;

        if (baseIrpjTotal > limiteAdicional) {
            valorIrpj += (baseIrpjTotal - limiteAdicional) * ADICIONAL_IRPJ;
        }

        const obsHosp = baseIrpjServicoHosp > 0 ? " + Hosp. 8%" : "";
        const obsReduzida = input.isPresuncaoReduzida16 ? " (Reduzida 16% R$120k)" : "";
        const obsLc224Irpj = proporcaoMajoradaIrpj > 0
            ? ` LC 224/25: ${(proporcaoMajoradaIrpj * 100).toFixed(1)}% da receita com presunção majorada (+10%).`
            : '';

        detalhamento.push({
            imposto: `IRPJ (${input.periodoApuracao})`,
            baseCalculo: baseIrpjTotal,
            aliquota: ALIQ_IRPJ * 100,
            valor: Math.max(0, valorIrpj - retencaoIrpj),
            observacao: `Base Bruta${obsHosp}${obsReduzida}.${obsTrimestre}${obsLc224Irpj} Isenção: ${fmt(limiteAdicional)}` + (retencaoIrpj > 0 ? `. Retenção abatida: ${fmt(retencaoIrpj)}` : '')
        });
    }

    // --- CSLL: aplica majoração apenas sobre a proporção excedente (com limite próprio em 2026) ---
    const baseCsllComercio = aplicarMajoracaoProporcional(baseCalculoIrpjComercio, PRESUNCAO_CSLL_COMERCIO, proporcaoMajoradaCsll);
    const baseCsllIndustria = aplicarMajoracaoProporcional(baseCalculoIrpjIndustria, PRESUNCAO_CSLL_INDUSTRIA, proporcaoMajoradaCsll);
    const baseCsllServico = aplicarMajoracaoProporcional(baseCalculoIrpjServico, PRESUNCAO_CSLL_SERVICO, proporcaoMajoradaCsll);
    const baseCsllServicoHosp = aplicarMajoracaoProporcional(baseCalculoIrpjServicoHosp, PRESUNCAO_CSLL_HOSPITALAR, proporcaoMajoradaCsll);

    const baseCsllTotal = baseCsllComercio + baseCsllIndustria + baseCsllServico + baseCsllServicoHosp + baseCalculoReceitaFinanceira;

    if (baseCsllTotal > 0) {
        const obsHosp = baseCsllServicoHosp > 0 ? " + Hosp. 12%" : "";
        const obsLc224Csll = proporcaoMajoradaCsll > 0
            ? ` LC 224/25: ${(proporcaoMajoradaCsll * 100).toFixed(1)}% da receita com presunção majorada (+10%).`
            : (ano === 2026 && trimestre === 1
                ? ' LC 224/25 não aplicada à CSLL no 1T/2026 (anterioridade nonagesimal).'
                : '');

        detalhamento.push({
            imposto: `CSLL (${input.periodoApuracao})`,
            baseCalculo: baseCsllTotal,
            aliquota: ALIQ_CSLL * 100,
            valor: Math.max(0, (baseCsllTotal * ALIQ_CSLL) - retencaoCsll),
            observacao: `Base Bruta${obsHosp}.${obsTrimestre}${obsLc224Csll}` + (retencaoCsll > 0 ? `. Retenção abatida: ${fmt(retencaoCsll)}` : '')
        });
    }

    // ADICIONAR IMPOSTOS INFORMATIVOS (MANUAIS) AO RESULTADO FINAL
    if (input.icmsProprioRecolher && input.icmsProprioRecolher > 0) {
        const saldoIcms = input.saldoCredorIcms || 0;
        const icmsPagar = Math.max(0, input.icmsProprioRecolher - saldoIcms);
        detalhamento.push({
            imposto: 'ICMS Próprio',
            baseCalculo: 0,
            aliquota: 0,
            valor: icmsPagar,
            observacao: saldoIcms > 0 ? `Abatido Saldo Credor de ${fmt(saldoIcms)}` : 'Valor informado (Apuração Fiscal)'
        });
    }
    if (input.icmsStRecolher && input.icmsStRecolher > 0) {
        detalhamento.push({
            imposto: 'ICMS ST',
            baseCalculo: 0,
            aliquota: 0,
            valor: input.icmsStRecolher,
            observacao: 'Valor informado (Apuração Fiscal)'
        });
    }
    if (input.ipiRecolher && input.ipiRecolher > 0) {
        const saldoIpi = input.saldoCredorIpi || 0;
        const ipiPagar = Math.max(0, input.ipiRecolher - saldoIpi);
        detalhamento.push({
            imposto: 'IPI',
            baseCalculo: 0,
            aliquota: 0,
            valor: ipiPagar,
            observacao: saldoIpi > 0 ? `Abatido Saldo Credor de ${fmt(saldoIpi)}` : 'Valor informado (Apuração Fiscal)'
        });
    }

    const totalImpostos = detalhamento.reduce((acc, item) => acc + item.valor, 0);
    const extraReceitas = (input.itensAvulsos || []).filter(i => i.tipo === 'receita').reduce((acc, i) => acc + i.valor, 0);
    const extraDespesas = (input.itensAvulsos || []).filter(i => i.tipo === 'despesa').reduce((acc, i) => acc + i.valor, 0);

    const lucroLiquido = (receitaTotalMes + extraReceitas) - input.custoMercadoriaVendida - input.despesasOperacionais - input.folhaPagamento - extraDespesas - totalImpostos;

    return {
        regime: 'Presumido',
        periodo: input.periodoApuracao,
        detalhamento,
        totalImpostos,
        cargaTributaria: receitaTotalMes > 0 ? (totalImpostos / receitaTotalMes) * 100 : 0,
        lucroLiquidoEstimado: lucroLiquido,
        alertaLc224: aplicouLc224
    };
};

const calcularLucroReal = (input: LucroInput): LucroResult => {
    const fatComercio = input.faturamentoComercio + (input.faturamentoFiliais?.comercio || 0);
    const fatIndustria = input.faturamentoIndustria + (input.faturamentoFiliais?.industria || 0);

    const fatServicoTotal = input.faturamentoServico + (input.faturamentoFiliais?.servico || 0) +
                            (input.faturamentoServicoRetido || 0) + (input.faturamentoFiliais?.servicoRetido || 0) +
                            (input.faturamentoLocacao || 0) + (input.faturamentoFiliais?.locacao || 0);

    const fatServicoHosp = (input.faturamentoServicoHospitalar || 0) + (input.faturamentoFiliais?.servicoHospitalar || 0);

    const faturamentoBrutoInput = fatComercio + fatIndustria + fatServicoTotal + fatServicoHosp;

    const receitaLiquida = Math.max(0, faturamentoBrutoInput - (input.valorIpi || 0) - (input.valorDevolucoes || 0));

    const detalhamento: DetalheImposto[] = [];

    const issItem = calcularISS(input);
    if (issItem) detalhamento.push(issItem);

    const extraDespesasDedutiveis = (input.itensAvulsos || [])
        .filter(i => i.tipo === 'despesa' && i.dedutivelIrpj)
        .reduce((acc, i) => acc + i.valor, 0);

    const extraBaseCredito = (input.itensAvulsos || [])
        .filter(i => i.tipo === 'despesa' && i.geraCreditoPisCofins)
        .reduce((acc, i) => acc + i.valor, 0);

    const totalReceitas = receitaLiquida + (input.receitaFinanceira || 0) + (input.itensAvulsos || []).filter(i => i.tipo === 'receita').reduce((acc, i) => acc + i.valor, 0);

    const icmsVendas = input.icmsVendas || 0;
    const basePisCofins = Math.max(0, receitaLiquida - icmsVendas - (input.faturamentoMonofasico || 0));
    // Base de credito PIS/COFINS no Lucro Real - Lei 10.637/02 art. 3 e Lei 10.833/03 art. 3.
    // Se o front separou (despesasGeramCreditoPisCofins definido), usa o campo
    // segregado. Caso contrario, cai em despesasDedutiveis com SUBTRACAO da folha
    // (art. 3 §2 I veda credito sobre mao-de-obra PF). Compat temporaria; quando
    // toda a base migrar para o campo segregado, removemos o fallback.
    const baseCredito = (input.despesasGeramCreditoPisCofins !== undefined)
        ? input.despesasGeramCreditoPisCofins + extraBaseCredito
        : Math.max(0, input.despesasDedutiveis - (input.folhaPagamento || 0)) + extraBaseCredito;

    // Saldos credores do mês anterior (abate débito atual)
    const saldoAbatidoPis = input.saldoCredorPis || 0;
    const saldoAbatidoCofins = input.saldoCredorCofins || 0;

    // Bruto = débito - crédito - retenção - saldo credor anterior
    const pisBruto = (basePisCofins * ALIQ_PIS_NAO_CUMULATIVO)
                   - (baseCredito * ALIQ_PIS_NAO_CUMULATIVO)
                   - (input.retencaoPis || 0)
                   - saldoAbatidoPis;
    const cofinsBruto = (basePisCofins * ALIQ_COFINS_NAO_CUMULATIVO)
                      - (baseCredito * ALIQ_COFINS_NAO_CUMULATIVO)
                      - (input.retencaoCofins || 0)
                      - saldoAbatidoCofins;

    // Se o bruto ficou negativo, vira saldo residual pro próximo mês
    const residualPis = pisBruto < 0 ? Math.abs(pisBruto) : 0;
    const residualCofins = cofinsBruto < 0 ? Math.abs(cofinsBruto) : 0;

    const obsSaldoPis = saldoAbatidoPis > 0 ? ` Saldo credor anterior abatido: ${fmt(saldoAbatidoPis)}.` : '';
    const obsResidPis = residualPis > 0 ? ` Saldo credor p/ próx. mês: ${fmt(residualPis)}.` : '';
    const obsSaldoCofins = saldoAbatidoCofins > 0 ? ` Saldo credor anterior abatido: ${fmt(saldoAbatidoCofins)}.` : '';
    const obsResidCofins = residualCofins > 0 ? ` Saldo credor p/ próx. mês: ${fmt(residualCofins)}.` : '';

    detalhamento.push({
        imposto: 'PIS (Lucro Real)',
        baseCalculo: basePisCofins,
        aliquota: ALIQ_PIS_NAO_CUMULATIVO * 100,
        valor: Math.max(0, pisBruto),
        observacao: `Mensal - Crédito sobre despesas. Deduzido ICMS.` + obsSaldoPis + obsResidPis + (input.retencaoPis ? ` Retenção abatida: ${fmt(input.retencaoPis)}` : '')
    });

    detalhamento.push({
        imposto: 'COFINS (Lucro Real)',
        baseCalculo: basePisCofins,
        aliquota: ALIQ_COFINS_NAO_CUMULATIVO * 100,
        valor: Math.max(0, cofinsBruto),
        observacao: `Mensal - Crédito sobre despesas. Deduzido ICMS.` + obsSaldoCofins + obsResidCofins + (input.retencaoCofins ? ` Retenção abatida: ${fmt(input.retencaoCofins)}` : '')
    });

    if (input.receitaFinanceira && input.receitaFinanceira > 0) {
        detalhamento.push({
            imposto: 'PIS (Rec. Financeira)',
            baseCalculo: input.receitaFinanceira,
            aliquota: ALIQ_PIS_APLICACAO * 100,
            valor: input.receitaFinanceira * ALIQ_PIS_APLICACAO
        });
        detalhamento.push({
            imposto: 'COFINS (Rec. Financeira)',
            baseCalculo: input.receitaFinanceira,
            aliquota: ALIQ_COFINS_APLICACAO * 100,
            valor: input.receitaFinanceira * ALIQ_COFINS_APLICACAO
        });
    }

    processarItensEspeciais(input.itensAvulsos, detalhamento);

    const despesasTotaisDedutiveis = input.despesasOperacionais + input.despesasDedutiveis + extraDespesasDedutiveis;
    const lucroContabil = totalReceitas - input.custoMercadoriaVendida - input.folhaPagamento - despesasTotaisDedutiveis;
    const lucroReal = lucroContabil + (input.ajustesLucroRealAdicoes || 0) - (input.ajustesLucroRealExclusoes || 0);

    if (lucroReal > 0) {
        let valorIrpj = lucroReal * ALIQ_IRPJ;
        const limiteAdicional = input.periodoApuracao === 'Trimestral' ? LIMITE_ADICIONAL_TRIMESTRAL : LIMITE_ADICIONAL_MENSAL;
        if (lucroReal > limiteAdicional) valorIrpj += (lucroReal - limiteAdicional) * ADICIONAL_IRPJ;

        detalhamento.push({
            imposto: `IRPJ (Lucro Real ${input.periodoApuracao})`,
            baseCalculo: lucroReal,
            aliquota: ALIQ_IRPJ * 100,
            valor: Math.max(0, valorIrpj - (input.retencaoIrpj || 0)),
            observacao: `Lucro Tributável Real (Ajustado). Isenção Adicional: ${fmt(limiteAdicional)}` + (input.retencaoIrpj ? `. Retenção abatida: ${fmt(input.retencaoIrpj)}` : '')
        });

        detalhamento.push({
            imposto: `CSLL (Lucro Real ${input.periodoApuracao})`,
            baseCalculo: lucroReal,
            aliquota: ALIQ_CSLL * 100,
            valor: Math.max(0, (lucroReal * ALIQ_CSLL) - (input.retencaoCsll || 0)),
            observacao: input.retencaoCsll ? `Retenção abatida: ${fmt(input.retencaoCsll)}` : undefined
        });
    } else {
        detalhamento.push({
            imposto: 'IRPJ/CSLL (Lucro Real)',
            baseCalculo: lucroReal,
            aliquota: 0,
            valor: 0,
            observacao: 'Prejuízo Fiscal no Período'
        });
    }

    if (input.icmsProprioRecolher && input.icmsProprioRecolher > 0) {
        const saldoIcms = input.saldoCredorIcms || 0;
        const icmsPagar = Math.max(0, input.icmsProprioRecolher - saldoIcms);
        detalhamento.push({ imposto: 'ICMS Próprio', baseCalculo: 0, aliquota: 0, valor: icmsPagar, observacao: saldoIcms > 0 ? `Abatido Saldo Credor de ${fmt(saldoIcms)}` : 'Valor informado (Apuração Fiscal)' });
    }
    if (input.icmsStRecolher && input.icmsStRecolher > 0) {
        detalhamento.push({ imposto: 'ICMS ST', baseCalculo: 0, aliquota: 0, valor: input.icmsStRecolher, observacao: 'Valor informado (Apuração Fiscal)' });
    }
    if (input.ipiRecolher && input.ipiRecolher > 0) {
        const saldoIpi = input.saldoCredorIpi || 0;
        const ipiPagar = Math.max(0, input.ipiRecolher - saldoIpi);
        detalhamento.push({ imposto: 'IPI', baseCalculo: 0, aliquota: 0, valor: ipiPagar, observacao: saldoIpi > 0 ? `Abatido Saldo Credor de ${fmt(saldoIpi)}` : 'Valor informado (Apuração Fiscal)' });
    }

    const totalImpostos = detalhamento.reduce((acc, item) => acc + item.valor, 0);
    const extraDespesasNaoDedutiveis = (input.itensAvulsos || []).filter(i => i.tipo === 'despesa' && !i.dedutivelIrpj).reduce((acc, i) => acc + i.valor, 0);
    const lucroFinal = totalReceitas - input.custoMercadoriaVendida - input.folhaPagamento - despesasTotaisDedutiveis - extraDespesasNaoDedutiveis - totalImpostos;

    return {
        regime: 'Real',
        periodo: input.periodoApuracao,
        detalhamento,
        totalImpostos,
        cargaTributaria: totalReceitas > 0 ? (totalImpostos / totalReceitas) * 100 : 0,
        lucroLiquidoEstimado: lucroFinal
    ,
        saldoResidualPis: residualPis,
        saldoResidualCofins: residualCofins,
    };
};

const processarItensEspeciais = (itens: ItemFinanceiroAvulso[] | undefined, detalhamento: DetalheImposto[]) => {
    if (!itens) return;
    const baseAplicacao = itens.filter(i => i.tipo === 'receita' && i.categoriaEspecial === 'aplicacao_financeira').reduce((acc, i) => acc + i.valor, 0);
    if (baseAplicacao > 0) {
        detalhamento.push({
            imposto: 'PIS (Aplicações)',
            baseCalculo: baseAplicacao,
            aliquota: ALIQ_PIS_APLICACAO * 100,
            valor: baseAplicacao * ALIQ_PIS_APLICACAO
        });
        detalhamento.push({
            imposto: 'COFINS (Aplicações)',
            baseCalculo: baseAplicacao,
            aliquota: ALIQ_COFINS_APLICACAO * 100,
            valor: baseAplicacao * ALIQ_COFINS_APLICACAO
        });
    }
    const baseImportacao = itens.filter(i => i.tipo === 'despesa' && i.categoriaEspecial === 'importacao').reduce((acc, i) => acc + i.valor, 0);
    if (baseImportacao > 0) {
        detalhamento.push({
            imposto: 'PIS (Importação)',
            baseCalculo: baseImportacao,
            aliquota: ALIQ_PIS_IMPORTACAO * 100,
            valor: baseImportacao * ALIQ_PIS_IMPORTACAO
        });
        detalhamento.push({
            imposto: 'COFINS (Importação)',
            baseCalculo: baseImportacao,
            aliquota: ALIQ_COFINS_IMPORTACAO * 100,
            valor: baseImportacao * ALIQ_COFINS_IMPORTACAO
        });
    }
};
