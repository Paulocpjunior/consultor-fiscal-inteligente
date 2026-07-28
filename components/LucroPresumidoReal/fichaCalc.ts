/**
 * components/LucroPresumidoReal/fichaCalc.ts
 *
 * Helpers de conversao/calculo compartilhados entre o dashboard LP e a
 * ReportView. Antes viviam inline em LucroPresumidoRealDashboard.tsx.
 *
 * - `convertFichaToInput`: mapeia uma ficha salva pro input do servico
 *   de calculo (`calcularLucro`).
 * - `getRetencoesAcumuladasTrimestre`: soma IRRF/CSRF de meses anteriores
 *   do MESMO trimestre fiscal, para que IRPJ/CSLL trimestrais apareçam
 *   liquidos das retencoes na fonte tanto no card live quanto no relatorio.
 */
import type { LucroPresumidoEmpresa, FichaFinanceiraRegistro, LucroInput } from '../../types';

export function convertFichaToInput(
    ficha: FichaFinanceiraRegistro,
    empresa: LucroPresumidoEmpresa,
): LucroInput {
    return {
        regimeSelecionado: ficha.regime,
        periodoApuracao: ficha.periodoApuracao,
        mesReferencia: ficha.mesReferencia,
        faturamentoComercio: ficha.faturamentoMesComercio,
        faturamentoIndustria: ficha.faturamentoMesIndustria,
        faturamentoServico: ficha.faturamentoMesServico,
        faturamentoServicoRetido: ficha.faturamentoMesServicoRetido,
        faturamentoLocacao: ficha.faturamentoMesLocacao,
        faturamentoServicoHospitalar: ficha.faturamentoMesServicoHospitalar,

        faturamentoFiliais: {
            comercio: ficha.faturamentoFiliaisComercio || 0,
            industria: ficha.faturamentoFiliaisIndustria || 0,
            servico: ficha.faturamentoFiliaisServico || 0,
            servicoRetido: ficha.faturamentoFiliaisServicoRetido || 0,
            locacao: ficha.faturamentoFiliaisLocacao || 0,
            servicoHospitalar: ficha.faturamentoFiliaisServicoHospitalar || 0,
        },

        faturamentoMonofasico: ficha.faturamentoMonofasico,
        valorIpi: ficha.valorIpi,
        // ICMS-ST destacado também deduz a receita bruta (igual ao IPI). Faltava
        // aqui: o card ao vivo deduzia e o relatório não, então os dois
        // divergiam em qualquer empresa com ST destacado.
        valorIcmsSt: ficha.valorIcmsSt,
        valorDevolucoes: ficha.valorDevolucoes,
        icmsVendas: ficha.icmsVendas,

        receitaFinanceira: ficha.receitaFinanceira,
        despesasOperacionais: ficha.despesas,
        despesasDedutiveis: ficha.despesasDedutiveis,
        folhaPagamento: ficha.folha,
        custoMercadoriaVendida: ficha.cmv,

        // Prioriza a config salva na ficha, depois a da empresa, fallback 5%.
        issConfig: ficha.issConfig || empresa.issPadraoConfig || { tipo: 'aliquota_municipal', aliquota: 5 },

        retencaoPis: ficha.retencaoPis,
        retencaoCofins: ficha.retencaoCofins,
        retencaoIrpj: ficha.retencaoIrpj,
        retencaoCsll: ficha.retencaoCsll,

        isEquiparacaoHospitalar: ficha.isEquiparacaoHospitalar,
        isPresuncaoReduzida16: ficha.isPresuncaoReduzida16,
        itensAvulsos: ficha.itensAvulsos,

        acumuladoAno: ficha.acumuladoAno,
        // Saldo do trimestre anterior (LC 224/25). Sem isto a MEMÓRIA DE
        // APURAÇÃO recalculava sem o saldo e mostrava um IRPJ maior que o do
        // card ao vivo — caso A CASTELLANO 2T/2026: R$ 25.658,44 no relatório
        // contra R$ 25.609,40 na tela.
        saldoLimiteAnteriorLc224: ficha.saldoLimiteAnteriorLc224,
        acumuladoTrimestre: ficha.dadosTrimestrais,

        ipiRecolher: ficha.ipiRecolher,
        icmsProprioRecolher: ficha.icmsProprioRecolher,
        icmsStRecolher: ficha.icmsStRecolher,

        ajustesLucroRealAdicoes: ficha.ajustesLucroRealAdicoes,
        ajustesLucroRealExclusoes: ficha.ajustesLucroRealExclusoes,
        saldoCredorIcms: ficha.saldoCredorIcms,
        saldoCredorIpi: ficha.saldoCredorIpi,
    };
}

export function getRetencoesAcumuladasTrimestre(
    empresa: LucroPresumidoEmpresa | null | undefined,
    mesReferencia: string,
    periodo: 'Mensal' | 'Trimestral',
): { irpj: number; csll: number } {
    if (!empresa || periodo !== 'Trimestral' || !mesReferencia) return { irpj: 0, csll: 0 };

    const [anoStr, mesStr] = mesReferencia.split('-');
    const ano = parseInt(anoStr);
    const mes = parseInt(mesStr);
    if (isNaN(ano) || isNaN(mes)) return { irpj: 0, csll: 0 };

    const quarterStart = Math.floor((mes - 1) / 3) * 3 + 1;

    let accIrpj = 0;
    let accCsll = 0;

    if (empresa.fichaFinanceira) {
        empresa.fichaFinanceira.forEach(f => {
            const parts = f.mesReferencia.split('-');
            const fAnoNum = parseInt(parts[0]);
            const fMesNum = parseInt(parts[1]);
            if (fAnoNum === ano && fMesNum >= quarterStart && fMesNum < mes) {
                accIrpj += (f.retencaoIrpj || 0);
                accCsll += (f.retencaoCsll || 0);
            }
        });
    }

    return { irpj: accIrpj, csll: accCsll };
}
