/**
 * Unit tests for the core Simples Nacional DAS calculation logic.
 *
 * Tests cover:
 *   - Effective tax rate (aliquota efetiva) per Anexo (I-V)
 *   - RBT12 bracket (faixa) determination
 *   - Fator R causing Anexo V -> III migration
 *   - Proportionalized RBT12 for companies < 12 months old
 *   - Edge cases: zero faturamento, exact bracket boundaries, sublimite
 *   - Tax breakdown (discriminacao de impostos)
 *   - CNAE -> Anexo suggestion
 */

// Mock Firebase before importing anything from the service
jest.mock('../services/firebaseConfig', () => ({
    db: null,
    auth: null,
    isFirebaseConfigured: false,
}));
jest.mock('firebase/firestore', () => ({
    collection: jest.fn(),
    getDocs: jest.fn(),
    doc: jest.fn(),
    setDoc: jest.fn(),
    getDoc: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    deleteDoc: jest.fn(),
}));
jest.mock('../services/geminiService', () => ({
    extractDocumentData: jest.fn(),
    extractPgdasDataFromPdf: jest.fn(),
}));
jest.mock('../services/pgdasPdfParser', () => ({
    parsePgdasExtrato: jest.fn(),
}));
jest.mock('../services/empresaUniquenessService', () => ({
    verificarCnpjDuplicado: jest.fn().mockResolvedValue({ duplicado: false }),
    mensagemCnpjDuplicado: jest.fn(),
}));

import {
    calcularResumoEmpresa,
    calcularDiscriminacaoImpostos,
    parseAndSaveNotas,
    sugerirAnexoPorCnae,
    ANEXOS_TABELAS,
    REPARTICAO_IMPOSTOS,
} from '../services/simplesNacionalService';
import { parsePgdasExtrato } from '../services/pgdasPdfParser';
import { SimplesNacionalEmpresa, SimplesNacionalAnexo } from '../types';

const parsePgdasExtratoMock = parsePgdasExtrato as jest.MockedFunction<typeof parsePgdasExtrato>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal empresa for testing. */
function criarEmpresa(overrides: Partial<SimplesNacionalEmpresa> = {}): SimplesNacionalEmpresa {
    return {
        id: 'test-empresa-1',
        nome: 'Empresa Teste',
        cnpj: '12345678000199',
        cnae: '4711302',
        anexo: 'I' as SimplesNacionalAnexo,
        folha12: 0,
        faturamentoManual: {},
        faturamentoMensalDetalhado: {},
        historicoCalculos: [],
        ...overrides,
    };
}

/**
 * Build a faturamentoManual map with uniform monthly revenue for the 12 months
 * preceding mesReferencia.
 */
function buildFaturamento12Meses(
    mesReferencia: Date,
    valorMensal: number
): Record<string, number> {
    const fat: Record<string, number> = {};
    for (let i = 0; i < 12; i++) {
        const d = new Date(
            mesReferencia.getFullYear(),
            mesReferencia.getMonth() - 12 + i,
            1
        );
        const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        fat[key] = valorMensal;
    }
    return fat;
}

/**
 * Calculate the expected effective tax rate from the table for a given RBT12 and Anexo.
 * Formula: ((RBT12 * aliquota_nominal / 100) - parcela_deduzir) / RBT12 * 100
 */
function calcularAliquotaEfetivaEsperada(
    rbt12: number,
    anexo: string
): number {
    const tabela = ANEXOS_TABELAS[anexo as keyof typeof ANEXOS_TABELAS];
    if (!tabela || rbt12 === 0) return tabela[0].aliquota;

    let faixaIdx = tabela.findIndex(f => rbt12 <= f.limite);
    if (faixaIdx === -1 && rbt12 > 0) faixaIdx = tabela.length - 1;
    if (rbt12 === 0) faixaIdx = 0;
    const faixa = tabela[faixaIdx];
    return ((rbt12 * faixa.aliquota / 100 - faixa.parcela) / rbt12) * 100;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('simplesNacionalService', () => {
    const MES_REF = new Date(2025, 5, 1); // June 2025

    // ========================================================================
    // sugerirAnexoPorCnae
    // ========================================================================
    describe('sugerirAnexoPorCnae', () => {
        it('should suggest Anexo I for retail (CNAE starting with 47)', () => {
            expect(sugerirAnexoPorCnae('47.11-3-02')).toBe('I');
            expect(sugerirAnexoPorCnae('4711302')).toBe('I');
        });
        it('should suggest Anexo II for manufacturing (CNAE starting with 10)', () => {
            expect(sugerirAnexoPorCnae('10.11-2-01')).toBe('II');
        });
        it('should suggest Anexo V for IT (CNAE starting with 62)', () => {
            expect(sugerirAnexoPorCnae('6201-5/01')).toBe('V');
        });
        it('should default to Anexo III for other CNAEs', () => {
            expect(sugerirAnexoPorCnae('7020400')).toBe('III');
            expect(sugerirAnexoPorCnae('8630503')).toBe('III');
        });
    });

    // ========================================================================
    // Tabela de Anexos
    // ========================================================================
    describe('ANEXOS_TABELAS', () => {
        it('should have 6 faixas for each of the 5 Anexos', () => {
            (['I', 'II', 'III', 'IV', 'V'] as const).forEach(anexo => {
                expect(ANEXOS_TABELAS[anexo]).toHaveLength(6);
            });
        });
        it('should have ascending limits', () => {
            Object.values(ANEXOS_TABELAS).forEach((tabela: any) => {
                for (let i = 1; i < tabela.length; i++) {
                    expect(tabela[i].limite).toBeGreaterThan(tabela[i - 1].limite);
                }
            });
        });
        it('Anexo I faixa 1: aliquota 4%, parcela 0', () => {
            expect(ANEXOS_TABELAS['I'][0].aliquota).toBe(4);
            expect(ANEXOS_TABELAS['I'][0].parcela).toBe(0);
            expect(ANEXOS_TABELAS['I'][0].limite).toBe(180000);
        });
        it('Anexo I last faixa: limit is R$ 4.8M', () => {
            expect(ANEXOS_TABELAS['I'][5].limite).toBe(4800000);
        });
    });

    // ========================================================================
    // Basic DAS Calculation per Anexo
    // ========================================================================
    describe('calcularResumoEmpresa - basic DAS per Anexo', () => {

        it.each([
            ['I',   100000],
            ['II',  100000],
            ['III', 100000],
            ['IV',  100000],
            ['V',   100000],
        ])('Anexo %s with RBT12 = R$ 1.2M (R$ %d/month): effective rate matches formula', (anexo, mensal) => {
            const fat = buildFaturamento12Meses(MES_REF, mensal);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = mensal; // current month revenue

            const empresa = criarEmpresa({
                anexo: anexo as SimplesNacionalAnexo,
                faturamentoManual: fat,
            });

            const result = calcularResumoEmpresa(empresa, [], MES_REF);
            const rbt12 = 12 * mensal;
            const expectedAliq = calcularAliquotaEfetivaEsperada(rbt12, anexo);

            expect(result.rbt12).toBe(rbt12);
            expect(result.aliq_eff).toBeCloseTo(expectedAliq, 4);
            expect(result.das_mensal).toBeCloseTo(mensal * expectedAliq / 100, 2);
        });

        it('Anexo I, faixa 1 (RBT12 <= R$ 180k): effective rate = nominal (4%)', () => {
            // RBT12 = 12 * 15000 = 180000 (exactly at faixa 1 boundary)
            const fat = buildFaturamento12Meses(MES_REF, 15000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 15000;

            const empresa = criarEmpresa({
                anexo: 'I',
                faturamentoManual: fat,
            });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            // Faixa 1 has parcela = 0, so effective = nominal = 4%
            expect(result.rbt12).toBe(180000);
            expect(result.aliq_eff).toBeCloseTo(4.0, 4);
            expect(result.das_mensal).toBeCloseTo(15000 * 0.04, 2);
        });

        it('Anexo I, faixa 2 (R$ 180k < RBT12 <= R$ 360k): effective rate correctly computed', () => {
            // RBT12 = 12 * 25000 = 300000
            const fat = buildFaturamento12Meses(MES_REF, 25000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 25000;

            const empresa = criarEmpresa({
                anexo: 'I',
                faturamentoManual: fat,
            });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            // Faixa 2: aliquota 7.3%, parcela 5940
            // Aliq efetiva = ((300000 * 0.073) - 5940) / 300000 * 100
            //              = (21900 - 5940) / 300000 * 100 = 15960 / 300000 * 100 = 5.32%
            const expected = ((300000 * 7.3 / 100) - 5940) / 300000 * 100;
            expect(result.rbt12).toBe(300000);
            expect(result.aliq_eff).toBeCloseTo(expected, 4);
        });
    });

    // ========================================================================
    // Faixa boundary edge cases
    // ========================================================================
    describe('calcularResumoEmpresa - faixa boundary edge cases', () => {

        it('RBT12 exactly at R$ 180,000 boundary stays in faixa 1 (Anexo I)', () => {
            // 180000 <= 180000 -> faixa index 0
            const fat = buildFaturamento12Meses(MES_REF, 15000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 15000;

            const empresa = criarEmpresa({ anexo: 'I', faturamentoManual: fat });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.faixa_index).toBe(0);
            expect(result.aliq_nom).toBe(4);
        });

        it('RBT12 = R$ 180,001 moves to faixa 2 (Anexo I)', () => {
            // Use uneven amounts to get RBT12 just above 180k
            // 12 months of 15000 = 180000. Add 1 extra in one month.
            const fat = buildFaturamento12Meses(MES_REF, 15000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 15000;
            // Bump one historical month by 1
            const firstKey = Object.keys(fat)[0];
            fat[firstKey] = 15001;

            const empresa = criarEmpresa({ anexo: 'I', faturamentoManual: fat });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.rbt12).toBe(180001);
            expect(result.faixa_index).toBe(1);
            expect(result.aliq_nom).toBe(7.3);
        });

        it('RBT12 exactly at R$ 3,600,000 (faixa 5 boundary)', () => {
            const fat = buildFaturamento12Meses(MES_REF, 300000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 300000;

            const empresa = criarEmpresa({ anexo: 'I', faturamentoManual: fat });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.rbt12).toBe(3600000);
            expect(result.faixa_index).toBe(4); // 0-indexed faixa 5
            expect(result.aliq_nom).toBe(14.3);
        });
    });

    // ========================================================================
    // Zero faturamento
    // ========================================================================
    describe('calcularResumoEmpresa - zero faturamento', () => {

        it('returns zero DAS when there is no revenue', () => {
            const empresa = criarEmpresa({ anexo: 'I', faturamentoManual: {} });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.rbt12).toBe(0);
            expect(result.das_mensal).toBe(0);
            expect(result.aliq_eff).toBe(0);
        });

        it('returns zero DAS when current month has no revenue but history exists', () => {
            const fat = buildFaturamento12Meses(MES_REF, 10000);
            // Do NOT set current month
            const empresa = criarEmpresa({ anexo: 'I', faturamentoManual: fat });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.rbt12).toBe(120000);
            expect(result.das_mensal).toBe(0); // no current month revenue
        });
    });

    // ========================================================================
    // Fator R - Anexo V -> III migration
    // ========================================================================
    describe('calcularResumoEmpresa - Fator R', () => {

        it('Fator R >= 0.28 migrates Anexo V to III', () => {
            const rbt12 = 240000; // R$ 20k/month
            const fat = buildFaturamento12Meses(MES_REF, 20000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 20000;

            // folha12 = 28% of RBT12
            const folha12 = rbt12 * 0.28;
            const empresa = criarEmpresa({
                anexo: 'V',
                faturamentoManual: fat,
                folha12,
            });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.fator_r).toBeCloseTo(0.28, 4);
            // When Fator R >= 0.28, Anexo V items should be calculated using Anexo III rates
            const detalhamento = result.detalhamento_anexos;
            expect(detalhamento).toBeDefined();
            expect(detalhamento!.length).toBeGreaterThan(0);
            expect(detalhamento![0].anexo).toBe('III');

            // Verify the effective rate matches Anexo III, not V
            const aliqExpectedIII = calcularAliquotaEfetivaEsperada(rbt12, 'III');
            expect(result.aliq_eff).toBeCloseTo(aliqExpectedIII, 4);
        });

        it('Fator R < 0.28 keeps Anexo V', () => {
            const rbt12 = 240000;
            const fat = buildFaturamento12Meses(MES_REF, 20000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 20000;

            const folha12 = rbt12 * 0.27; // below 28%
            const empresa = criarEmpresa({
                anexo: 'V',
                faturamentoManual: fat,
                folha12,
            });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.fator_r).toBeCloseTo(0.27, 4);
            const detalhamento = result.detalhamento_anexos;
            expect(detalhamento![0].anexo).toBe('V');

            const aliqExpectedV = calcularAliquotaEfetivaEsperada(rbt12, 'V');
            expect(result.aliq_eff).toBeCloseTo(aliqExpectedV, 4);
        });

        it('Anexo III_V: resolves to III when Fator R >= 0.28', () => {
            const fat = buildFaturamento12Meses(MES_REF, 20000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 20000;

            const empresa = criarEmpresa({
                anexo: 'III_V' as SimplesNacionalAnexo,
                faturamentoManual: fat,
                folha12: 240000 * 0.30,
            });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.fator_r).toBeCloseTo(0.30, 4);
            expect(result.detalhamento_anexos![0].anexo).toBe('III');
        });

        it('Anexo III_V: resolves to V when Fator R < 0.28', () => {
            const fat = buildFaturamento12Meses(MES_REF, 20000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 20000;

            const empresa = criarEmpresa({
                anexo: 'III_V' as SimplesNacionalAnexo,
                faturamentoManual: fat,
                folha12: 240000 * 0.10,
            });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.fator_r).toBeCloseTo(0.10, 4);
            expect(result.detalhamento_anexos![0].anexo).toBe('V');
        });

        it('ISS retido no Anexo V deduz a repartição REAL da faixa (não 23,5% fixo)', () => {
            // Regressão: o Anexo V usava 23,5% fixo pra deduzir o ISS retido; o
            // correto é o ISS da faixa (faixa 0 = 48,05%), igual aos Anexos III/IV.
            const rbt12 = 180000; // faixa 0 do Anexo V (<= 180.000)
            const fat = buildFaturamento12Meses(MES_REF, 15000); // 12 × 15.000
            const empresa = criarEmpresa({
                anexo: 'V',
                faturamentoManual: fat,
                folha12: rbt12 * 0.10, // Fator R < 0.28 mantém Anexo V
            });
            const itemBase = {
                cnae: '6201501', anexo: 'V' as SimplesNacionalAnexo, valor: 15000,
                issRetido: false, icmsSt: false, isSup: false,
                isMonofasico: false, isImune: false, isExterior: false,
            };
            const sem = calcularResumoEmpresa(empresa, [], MES_REF, { itensCalculo: [itemBase] });
            const com = calcularResumoEmpresa(empresa, [], MES_REF, {
                itensCalculo: [{ ...itemBase, issRetido: true }],
            });

            const issFaixa0V = REPARTICAO_IMPOSTOS['V'][0].ISS ?? 0; // 48.05
            // Com ISS retido, o DAS cai pela proporção de ISS da faixa.
            expect(com.das_mensal).toBeCloseTo(sem.das_mensal * (1 - issFaixa0V / 100), 4);
            // Sanidade: com o 23,5% antigo a razão seria 0,765 — bem diferente.
            expect(com.das_mensal / sem.das_mensal).toBeCloseTo(0.5195, 4);
        });

        it('Fator R with zero RBT12 yields fator_r = 0', () => {
            const empresa = criarEmpresa({
                anexo: 'V',
                faturamentoManual: {},
                folha12: 50000,
            });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);
            expect(result.fator_r).toBe(0);
        });

        it('Manual fatorR override takes precedence', () => {
            const fat = buildFaturamento12Meses(MES_REF, 20000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 20000;

            const empresa = criarEmpresa({
                anexo: 'V',
                faturamentoManual: fat,
                folha12: 0, // would yield fator_r = 0
            });
            // Force fator R = 0.30 via options
            const result = calcularResumoEmpresa(empresa, [], MES_REF, { fatorRManual: 0.30 });

            // fator_r should be the manual value
            expect(result.fator_r).toBeCloseTo(0.30, 4);
            // And should migrate to Anexo III
            expect(result.detalhamento_anexos![0].anexo).toBe('III');
        });
    });

    // ========================================================================
    // Proportionalized RBT12 (inicio de atividade < 12 months)
    // ========================================================================
    describe('calcularResumoEmpresa - RBT12 proporcionalizado', () => {

        it('First month of activity: RBT12p = receita PA x 12', () => {
            // Company opened in June 2025, calculating for June 2025 (first month)
            const mesRef = new Date(2025, 5, 1); // June 2025
            const mesChave = '2025-06';
            const fat: Record<string, number> = { [mesChave]: 30000 };

            const empresa = criarEmpresa({
                anexo: 'I',
                faturamentoManual: fat,
                dataAbertura: '2025-06-01',
            });
            const result = calcularResumoEmpresa(empresa, [], mesRef);

            expect(result.inicioAtividade).toBe(true);
            expect(result.mesesAtividade).toBe(0); // first month
            // RBT12p = 30000 * 12 = 360000
            // Effective rate uses RBT12p for bracket lookup
            const expectedAliq = calcularAliquotaEfetivaEsperada(360000, 'I');
            expect(result.aliq_eff).toBeCloseTo(expectedAliq, 4);
        });

        it('3 months of activity: RBT12p = (sum of 3 months / 3) x 12', () => {
            const mesRef = new Date(2025, 5, 1); // June 2025
            // Company opened April 2025, so by June we have 2 months before (Apr, May)
            // mesesAtividade = Apr to May = 2 months
            const fat: Record<string, number> = {
                '2025-04': 20000,
                '2025-05': 30000,
                '2025-06': 25000, // current month
            };

            const empresa = criarEmpresa({
                anexo: 'I',
                faturamentoManual: fat,
                dataAbertura: '2025-04-01',
            });
            const result = calcularResumoEmpresa(empresa, [], mesRef);

            expect(result.inicioAtividade).toBe(true);
            expect(result.mesesAtividade).toBe(2);
            // RBT12 real (sum of 12m before) only catches Apr+May = 50000
            expect(result.rbt12).toBe(50000);
            // RBT12p = (50000 / 2) * 12 = 300000
            expect(result.rbt12pInterno).toBeCloseTo(300000, 0);
        });

        it('12+ months of activity: normal RBT12 (no proportionalization)', () => {
            const mesRef = new Date(2025, 5, 1);
            const fat = buildFaturamento12Meses(mesRef, 15000);
            fat['2025-06'] = 15000;

            const empresa = criarEmpresa({
                anexo: 'I',
                faturamentoManual: fat,
                dataAbertura: '2024-01-01', // opened 17 months ago
            });
            const result = calcularResumoEmpresa(empresa, [], mesRef);

            expect(result.inicioAtividade).toBe(false);
            expect(result.rbt12pInterno).toBeUndefined();
        });
    });

    // ========================================================================
    // Sublimite (R$ 3.6M)
    // ========================================================================
    describe('calcularResumoEmpresa - sublimite', () => {

        it('marks ultrapassou_sublimite = true when RBT12 > R$ 3.6M', () => {
            const fat = buildFaturamento12Meses(MES_REF, 310000);
            fat[`${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`] = 310000;

            const empresa = criarEmpresa({ anexo: 'I', faturamentoManual: fat });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.rbt12).toBe(3720000);
            expect(result.ultrapassou_sublimite).toBe(true);
        });

        it('marks ultrapassou_sublimite = false when RBT12 <= R$ 3.6M', () => {
            const fat = buildFaturamento12Meses(MES_REF, 300000);
            fat[`${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`] = 300000;

            const empresa = criarEmpresa({ anexo: 'I', faturamentoManual: fat });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.rbt12).toBe(3600000);
            expect(result.ultrapassou_sublimite).toBe(false);
        });
    });

    // ========================================================================
    // Multiple CNAE / Anexo (faturamento detalhado)
    // ========================================================================
    describe('calcularResumoEmpresa - multiple CNAE/Anexo items', () => {

        it('calculates DAS with two activities in different Anexos', () => {
            const rbt12 = 240000;
            const fat = buildFaturamento12Meses(MES_REF, 20000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 25000;

            // Detailed monthly: 15000 in Anexo I (commerce) + 10000 in Anexo III (services)
            const detalhado: any = {
                [mesChave]: {
                    'atividade::comercio::4711302::I': { valor: 15000, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false },
                    'atividade::servicos::6201501::III': { valor: 10000, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false },
                },
            };

            const empresa = criarEmpresa({
                anexo: 'I',
                faturamentoManual: fat,
                faturamentoMensalDetalhado: detalhado,
            });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.detalhamento_anexos).toBeDefined();
            expect(result.detalhamento_anexos!.length).toBe(2);

            const itemI = result.detalhamento_anexos!.find(d => d.anexo === 'I');
            const itemIII = result.detalhamento_anexos!.find(d => d.anexo === 'III');
            expect(itemI).toBeDefined();
            expect(itemIII).toBeDefined();
            expect(itemI!.faturamento).toBe(15000);
            expect(itemIII!.faturamento).toBe(10000);

            // Total DAS = sum of both items' DAS
            expect(result.das_mensal).toBeCloseTo(
                itemI!.valorDas + itemIII!.valorDas, 2
            );
        });
    });

    // ========================================================================
    // ISS retido deduction
    // ========================================================================
    describe('calcularResumoEmpresa - ISS retido/SUP deduction', () => {

        it('deducts ISS portion when issRetido is true (Anexo III)', () => {
            const rbt12 = 240000;
            const fat = buildFaturamento12Meses(MES_REF, 20000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 20000;

            // Without ISS retido
            const empresaSem = criarEmpresa({
                anexo: 'III',
                faturamentoManual: fat,
            });
            const resultSem = calcularResumoEmpresa(empresaSem, [], MES_REF);

            // With ISS retido via itensCalculo
            const resultCom = calcularResumoEmpresa(empresaSem, [], MES_REF, {
                itensCalculo: [{
                    cnae: '6201501', anexo: 'III' as SimplesNacionalAnexo,
                    valor: 20000, issRetido: true, icmsSt: false,
                    isSup: false, isMonofasico: false, isImune: false, isExterior: false,
                }],
            });

            // DAS with ISS retido should be less
            expect(resultCom.das_mensal).toBeLessThan(resultSem.das_mensal);
        });
    });

    // ========================================================================
    // calcularDiscriminacaoImpostos
    // ========================================================================
    describe('calcularDiscriminacaoImpostos', () => {

        it('distributes DAS value according to REPARTICAO table (Anexo I, faixa 0)', () => {
            const valorDas = 1000;
            const disc = calcularDiscriminacaoImpostos('I', 0, valorDas);

            const rep = REPARTICAO_IMPOSTOS['I'][0];
            expect(disc.IRPJ).toBeCloseTo(valorDas * rep.IRPJ! / 100, 2);
            expect(disc.CSLL).toBeCloseTo(valorDas * rep.CSLL! / 100, 2);
            expect(disc.COFINS).toBeCloseTo(valorDas * rep.COFINS! / 100, 2);
            expect(disc.PIS).toBeCloseTo(valorDas * rep.PIS! / 100, 2);
            expect(disc.CPP).toBeCloseTo(valorDas * rep.CPP! / 100, 2);
            expect(disc.ICMS).toBeCloseTo(valorDas * rep.ICMS! / 100, 2);

            // Sum of all parts should equal the total DAS
            const total = Object.values(disc).reduce((s: number, v) => s + (v as number), 0);
            expect(total).toBeCloseTo(valorDas, 2);
        });

        it('returns empty object when valorDas = 0', () => {
            const disc = calcularDiscriminacaoImpostos('I', 0, 0);
            expect(disc).toEqual({});
        });

        it('caps faixa index at 5', () => {
            const disc = calcularDiscriminacaoImpostos('I', 999, 1000);
            const rep = REPARTICAO_IMPOSTOS['I'][5];
            expect(disc.IRPJ).toBeCloseTo(1000 * rep.IRPJ! / 100, 2);
        });
    });

    // ========================================================================
    // DAS annual value
    // ========================================================================
    describe('calcularResumoEmpresa - das (annual) field', () => {

        it('das = das_mensal * 12', () => {
            const fat = buildFaturamento12Meses(MES_REF, 20000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 20000;

            const empresa = criarEmpresa({ anexo: 'I', faturamentoManual: fat });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.das).toBeCloseTo(result.das_mensal * 12, 2);
        });
    });

    // ========================================================================
    // Historico simulado
    // ========================================================================
    describe('calcularResumoEmpresa - historico_simulado', () => {

        it('always generates 12 months of historico_simulado', () => {
            const empresa = criarEmpresa({ anexo: 'I', faturamentoManual: {} });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            expect(result.historico_simulado).toHaveLength(12);
        });
    });

    // ========================================================================
    // Mercado interno / externo split
    // ========================================================================
    describe('calcularResumoEmpresa - mercado interno/externo', () => {

        it('correctly splits internal vs external revenue', () => {
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            const fat: Record<string, number> = {};
            for (let i = 0; i < 12; i++) {
                const d = new Date(MES_REF.getFullYear(), MES_REF.getMonth() - 12 + i, 1);
                const k = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
                fat[k] = 20000;
            }
            fat[mesChave] = 30000; // 20k internal, 10k external

            const resultado = calcularResumoEmpresa(
                criarEmpresa({ anexo: 'I', faturamentoManual: fat }),
                [],
                MES_REF,
                {
                    itensCalculo: [
                        { cnae: '4711302', anexo: 'I' as SimplesNacionalAnexo, valor: 20000, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false },
                        { cnae: '4711302', anexo: 'I' as SimplesNacionalAnexo, valor: 10000, issRetido: false, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: true },
                    ],
                }
            );

            expect(resultado.totalMercadoInterno).toBe(20000);
            expect(resultado.totalMercadoExterno).toBe(10000);
        });
    });

    // ========================================================================
    // Anexo II specific verification
    // ========================================================================
    describe('calcularResumoEmpresa - Anexo II specific', () => {

        it('Anexo II faixa 3 (R$ 720k < RBT12 <= R$ 1.8M) effective rate', () => {
            // RBT12 = 12 * 100000 = 1200000
            const fat = buildFaturamento12Meses(MES_REF, 100000);
            const mesChave = `${MES_REF.getFullYear()}-${(MES_REF.getMonth() + 1).toString().padStart(2, '0')}`;
            fat[mesChave] = 100000;

            const empresa = criarEmpresa({ anexo: 'II', faturamentoManual: fat });
            const result = calcularResumoEmpresa(empresa, [], MES_REF);

            // Faixa 4 (index 3): aliquota 11.2%, parcela 22500
            // Aliq efetiva = ((1200000 * 0.112) - 22500) / 1200000 * 100
            //              = (134400 - 22500) / 1200000 * 100 = 9.325%
            const expected = ((1200000 * 11.2 / 100) - 22500) / 1200000 * 100;
            expect(result.aliq_eff).toBeCloseTo(expected, 4);
            expect(result.das_mensal).toBeCloseTo(100000 * expected / 100, 2);
        });
    });

    // ========================================================================
    // Regression: correct RBT12 accumulation
    // ========================================================================
    describe('calcularResumoEmpresa - RBT12 accumulation', () => {

        it('sums exactly the 12 months BEFORE the reference month (not including it)', () => {
            const mesRef = new Date(2025, 5, 1); // June 2025
            const fat: Record<string, number> = {};

            // Put revenue only in June 2024 through May 2025 (12 months before)
            for (let i = 0; i < 12; i++) {
                const d = new Date(2024, 5 + i, 1);
                const k = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
                fat[k] = 10000;
            }
            // June 2025 itself (current month)
            fat['2025-06'] = 50000;

            const empresa = criarEmpresa({ anexo: 'I', faturamentoManual: fat });
            const result = calcularResumoEmpresa(empresa, [], mesRef);

            // RBT12 = 12 * 10000 = 120000 (does NOT include current month)
            expect(result.rbt12).toBe(120000);
            // But DAS is calculated on current month revenue
            expect(result.das_mensal).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // Regression: PGDAS import updates RBT12 history immediately
    // ========================================================================
    describe('parseAndSaveNotas - PGDAS-D import', () => {
        beforeEach(() => {
            localStorage.clear();
            jest.clearAllMocks();
        });

        it('normaliza periodos e devolve faturamentoManual atualizado para a tela', async () => {
            const empresa = criarEmpresa({
                id: 'empresa-pgdas',
                faturamentoManual: { '2025-01': 100 },
            });
            localStorage.setItem('simples_nacional_empresas', JSON.stringify([empresa]));
            parsePgdasExtratoMock.mockResolvedValue({
                historico: [
                    { periodo: ' 05/2026 ', valor: 1234.56 },
                    { periodo: '2026-04', valor: '2.000,10' as any },
                    { periodo: '2026-03', valor: '2000.10' as any },
                    { periodo: '7/2025', valor: 300 },
                ],
                rbt12Declarado: 5534.76,
                rbt12Calculado: 5534.76,
                bate: true,
            });

            const file = {
                name: 'pgdas.pdf',
                arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
            } as unknown as File;

            const result = await parseAndSaveNotas('empresa-pgdas', file);
            expect(result.successCount).toBe(4);
            expect(result.faturamentoManual).toMatchObject({
                '2025-01': 100,
                '2025-07': 300,
                '2026-03': 2000.10,
                '2026-04': 2000.10,
                '2026-05': 1234.56,
            });

            const stored = JSON.parse(localStorage.getItem('simples_nacional_empresas') || '[]');
            expect(stored[0].faturamentoManual).toMatchObject(result.faturamentoManual || {});
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// ISENÇÃO ≠ IMUNIDADE NO CÁLCULO — e a diferença é o IPI.
//
// Imunidade (POLO CULTURAL, CF art. 150 VI "d"): tira ICMS **e** IPI.
// Isenção de ICMS (JAGUAREXPORT, lei estadual): tira **só o ICMS**.
//
// O formulário do e-CAC corrobora: o `<select>` do IPI (código 1008) não tem
// "Isenção/Redução" — ele para em "Lançamento de Ofício". E o extrato da
// JAGUAREXPORT 07/2026 confirma: ICMS 0,00 e o resto cobrado normalmente
// (IRPJ 335,49 · CSLL 213,49 · COFINS 777,12 · PIS 168,35 · CPP 2.561,92).
// ═══════════════════════════════════════════════════════════════════════════
describe('isenção de ICMS no cálculo do DAS', () => {
    const MES = new Date(2025, 5, 1);
    const itemBase = {
        cnae: '4632001', anexo: 'II' as SimplesNacionalAnexo, valor: 20000,
        issRetido: false, icmsSt: false, isSup: false,
        isMonofasico: false, isImune: false, isExterior: false,
    };
    const empresaII = () => criarEmpresa({
        anexo: 'II',
        faturamentoManual: buildFaturamento12Meses(MES, 20000),
    });

    const das = (over: any) => calcularResumoEmpresa(
        empresaII(), [], MES, { itensCalculo: [{ ...itemBase, ...over }] },
    ).das_mensal;

    it('isenção deduz a repartição de ICMS da faixa', () => {
        const semNada = das({});
        const isento = das({ isIsento: true });
        const icms = REPARTICAO_IMPOSTOS['II'][0].ICMS ?? 0;
        expect(icms).toBeGreaterThan(0);
        expect(isento).toBeCloseTo(semNada * (1 - icms / 100), 4);
    });

    it('e NÃO deduz o IPI — é aí que ela difere da imunidade', () => {
        const isento = das({ isIsento: true });
        const imune = das({ isImune: true });
        const ipi = REPARTICAO_IMPOSTOS['II'][0].IPI ?? 0;
        expect(ipi).toBeGreaterThan(0);          // Anexo II tem IPI na repartição
        expect(imune).toBeLessThan(isento);      // imunidade tira mais
        const semNada = das({});
        expect(imune).toBeCloseTo(
            semNada * (1 - ((REPARTICAO_IMPOSTOS['II'][0].ICMS ?? 0) + ipi) / 100), 4,
        );
    });

    it('sem a marcação, nada é deduzido', () => {
        expect(das({ isIsento: false })).toBeCloseTo(das({}), 6);
    });
});
