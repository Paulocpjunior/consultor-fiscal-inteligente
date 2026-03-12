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

const fmt = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

/**
 * Calcula se o imposto pode ser parcelado em quotas
 * Regra Solicitada: > 10k (Mensal) ou > 30k (Trimestral)
 * Regra Legal Mínima: Parcela > R$ 1.000,00
 */
export const calcularCotasDisponiveis = (valorImposto: number, periodo: 'Mensal' | 'Trimestral'): PlanoCotas | undefined => {
    const limiteDisponibilidade = periodo === 'Trimestral' ? 5000 : 1000; // Ajustado para ser mais flexível, regra oficial é valor > 2000 para parcelar. Vamos permitir visualização.

    if (valorImposto > limiteDisponibilidade) {
        const numCotas = 3;
        const valorCota = valorImposto / numCotas;

        // Lei exige parcela mínima de 1000 reais
        if (valorCota < 1000) return undefined;

        return {
            disponivel: true,
            numeroCotas: numCotas,
            valorPrimeiraCota: valorCota,
            valorDemaisCotas: valorCota,
            vencimentos: [
                'Quota Única ou 1ª Quota (Sem Juros)',
                '2ª Quota (Juros 1%)',
                '3ª Quota (Juros 1% + SELIC)'
            ]
        };
    }
    return undefined;
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
        
        // Base de ISS APENAS sobre serviços com ISS Devido e Hospitalar
        // Serviços com retenção na fonte ou Locação (não incide ISS) são excluídos aqui.
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
    // OBS: ICMS sobre Vendas NÃO é deduzido aqui, pois afeta apenas PIS/COFINS (Tese do Século).
    const valorIpi = input.valorIpi || 0;
    const valorDevolucoes = input.valorDevolucoes || 0;

    // Calcular Bases Ajustadas (Líquidas de IPI e Devoluções) para Presunção (IRPJ/CSLL)
    // Lógica: 
    // - IPI é deduzido prioritariamente da Indústria (Natureza do imposto).
    // - Devoluções são deduzidas proporcionalmente de todas as receitas.
    
    let fatIndustriaDeduzidoIpi = Math.max(0, fatIndustriaMes - valorIpi);
    // Se o IPI for maior que a receita de indústria (Raro, mas possível em devolução massiva), abatemos do restante apenas para consistência matemática do total
    let restoDeducaoIpi = Math.max(0, valorIpi - fatIndustriaMes);

    // Total após dedução de IPI (Base Provisória)
    const totalSemIpi = totalFaturadoInputs - valorIpi;
    
    // Cálculo de Proporção para Devoluções (Rateio)
    // Se totalSemIpi for 0, evita divisão por zero
    const ratioComercio = totalSemIpi > 0 ? fatComercioMes / totalSemIpi : 0;
    const ratioIndustria = totalSemIpi > 0 ? fatIndustriaDeduzidoIpi / totalSemIpi : 0;
    const ratioServico = totalSemIpi > 0 ? fatServicoMesTotal / totalSemIpi : 0;
    const ratioServicoHosp = totalSemIpi > 0 ? fatServicoHospMes / totalSemIpi : 0;

    // Bases Finais para Presunção (Líquidas de IPI e Devoluções, mas COM ICMS) -> Base IRPJ/CSLL
    const baseComercioFinal = Math.max(0, fatComercioMes - (valorDevolucoes * ratioComercio) - (restoDeducaoIpi > 0 ? restoDeducaoIpi : 0)); // Simplificação: joga resto do IPI no comércio se houver
    const baseIndustriaFinal = Math.max(0, fatIndustriaDeduzidoIpi - (valorDevolucoes * ratioIndustria));
    const baseServicoFinal = Math.max(0, fatServicoMesTotal - (valorDevolucoes * ratioServico));
    const baseServicoHospFinal = Math.max(0, fatServicoHospMes - (valorDevolucoes * ratioServicoHosp));

    // Receita Bruta Efetiva (Base de Cálculo IRPJ/CSLL)
    // Fórmula: Vendas Brutas - Devoluções - IPI
    // Monofásicos: Estão incluídos nas bases finais acima (Comércio/Indústria). Não deduzimos.
    const receitaBrutaEfetiva = baseComercioFinal + baseIndustriaFinal + baseServicoFinal + baseServicoHospFinal;
    const receitaTotalMes = receitaBrutaEfetiva + (input.receitaFinanceira || 0);
    
    const detalhamento: DetalheImposto[] = [];
    
    // Análise da Lei Complementar 224/2025
    const ano = parseInt(input.mesReferencia?.split('-')[0] || '0');
    const receitaTotalAno = (input.acumuladoAno || 0) + receitaTotalMes;
    let fatorAumentoPresuncao = 1.0;
    let aplicouLc224 = false;

    if (ano >= 2026 && receitaTotalAno > 5000000) {
        fatorAumentoPresuncao = 1.10;
        aplicouLc224 = true;
    }

    // ISS
    const issItem = calcularISS(input);
    if (issItem) detalhamento.push(issItem);

    const retencaoPis = input.retencaoPis || 0;
    const retencaoCofins = input.retencaoCofins || 0;
    const retencaoIrpj = input.retencaoIrpj || 0;
    const retencaoCsll = input.retencaoCsll || 0;

    // PIS/COFINS
    // Base: Receita Bruta Efetiva - ICMS sobre Vendas (Exclusão do ICMS da base de PIS/COFINS) - Monofásico
    // CORREÇÃO: Deduz faturamento monofásico da base de PIS/COFINS (mesmo tratamento do Lucro Real)
    const icmsVendas = input.icmsVendas || 0;
    const valorMonofasico = input.faturamentoMonofasico || 0;
    const basePisCofins = Math.max(0, receitaBrutaEfetiva - icmsVendas - valorMonofasico);
    
    // Monta observação dinâmica para PIS/COFINS
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

    // IRPJ - Base de Presunção
    // IMPORTANTE: Aqui usamos as bases finais (já líquidas de IPI/Devoluções).
    // REGRA: Produtos Monofásicos e ICMS compõem a Receita Bruta para fins de IRPJ/CSLL no Presumido/Trimestral.
    // Portanto, NÃO subtraímos o Monofásico nem o ICMS sobre Vendas desta base.
    
    let baseCalculoIrpjComercio = baseComercioFinal;
    let baseCalculoIrpjIndustria = baseIndustriaFinal;
    let baseCalculoIrpjServico = baseServicoFinal;
    let baseCalculoIrpjServicoHosp = baseServicoHospFinal;
    let baseCalculoReceitaFinanceira = input.receitaFinanceira || 0;

    let obsTrimestre = "";

    if (input.periodoApuracao === 'Trimestral' && input.acumuladoTrimestre) {
        // Se houver acumulado manual, soma-se. 
        baseCalculoIrpjComercio += input.acumuladoTrimestre.comercio;
        baseCalculoIrpjIndustria += input.acumuladoTrimestre.industria;
        baseCalculoIrpjServico += input.acumuladoTrimestre.servico;
        baseCalculoIrpjServicoHosp += (input.acumuladoTrimestre.servicoHospitalar || 0); 
        baseCalculoReceitaFinanceira += input.acumuladoTrimestre.financeira;
        obsTrimestre = ` (Inclui Out/Nov/Dez)`;
    }

    // Definição da alíquota de presunção para serviços gerais
    const presuncaoServicoUsada = input.isPresuncaoReduzida16 
        ? PRESUNCAO_IRPJ_SERVICO_REDUZIDA 
        : PRESUNCAO_IRPJ_SERVICO_PADRAO;

    // Cálculo das Bases Presumidas IRPJ
    const baseIrpjComercio = baseCalculoIrpjComercio * PRESUNCAO_IRPJ_COMERCIO * fatorAumentoPresuncao;
    const baseIrpjIndustria = baseCalculoIrpjIndustria * PRESUNCAO_IRPJ_INDUSTRIA * fatorAumentoPresuncao;
    const baseIrpjServico = baseCalculoIrpjServico * presuncaoServicoUsada * fatorAumentoPresuncao;
    const baseIrpjServicoHosp = baseCalculoIrpjServicoHosp * PRESUNCAO_IRPJ_HOSPITALAR * fatorAumentoPresuncao;
    
    // Receita financeira entra 100%
    const baseIrpjTotal = baseIrpjComercio + baseIrpjIndustria + baseIrpjServico + baseIrpjServicoHosp + baseCalculoReceitaFinanceira;

    if (baseIrpjTotal > 0) {
        let valorIrpj = baseIrpjTotal * ALIQ_IRPJ;
        const limiteAdicional = input.periodoApuracao === 'Trimestral' ? LIMITE_ADICIONAL_TRIMESTRAL : LIMITE_ADICIONAL_MENSAL;
        
        if (baseIrpjTotal > limiteAdicional) {
            valorIrpj += (baseIrpjTotal - limiteAdicional) * ADICIONAL_IRPJ;
        }

        const obsHosp = baseIrpjServicoHosp > 0 ? " + Hosp. 8%" : "";
        const obsReduzida = input.isPresuncaoReduzida16 ? " (Reduzida 16% R$120k)" : "";

        detalhamento.push({
            imposto: `IRPJ (${input.periodoApuracao})`,
            baseCalculo: baseIrpjTotal,
            aliquota: ALIQ_IRPJ * 100,
            valor: Math.max(0, valorIrpj - retencaoIrpj),
            observacao: (aplicouLc224 
                ? `LC 224/25. Base Bruta${obsHosp}${obsReduzida}.${obsTrimestre}` 
                : `Base Bruta (Inclui Monofásicos)${obsHosp}${obsReduzida}.${obsTrimestre}`) + ` Isenção: ${fmt(limiteAdicional)}` + (retencaoIrpj > 0 ? `. Retenção abatida: ${fmt(retencaoIrpj)}` : '')
        });
    }

    // CSLL - Base de Presunção
    const baseCsllComercio = baseCalculoIrpjComercio * PRESUNCAO_CSLL_COMERCIO * fatorAumentoPresuncao;
    const baseCsllIndustria = baseCalculoIrpjIndustria * PRESUNCAO_CSLL_INDUSTRIA * fatorAumentoPresuncao;
    const baseCsllServico = baseCalculoIrpjServico * PRESUNCAO_CSLL_SERVICO * fatorAumentoPresuncao; // 32% padrão
    const baseCsllServicoHosp = baseCalculoIrpjServicoHosp * PRESUNCAO_CSLL_HOSPITALAR * fatorAumentoPresuncao; // 12% reduzida

    const baseCsllTotal = baseCsllComercio + baseCsllIndustria + baseCsllServico + baseCsllServicoHosp + baseCalculoReceitaFinanceira;

    if (baseCsllTotal > 0) {
        const obsHosp = baseCsllServicoHosp > 0 ? " + Hosp. 12%" : "";
        detalhamento.push({
            imposto: `CSLL (${input.periodoApuracao})`,
            baseCalculo: baseCsllTotal,
            aliquota: ALIQ_CSLL * 100,
            valor: Math.max(0, (baseCsllTotal * ALIQ_CSLL) - retencaoCsll),
            observacao: (aplicouLc224
                ? `LC 224/25.${obsHosp}.${obsTrimestre}`
                : `Base Bruta (Inclui Monofásicos)${obsHosp}.${obsTrimestre}`) + (retencaoCsll > 0 ? `. Retenção abatida: ${fmt(retencaoCsll)}` : '')
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
    
    // Lucro Líquido
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
    // Nota: Lucro Real geralmente requer apuração contábil mais complexa.
    // Aqui aplicamos a lógica básica sobre os inputs fornecidos + Filiais.
    
    const fatComercio = input.faturamentoComercio + (input.faturamentoFiliais?.comercio || 0);
    const fatIndustria = input.faturamentoIndustria + (input.faturamentoFiliais?.industria || 0);
    
    // Consolidação de Serviços (Próprio, Retido, Locação)
    const fatServicoTotal = input.faturamentoServico + (input.faturamentoFiliais?.servico || 0) + 
                            (input.faturamentoServicoRetido || 0) + (input.faturamentoFiliais?.servicoRetido || 0) +
                            (input.faturamentoLocacao || 0) + (input.faturamentoFiliais?.locacao || 0);

    const fatServicoHosp = (input.faturamentoServicoHospitalar || 0) + (input.faturamentoFiliais?.servicoHospitalar || 0);
    
    const faturamentoBrutoInput = fatComercio + fatIndustria + fatServicoTotal + fatServicoHosp;
    
    // Aplica deduções também no Real para chegar à Receita Líquida Operacional (base de partida)
    const receitaLiquida = Math.max(0, faturamentoBrutoInput - (input.valorIpi || 0) - (input.valorDevolucoes || 0));

    const detalhamento: DetalheImposto[] = [];
    
    // ISS (Apenas sobre serviços próprios/hospitalares, excluindo retenção e locação)
    const issItem = calcularISS(input);
    if (issItem) detalhamento.push(issItem);

    const extraDespesasDedutiveis = (input.itensAvulsos || [])
        .filter(i => i.tipo === 'despesa' && i.dedutivelIrpj)
        .reduce((acc, i) => acc + i.valor, 0);

    const extraBaseCredito = (input.itensAvulsos || [])
        .filter(i => i.tipo === 'despesa' && i.geraCreditoPisCofins)
        .reduce((acc, i) => acc + i.valor, 0);

    const totalReceitas = receitaLiquida + (input.receitaFinanceira || 0) + (input.itensAvulsos || []).filter(i => i.tipo === 'receita').reduce((acc, i) => acc + i.valor, 0);

    // PIS/COFINS (Não Cumulativo - Mensal - Consolidado)
    // Base PIS/COFINS Real: Receita Líquida - ICMS sobre Vendas (Tese do Século) - Monofásico
    // Monofásico é deduzido aqui pois no Regime Não-Cumulativo a receita é segregada.
    const icmsVendas = input.icmsVendas || 0;
    const basePisCofins = Math.max(0, receitaLiquida - icmsVendas - (input.faturamentoMonofasico || 0));
    const baseCredito = input.despesasDedutiveis + extraBaseCredito; 
    
    detalhamento.push({
        imposto: 'PIS (Lucro Real)',
        baseCalculo: basePisCofins,
        aliquota: ALIQ_PIS_NAO_CUMULATIVO * 100,
        valor: Math.max(0, (basePisCofins * ALIQ_PIS_NAO_CUMULATIVO) - (baseCredito * ALIQ_PIS_NAO_CUMULATIVO) - (input.retencaoPis || 0)),
        observacao: `Mensal - Crédito sobre despesas. Deduzido ICMS.` + (input.retencaoPis ? ` Retenção abatida: ${fmt(input.retencaoPis)}` : '')
    });

    detalhamento.push({
        imposto: 'COFINS (Lucro Real)',
        baseCalculo: basePisCofins,
        aliquota: ALIQ_COFINS_NAO_CUMULATIVO * 100,
        valor: Math.max(0, (basePisCofins * ALIQ_COFINS_NAO_CUMULATIVO) - (baseCredito * ALIQ_COFINS_NAO_CUMULATIVO) - (input.retencaoCofins || 0)),
        observacao: `Mensal - Crédito sobre despesas. Deduzido ICMS.` + (input.retencaoCofins ? ` Retenção abatida: ${fmt(input.retencaoCofins)}` : '')
    });

    // PIS/COFINS sobre Receita Financeira (Regime Não-Cumulativo)
    // Alíquotas: PIS 0,65% e COFINS 4,00% (Dec. 8.426/2015)
    if (input.receitaFinanceira && input.receitaFinanceira > 0) {
        detalhamento.push({
            imposto: 'PIS (Rec. Financeira)',
            baseCalculo: input.receitaFinanceira,
            aliquota: ALIQ_PIS_APLICACAO * 100, // 0.65%
            valor: input.receitaFinanceira * ALIQ_PIS_APLICACAO
        });
        detalhamento.push({
            imposto: 'COFINS (Rec. Financeira)',
            baseCalculo: input.receitaFinanceira,
            aliquota: ALIQ_COFINS_APLICACAO * 100, // 4.00%
            valor: input.receitaFinanceira * ALIQ_COFINS_APLICACAO
        });
    }

    processarItensEspeciais(input.itensAvulsos, detalhamento);

    // IRPJ / CSLL (Lucro Real - Ajustado por Período)
    
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

    // ADICIONAR IMPOSTOS INFORMATIVOS (MANUAIS) AO RESULTADO FINAL
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
