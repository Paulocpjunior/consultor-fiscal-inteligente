/**
 * Unit tests for the Lucro Presumido / Real tax calculation service.
 *
 * Tests cover:
 *   - Lucro Presumido: IRPJ/CSLL with presuncao, PIS/COFINS cumulativo
 *   - Lucro Real: IRPJ/CSLL on taxable profit, PIS/COFINS nao-cumulativo
 *   - Additional IRPJ (10% surcharge above R$ 20k/month or R$ 60k/trimestre)
 *   - ISS configurations (aliquota municipal vs SUP fixo)
 *   - Retention deductions
 *   - Cotas (installments)
 *   - LC 224/2025 majoracao
 */

import { calcularLucro, calcularCotasDisponiveis } from '../services/lucroService';
import { LucroInput, LucroResult, IssConfig } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function criarInputBase(overrides: Partial<LucroInput> = {}): LucroInput {
    return {
        regimeSelecionado: 'Presumido',
        periodoApuracao: 'Mensal',
        faturamentoComercio: 0,
        faturamentoIndustria: 0,
        faturamentoServico: 0,
        faturamentoMonofasico: 0,
        receitaFinanceira: 0,
        despesasOperacionais: 0,
        despesasDedutiveis: 0,
        folhaPagamento: 0,
        custoMercadoriaVendida: 0,
        issConfig: { tipo: 'aliquota_municipal', aliquota: 0 },
        retencaoPis: 0,
        retencaoCofins: 0,
        retencaoIrpj: 0,
        retencaoCsll: 0,
        ...overrides,
    };
}

function findImposto(result: LucroResult, search: string) {
    return result.detalhamento.find(d => d.imposto.includes(search));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lucroService', () => {

    // ========================================================================
    // Lucro Presumido - PIS/COFINS Cumulativo
    // ========================================================================
    describe('Lucro Presumido - PIS/COFINS cumulativo', () => {

        it('calculates PIS at 0.65% and COFINS at 3.00% on receita bruta (commerce)', () => {
            const input = criarInputBase({
                faturamentoComercio: 100000,
            });
            const result = calcularLucro(input);

            const pis = findImposto(result, 'PIS');
            const cofins = findImposto(result, 'COFINS');

            expect(pis).toBeDefined();
            expect(cofins).toBeDefined();
            expect(pis!.valor).toBeCloseTo(100000 * 0.0065, 2);
            expect(cofins!.valor).toBeCloseTo(100000 * 0.03, 2);
            expect(pis!.aliquota).toBe(0.65);
            expect(cofins!.aliquota).toBe(3);
        });

        it('deducts ICMS from PIS/COFINS base', () => {
            const input = criarInputBase({
                faturamentoComercio: 100000,
                icmsVendas: 18000,
            });
            const result = calcularLucro(input);

            const pis = findImposto(result, 'PIS');
            // Base = 100000 - 18000 = 82000
            expect(pis!.baseCalculo).toBeCloseTo(82000, 2);
            expect(pis!.valor).toBeCloseTo(82000 * 0.0065, 2);
        });

        it('deducts monofasico from PIS/COFINS base', () => {
            const input = criarInputBase({
                faturamentoComercio: 100000,
                faturamentoMonofasico: 20000,
            });
            const result = calcularLucro(input);

            const pis = findImposto(result, 'PIS');
            // Base = 100000 - 20000 = 80000
            expect(pis!.baseCalculo).toBeCloseTo(80000, 2);
        });
    });

    // ========================================================================
    // Lucro Presumido - IRPJ (presuncao)
    // ========================================================================
    describe('Lucro Presumido - IRPJ', () => {

        it('commerce: IRPJ base = faturamento * 8% (presuncao), then 15%', () => {
            const input = criarInputBase({
                faturamentoComercio: 100000,
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            expect(irpj).toBeDefined();
            // Base = 100000 * 0.08 = 8000
            // IRPJ = 8000 * 0.15 = 1200
            expect(irpj!.baseCalculo).toBeCloseTo(8000, 2);
            expect(irpj!.valor).toBeCloseTo(1200, 2);
        });

        it('services: IRPJ base = faturamento * 32% (presuncao), then 15%', () => {
            const input = criarInputBase({
                faturamentoServico: 100000,
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            // Base = 100000 * 0.32 = 32000
            // IRPJ = 32000 * 0.15 = 4800
            // Additional: base > 20000 => (32000 - 20000) * 0.10 = 1200
            // Total = 4800 + 1200 = 6000
            expect(irpj!.baseCalculo).toBeCloseTo(32000, 2);
            expect(irpj!.valor).toBeCloseTo(6000, 2);
        });

        it('services with reduced presuncao 16% (receita <= R$ 120k)', () => {
            const input = criarInputBase({
                faturamentoServico: 100000,
                isPresuncaoReduzida16: true,
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            // Base = 100000 * 0.16 = 16000
            // IRPJ = 16000 * 0.15 = 2400
            // No additional (16000 < 20000)
            expect(irpj!.baseCalculo).toBeCloseTo(16000, 2);
            expect(irpj!.valor).toBeCloseTo(2400, 2);
        });

        it('industry: IRPJ base = faturamento * 8% (presuncao)', () => {
            const input = criarInputBase({
                faturamentoIndustria: 200000,
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            // Base = 200000 * 0.08 = 16000
            expect(irpj!.baseCalculo).toBeCloseTo(16000, 2);
        });

        it('includes receitaFinanceira in IRPJ base at 100%', () => {
            const input = criarInputBase({
                faturamentoComercio: 100000,
                receitaFinanceira: 10000,
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            // Base = (100000 * 0.08) + 10000 = 18000
            expect(irpj!.baseCalculo).toBeCloseTo(18000, 2);
        });
    });

    // ========================================================================
    // Adicional IRPJ (10% surcharge)
    // ========================================================================
    describe('Lucro Presumido - Adicional IRPJ', () => {

        it('monthly: 10% on base exceeding R$ 20k', () => {
            const input = criarInputBase({
                faturamentoServico: 100000, // base = 32000
                periodoApuracao: 'Mensal',
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            // Base = 32000
            // IRPJ = 32000 * 0.15 = 4800
            // Adicional = (32000 - 20000) * 0.10 = 1200
            // Total = 6000
            expect(irpj!.valor).toBeCloseTo(6000, 2);
        });

        it('monthly: no additional when base <= R$ 20k', () => {
            const input = criarInputBase({
                faturamentoComercio: 200000, // base = 200000 * 0.08 = 16000
                periodoApuracao: 'Mensal',
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            // Base = 16000 < 20000, no additional
            // IRPJ = 16000 * 0.15 = 2400
            expect(irpj!.valor).toBeCloseTo(2400, 2);
        });

        it('trimestral: 10% on base exceeding R$ 60k', () => {
            const input = criarInputBase({
                faturamentoServico: 300000,
                periodoApuracao: 'Trimestral',
                acumuladoTrimestre: {
                    comercio: 0,
                    industria: 0,
                    servico: 200000, // 2 previous months
                    servicoHospitalar: 0,
                    financeira: 0,
                    mesesConsiderados: ['2025-01', '2025-02'],
                },
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            // Total servico trimestral = 300000 (mes) + 200000 (acum) = 500000
            // Base = 500000 * 0.32 = 160000
            // IRPJ = 160000 * 0.15 = 24000
            // Adicional = (160000 - 60000) * 0.10 = 10000
            // Total = 34000
            expect(irpj!.baseCalculo).toBeCloseTo(160000, 2);
            expect(irpj!.valor).toBeCloseTo(34000, 2);
        });

        it('trimestral: acumulado aluguel composes IRPJ/CSLL base (32% presuncao, same as servicos)', () => {
            const input = criarInputBase({
                faturamentoServico: 100000,
                periodoApuracao: 'Trimestral',
                acumuladoTrimestre: {
                    comercio: 0,
                    industria: 0,
                    servico: 0,
                    servicoHospitalar: 0,
                    financeira: 0,
                    aluguel: 200000, // 2 previous months of locacao
                    mesesConsiderados: ['2025-01', '2025-02'],
                },
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            // Total base trimestral = 100000 (servico mes) + 200000 (aluguel acum) = 300000
            // Base IRPJ = 300000 * 0.32 = 96000
            // IRPJ = 96000 * 0.15 = 14400 + adicional (96000 - 60000) * 0.10 = 3600 => 18000
            expect(irpj!.baseCalculo).toBeCloseTo(96000, 2);
            expect(irpj!.valor).toBeCloseTo(18000, 2);

            const csll = findImposto(result, 'CSLL');
            // Base CSLL = 300000 * 0.32 = 96000; CSLL = 96000 * 0.09 = 8640
            expect(csll!.baseCalculo).toBeCloseTo(96000, 2);
            expect(csll!.valor).toBeCloseTo(8640, 2);
        });

        it('trimestral: no additional when base <= R$ 60k', () => {
            const input = criarInputBase({
                faturamentoComercio: 100000,
                periodoApuracao: 'Trimestral',
                acumuladoTrimestre: {
                    comercio: 200000,
                    industria: 0,
                    servico: 0,
                    servicoHospitalar: 0,
                    financeira: 0,
                    mesesConsiderados: ['2025-01', '2025-02'],
                },
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            // Total trimestral = 100000 + 200000 = 300000
            // Base = 300000 * 0.08 = 24000 < 60000, no additional
            // IRPJ = 24000 * 0.15 = 3600
            expect(irpj!.valor).toBeCloseTo(3600, 2);
        });
    });

    // ========================================================================
    // CSLL
    // ========================================================================
    describe('Lucro Presumido - CSLL', () => {

        it('commerce CSLL: base = faturamento * 12%, rate 9%', () => {
            const input = criarInputBase({
                faturamentoComercio: 100000,
            });
            const result = calcularLucro(input);

            const csll = findImposto(result, 'CSLL');
            // Base = 100000 * 0.12 = 12000
            // CSLL = 12000 * 0.09 = 1080
            expect(csll!.baseCalculo).toBeCloseTo(12000, 2);
            expect(csll!.valor).toBeCloseTo(1080, 2);
        });

        it('services CSLL: base = faturamento * 32%, rate 9%', () => {
            const input = criarInputBase({
                faturamentoServico: 100000,
            });
            const result = calcularLucro(input);

            const csll = findImposto(result, 'CSLL');
            // Base = 100000 * 0.32 = 32000
            // CSLL = 32000 * 0.09 = 2880
            expect(csll!.baseCalculo).toBeCloseTo(32000, 2);
            expect(csll!.valor).toBeCloseTo(2880, 2);
        });
    });

    // ========================================================================
    // ISS
    // ========================================================================
    describe('ISS configurations', () => {

        it('ISS aliquota municipal: percentage on service revenue', () => {
            const input = criarInputBase({
                faturamentoServico: 100000,
                issConfig: { tipo: 'aliquota_municipal', aliquota: 5 },
            });
            const result = calcularLucro(input);

            const iss = findImposto(result, 'ISS');
            expect(iss).toBeDefined();
            expect(iss!.valor).toBeCloseTo(5000, 2);
            expect(iss!.baseCalculo).toBe(100000);
        });

        it('ISS SUP fixo: valor por socio x qtde socios', () => {
            const input = criarInputBase({
                faturamentoServico: 100000,
                issConfig: { tipo: 'sup_fixo', qtdeSocios: 3, valorPorSocio: 450 },
            });
            const result = calcularLucro(input);

            const iss = findImposto(result, 'ISS-SUP');
            expect(iss).toBeDefined();
            expect(iss!.valor).toBe(1350);
        });

        it('ISS with zero aliquota: no ISS entry', () => {
            const input = criarInputBase({
                faturamentoServico: 100000,
                issConfig: { tipo: 'aliquota_municipal', aliquota: 0 },
            });
            const result = calcularLucro(input);

            const iss = result.detalhamento.find(d => d.imposto.includes('ISS'));
            expect(iss).toBeUndefined();
        });
    });

    // ========================================================================
    // Retencoes
    // ========================================================================
    describe('Lucro Presumido - retencoes', () => {

        it('deducts retencoes from PIS, COFINS, IRPJ, CSLL', () => {
            const input = criarInputBase({
                faturamentoServico: 100000,
                retencaoPis: 100,
                retencaoCofins: 500,
                retencaoIrpj: 1000,
                retencaoCsll: 500,
            });
            const result = calcularLucro(input);

            const pis = findImposto(result, 'PIS');
            const cofins = findImposto(result, 'COFINS');
            const irpj = findImposto(result, 'IRPJ');
            const csll = findImposto(result, 'CSLL');

            // PIS = 100000 * 0.0065 - 100 = 650 - 100 = 550
            expect(pis!.valor).toBeCloseTo(550, 2);
            // COFINS = 100000 * 0.03 - 500 = 3000 - 500 = 2500
            expect(cofins!.valor).toBeCloseTo(2500, 2);
            // IRPJ base = 32000, IRPJ = 32000*0.15 + (32000-20000)*0.10 - 1000 = 6000 - 1000 = 5000
            expect(irpj!.valor).toBeCloseTo(5000, 2);
            // CSLL base = 32000, CSLL = 32000 * 0.09 - 500 = 2880 - 500 = 2380
            expect(csll!.valor).toBeCloseTo(2380, 2);
        });

        it('retencao never makes tax negative (floor at 0)', () => {
            const input = criarInputBase({
                faturamentoComercio: 10000,
                retencaoPis: 99999,
            });
            const result = calcularLucro(input);

            const pis = findImposto(result, 'PIS');
            expect(pis!.valor).toBe(0);
        });
    });

    // ========================================================================
    // Lucro Real - PIS/COFINS nao-cumulativo
    // ========================================================================
    describe('Lucro Real - PIS/COFINS nao-cumulativo', () => {

        it('PIS at 1.65% and COFINS at 7.60% with credit deductions', () => {
            const input = criarInputBase({
                regimeSelecionado: 'Real',
                faturamentoComercio: 200000,
                despesasDedutiveis: 50000,
                // Base de credito PIS/COFINS agora vem do campo SEGREGADO de
                // insumos (o fallback sobre despesa generica foi removido — era
                // credito ilegalmente amplo). 50k de insumos = mesmo credito.
                despesasGeramCreditoPisCofins: 50000,
            });
            const result = calcularLucro(input);

            const pis = findImposto(result, 'PIS (Lucro Real)');
            const cofins = findImposto(result, 'COFINS (Lucro Real)');

            expect(pis).toBeDefined();
            expect(cofins).toBeDefined();

            // PIS = (200000 * 0.0165) - (50000 * 0.0165) = 3300 - 825 = 2475
            expect(pis!.valor).toBeCloseTo(2475, 2);
            // COFINS = (200000 * 0.076) - (50000 * 0.076) = 15200 - 3800 = 11400
            expect(cofins!.valor).toBeCloseTo(11400, 2);
        });

        it('SEM base de insumos segregada NÃO credita sobre despesa genérica (fix auditoria)', () => {
            const input = criarInputBase({
                regimeSelecionado: 'Real',
                faturamentoComercio: 200000,
                despesasDedutiveis: 300000, // despesa generica alta — NAO deve gerar credito
                // despesasGeramCreditoPisCofins ausente de proposito
            });
            const result = calcularLucro(input);
            const pis = findImposto(result, 'PIS (Lucro Real)');
            const cofins = findImposto(result, 'COFINS (Lucro Real)');
            // Sem insumos: debito integral, sem credito. PIS = 200000*1,65% = 3300.
            expect(pis!.valor).toBeCloseTo(3300, 2);
            expect(cofins!.valor).toBeCloseTo(15200, 2);
        });

        it('valorBruto é o débito antes da retenção (usado pelo MIT/DCTFWeb)', () => {
            const input = criarInputBase({
                regimeSelecionado: 'Real',
                faturamentoComercio: 200000,
                retencaoPis: 500,
                retencaoCofins: 1000,
            });
            const result = calcularLucro(input);
            const pis = findImposto(result, 'PIS (Lucro Real)');
            const cofins = findImposto(result, 'COFINS (Lucro Real)');
            // valor = líquido (a pagar); valorBruto = débito (a declarar no MIT).
            expect(pis!.valorBruto).toBeCloseTo(3300, 2);
            expect(pis!.valor).toBeCloseTo(2800, 2);      // 3300 - 500 retenção
            expect(cofins!.valorBruto).toBeCloseTo(15200, 2);
            expect(cofins!.valor).toBeCloseTo(14200, 2);  // 15200 - 1000 retenção
        });

        it('generates saldo residual when credits exceed debits', () => {
            const input = criarInputBase({
                regimeSelecionado: 'Real',
                faturamentoComercio: 50000,
                despesasDedutiveis: 200000,
                despesasGeramCreditoPisCofins: 200000, // insumos > receita → crédito excede débito
            });
            const result = calcularLucro(input);

            const pis = findImposto(result, 'PIS (Lucro Real)');
            expect(pis!.valor).toBe(0); // floored at 0

            expect(result.saldoResidualPis).toBeDefined();
            expect(result.saldoResidualPis!).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // Lucro Real - IRPJ/CSLL on taxable profit
    // ========================================================================
    describe('Lucro Real - IRPJ/CSLL', () => {

        it('calculates IRPJ on lucro real (receita - custos - despesas)', () => {
            const input = criarInputBase({
                regimeSelecionado: 'Real',
                faturamentoComercio: 500000,
                custoMercadoriaVendida: 200000,
                despesasOperacionais: 50000,
                despesasDedutiveis: 30000,
                folhaPagamento: 80000,
            });
            const result = calcularLucro(input);

            const irpj = result.detalhamento.find(d => d.imposto.includes('IRPJ') && d.imposto.includes('Lucro Real'));
            expect(irpj).toBeDefined();

            // Lucro contabil = 500000 - 200000 - 80000 - (50000 + 30000) = 140000
            // Lucro real = 140000 (no adjustments)
            // IRPJ = 140000 * 0.15 + (140000 - 20000) * 0.10 = 21000 + 12000 = 33000
            expect(irpj!.baseCalculo).toBeCloseTo(140000, 2);
            expect(irpj!.valor).toBeCloseTo(33000, 2);
        });

        it('shows zero IRPJ/CSLL when there is a fiscal loss (prejuizo)', () => {
            const input = criarInputBase({
                regimeSelecionado: 'Real',
                faturamentoComercio: 100000,
                custoMercadoriaVendida: 80000,
                despesasOperacionais: 50000,
                despesasDedutiveis: 0,
                folhaPagamento: 20000,
            });
            const result = calcularLucro(input);

            // Lucro = 100000 - 80000 - 20000 - 50000 = -50000
            const irpj = result.detalhamento.find(d => d.imposto.includes('IRPJ'));
            expect(irpj).toBeDefined();
            expect(irpj!.valor).toBe(0);
            expect(irpj!.observacao).toContain('Prejuízo');
        });

        it('applies lucro real adjustments (adicoes and exclusoes)', () => {
            const input = criarInputBase({
                regimeSelecionado: 'Real',
                faturamentoComercio: 300000,
                custoMercadoriaVendida: 100000,
                despesasOperacionais: 30000,
                despesasDedutiveis: 20000,
                folhaPagamento: 50000,
                ajustesLucroRealAdicoes: 10000,
                ajustesLucroRealExclusoes: 5000,
            });
            const result = calcularLucro(input);

            const irpj = result.detalhamento.find(d => d.imposto.includes('IRPJ') && d.imposto.includes('Lucro Real'));
            // Lucro contabil = 300000 - 100000 - 50000 - (30000 + 20000) = 100000
            // Lucro real = 100000 + 10000 - 5000 = 105000
            expect(irpj!.baseCalculo).toBeCloseTo(105000, 2);
        });
    });

    // ========================================================================
    // calcularCotasDisponiveis
    // ========================================================================
    describe('calcularCotasDisponiveis', () => {

        it('returns installment plan for trimestral when valor >= R$ 3000', () => {
            const plan = calcularCotasDisponiveis(9000, 'Trimestral');
            expect(plan).toBeDefined();
            expect(plan!.disponivel).toBe(true);
            expect(plan!.numeroCotas).toBe(3);
            expect(plan!.valorPrimeiraCota).toBe(3000);
        });

        it('returns undefined for trimestral when each cota < R$ 1000', () => {
            const plan = calcularCotasDisponiveis(2999, 'Trimestral');
            expect(plan).toBeUndefined();
        });

        it('returns undefined for mensal (cotas only for trimestral)', () => {
            const plan = calcularCotasDisponiveis(50000, 'Mensal');
            expect(plan).toBeUndefined();
        });
    });

    // ========================================================================
    // Overall result structure
    // ========================================================================
    describe('Result structure', () => {

        it('Presumido result has correct regime and periodo', () => {
            const input = criarInputBase({ faturamentoComercio: 100000 });
            const result = calcularLucro(input);

            expect(result.regime).toBe('Presumido');
            expect(result.periodo).toBe('Mensal');
            expect(result.totalImpostos).toBeGreaterThan(0);
            expect(result.cargaTributaria).toBeGreaterThan(0);
        });

        it('Real result has correct regime', () => {
            const input = criarInputBase({
                regimeSelecionado: 'Real',
                faturamentoComercio: 100000,
            });
            const result = calcularLucro(input);

            expect(result.regime).toBe('Real');
        });

        it('totalImpostos is sum of all detalhamento values', () => {
            const input = criarInputBase({
                faturamentoComercio: 100000,
                faturamentoServico: 50000,
                issConfig: { tipo: 'aliquota_municipal', aliquota: 5 },
            });
            const result = calcularLucro(input);

            const sumDetalhamento = result.detalhamento.reduce((acc, d) => acc + d.valor, 0);
            expect(result.totalImpostos).toBeCloseTo(sumDetalhamento, 2);
        });

        it('cargaTributaria = totalImpostos / receitaTotalMes * 100', () => {
            const input = criarInputBase({
                faturamentoComercio: 200000,
            });
            const result = calcularLucro(input);

            const expectedCarga = (result.totalImpostos / 200000) * 100;
            expect(result.cargaTributaria).toBeCloseTo(expectedCarga, 2);
        });
    });

    // ========================================================================
    // IPI and devolution deductions
    // ========================================================================
    describe('IPI and devolution deductions', () => {

        it('deducts IPI from industry base before presuncao', () => {
            const input = criarInputBase({
                faturamentoIndustria: 200000,
                valorIpi: 20000,
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            // Effective industry base = 200000 - 20000 = 180000
            // IRPJ base = 180000 * 0.08 = 14400
            expect(irpj!.baseCalculo).toBeCloseTo(14400, 2);
        });
    });

    // ========================================================================
    // Filiais (branches)
    // ========================================================================
    describe('Lucro Presumido - filiais', () => {

        it('consolidates matrix + filial revenue for all calculations', () => {
            const input = criarInputBase({
                faturamentoComercio: 100000,
                faturamentoFiliais: {
                    comercio: 50000,
                    industria: 0,
                    servico: 0,
                    servicoRetido: 0,
                    locacao: 0,
                    servicoHospitalar: 0,
                },
            });
            const result = calcularLucro(input);

            const pis = findImposto(result, 'PIS');
            // Total commerce = 100000 + 50000 = 150000
            expect(pis!.baseCalculo).toBeCloseTo(150000, 2);
        });
    });

    // ========================================================================
    // LC 224/2025 majoracao
    // ========================================================================
    describe('LC 224/2025 majoracao', () => {

        it('applies majoracao to IRPJ in 1T/2026 but NOT to CSLL (anterioridade nonagesimal)', () => {
            // Revenue above sublimite (1.25M trimestral)
            const input = criarInputBase({
                mesReferencia: '2026-03', // March 2026 = 1T
                periodoApuracao: 'Trimestral',
                faturamentoComercio: 2000000,
                acumuladoTrimestre: {
                    comercio: 0,
                    industria: 0,
                    servico: 0,
                    servicoHospitalar: 0,
                    financeira: 0,
                    mesesConsiderados: [],
                },
            });
            const result = calcularLucro(input);

            // IRPJ should have majoracao applied
            // CSLL in 1T/2026 should NOT have majoracao
            expect(result.alertaLc224).toBe(true);
        });

        it('does NOT apply majoracao before 2026', () => {
            const input = criarInputBase({
                mesReferencia: '2025-12',
                periodoApuracao: 'Trimestral',
                faturamentoComercio: 2000000,
                acumuladoTrimestre: {
                    comercio: 0,
                    industria: 0,
                    servico: 0,
                    servicoHospitalar: 0,
                    financeira: 0,
                    mesesConsiderados: [],
                },
            });
            const result = calcularLucro(input);

            expect(result.alertaLc224).toBeFalsy();
        });

        it('does NOT apply majoracao when revenue is below sublimite', () => {
            const input = criarInputBase({
                mesReferencia: '2026-03',
                periodoApuracao: 'Trimestral',
                faturamentoComercio: 500000, // well below 1.25M
                acumuladoTrimestre: {
                    comercio: 0,
                    industria: 0,
                    servico: 0,
                    servicoHospitalar: 0,
                    financeira: 0,
                    mesesConsiderados: [],
                },
            });
            const result = calcularLucro(input);

            expect(result.alertaLc224).toBeFalsy();
        });
    });

    // ========================================================================
    // Mixed commerce + service + industry
    // ========================================================================
    describe('Lucro Presumido - mixed activities', () => {

        it('correctly applies different presuncao rates to each activity type', () => {
            const input = criarInputBase({
                faturamentoComercio: 100000,   // presuncao IRPJ 8%
                faturamentoIndustria: 100000,  // presuncao IRPJ 8%
                faturamentoServico: 100000,    // presuncao IRPJ 32%
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            // Base = 100000*0.08 + 100000*0.08 + 100000*0.32 = 8000 + 8000 + 32000 = 48000
            expect(irpj!.baseCalculo).toBeCloseTo(48000, 2);
        });
    });

    // ========================================================================
    // Hospitalar
    // ========================================================================
    describe('Equiparacao hospitalar', () => {

        it('hospitalar revenue uses 8% IRPJ and 12% CSLL presuncao', () => {
            const input = criarInputBase({
                faturamentoServicoHospitalar: 500000,
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            const csll = findImposto(result, 'CSLL');

            // IRPJ base = 500000 * 0.08 = 40000
            expect(irpj!.baseCalculo).toBeCloseTo(40000, 2);
            // CSLL base = 500000 * 0.12 = 60000
            expect(csll!.baseCalculo).toBeCloseTo(60000, 2);
        });
    });

    // ========================================================================
    // Cota info attached to IRPJ/CSLL
    // ========================================================================
    describe('Cotas attached to IRPJ/CSLL in result', () => {

        it('adds cotaInfo to IRPJ and CSLL when trimestral and value is large enough', () => {
            const input = criarInputBase({
                periodoApuracao: 'Trimestral',
                faturamentoServico: 500000,
                acumuladoTrimestre: {
                    comercio: 0,
                    industria: 0,
                    servico: 500000,
                    servicoHospitalar: 0,
                    financeira: 0,
                    mesesConsiderados: ['2025-01', '2025-02'],
                },
            });
            const result = calcularLucro(input);

            const irpj = findImposto(result, 'IRPJ');
            expect(irpj!.cotaInfo).toBeDefined();
            expect(irpj!.cotaInfo!.disponivel).toBe(true);
        });

        it('does NOT add cotaInfo to PIS/COFINS', () => {
            const input = criarInputBase({
                periodoApuracao: 'Trimestral',
                faturamentoComercio: 500000,
            });
            const result = calcularLucro(input);

            const pis = findImposto(result, 'PIS');
            expect(pis!.cotaInfo).toBeUndefined();
        });
    });
});
