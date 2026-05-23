/**
 * Unit tests for the DARF provider calculation logic.
 *
 * Tests the `calcularAcrescimos` function (multa + juros for late payments)
 * and `calcularVencimentoDarf` (due date calculation).
 *
 * The DARF provider is a plain JS module (ESM) in sefaz-backend/.
 * We test the logic by importing the MockProvider via getDarfProvider().
 */

// Mock the dependencies that the darf-provider imports
jest.mock('../sefaz-backend/febraban-barcode.js', () => ({
    gerarBarrasDarf: jest.fn(() => '85860000000100001825123456789012202501002089'),
    gerarLinhaDigitavelArrecadacao: jest.fn(() => '8586.0000 0001.0000 1825.1234 5678.9012 2025.0100 2089'),
}));

jest.mock('../sefaz-backend/darf-codigos-receita.js', () => ({
    sugerirCodigoReceita: jest.fn((_regime: string, tributo: string) => {
        const map: Record<string, any> = {
            IRPJ: { codigo: '2089', descricao: 'IRPJ Presumido' },
            CSLL: { codigo: '2372', descricao: 'CSLL Presumido' },
            PIS: { codigo: '8109', descricao: 'PIS' },
            COFINS: { codigo: '2172', descricao: 'COFINS' },
        };
        return map[tributo] || { codigo: '0000', descricao: 'Desconhecido' };
    }),
}));

jest.mock('../sefaz-backend/serpro-client.js', () => ({
    invokeIntegraContador: jest.fn(),
}));

import { getDarfProvider } from '../sefaz-backend/darf-provider.js';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('DARF Provider (Mock mode)', () => {
    let provider: any;

    beforeAll(() => {
        // Reset the singleton so tests get a fresh MockProvider
        provider = getDarfProvider();
    });

    // ========================================================================
    // Basic DARF generation (on-time payment)
    // ========================================================================
    describe('gerarDarf - on-time payment', () => {

        it('generates DARF with zero multa/juros when no dataPagamento', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-03',
                valor: 5000,
                regime: 'Presumido',
                tributo: 'IRPJ',
                periodicidade: 'trimestral',
            });

            expect(result.valorPrincipal).toBe(5000);
            expect(result.multa).toBe(0);
            expect(result.juros).toBe(0);
            expect(result.valor).toBe(5000);
            expect(result.fonte).toBe('mock');
            expect(result.codigoReceita).toBe('2089');
            expect(result.numeroDocumento).toContain('MOCK-DARF');
        });

        it('generates DARF for PIS with correct codigo de receita', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-06',
                valor: 1500,
                regime: 'Presumido',
                tributo: 'PIS',
            });

            expect(result.codigoReceita).toBe('8109');
            expect(result.multa).toBe(0);
            expect(result.juros).toBe(0);
        });
    });

    // ========================================================================
    // Late payment - multa
    // ========================================================================
    describe('gerarDarf - late payment multa', () => {

        it('calculates multa at 0.33%/day up to 20%', async () => {
            // Vencimento = calculated by the provider, but we override
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-01',
                valor: 10000,
                regime: 'Presumido',
                tributo: 'IRPJ',
                periodicidade: 'trimestral',
                vencimento: '2025-04-30',
                dataPagamento: '2025-05-10', // 10 days late
            });

            // Multa = min(10000 * 0.0033 * 10, 10000 * 0.20)
            //       = min(330, 2000) = 330
            expect(result.multa).toBeCloseTo(330, 2);
            expect(result.valorPrincipal).toBe(10000);
        });

        it('caps multa at 20% (0.33% * ~61 days = 20.13% -> capped at 20%)', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-01',
                valor: 10000,
                regime: 'Presumido',
                tributo: 'IRPJ',
                vencimento: '2025-01-30',
                dataPagamento: '2025-05-30', // ~120 days late (0.33*120 = 39.6% -> capped at 20%)
            });

            // Multa capped at 20%
            expect(result.multa).toBeCloseTo(2000, 2);
        });

        it('1 day late: multa = valor * 0.33%', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-01',
                valor: 5000,
                regime: 'Presumido',
                tributo: 'CSLL',
                vencimento: '2025-02-28',
                dataPagamento: '2025-03-01', // 1 day late
            });

            // Multa = 5000 * 0.0033 * 1 = 16.50
            expect(result.multa).toBeCloseTo(16.50, 2);
        });
    });

    // ========================================================================
    // Late payment - juros (SELIC)
    // ========================================================================
    describe('gerarDarf - late payment juros', () => {

        it('calculates juros based on months of delay * SELIC aprox (0.9%)', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-01',
                valor: 10000,
                regime: 'Presumido',
                tributo: 'IRPJ',
                vencimento: '2025-01-30',
                dataPagamento: '2025-04-30', // 3 months late
            });

            // Juros = 10000 * 0.009 * 3 = 270
            expect(result.juros).toBeCloseTo(270, 2);
        });

        it('minimum 1 month of juros even for < 1 month delay', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-01',
                valor: 10000,
                regime: 'Presumido',
                tributo: 'IRPJ',
                vencimento: '2025-02-15',
                dataPagamento: '2025-02-20', // 5 days, same month -> mesesAtraso = 0, forced to 1
            });

            // Juros = 10000 * 0.009 * 1 = 90
            expect(result.juros).toBeCloseTo(90, 2);
        });
    });

    // ========================================================================
    // Total value
    // ========================================================================
    describe('gerarDarf - valor total', () => {

        it('valor = principal + multa + juros', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-01',
                valor: 10000,
                regime: 'Presumido',
                tributo: 'IRPJ',
                vencimento: '2025-01-30',
                dataPagamento: '2025-03-02', // ~31 days late, 2 months
            });

            const expectedMulta = Math.min(10000 * 0.0033 * 31, 10000 * 0.20);
            const expectedJuros = 10000 * 0.009 * 2; // 2 months
            const expectedTotal = 10000 + expectedMulta + expectedJuros;

            expect(result.valor).toBeCloseTo(expectedTotal, 2);
            expect(result.valor).toBe(
                +(result.valorPrincipal + result.multa + result.juros).toFixed(2)
            );
        });
    });

    // ========================================================================
    // On-time payment (dataPagamento <= vencimento)
    // ========================================================================
    describe('gerarDarf - on-time (payment on or before due date)', () => {

        it('payment on due date: zero multa and juros', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-01',
                valor: 8000,
                regime: 'Presumido',
                tributo: 'IRPJ',
                vencimento: '2025-04-30',
                dataPagamento: '2025-04-30', // exact due date
            });

            expect(result.multa).toBe(0);
            expect(result.juros).toBe(0);
            expect(result.valor).toBe(8000);
        });

        it('payment before due date: zero multa and juros', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-01',
                valor: 8000,
                regime: 'Presumido',
                tributo: 'IRPJ',
                vencimento: '2025-04-30',
                dataPagamento: '2025-04-15', // before due date
            });

            expect(result.multa).toBe(0);
            expect(result.juros).toBe(0);
            expect(result.valor).toBe(8000);
        });
    });

    // ========================================================================
    // Validation
    // ========================================================================
    describe('gerarDarf - validation', () => {

        it('throws when missing required fields', async () => {
            await expect(
                provider.gerarDarf({ empresaCnpj: '12345678000199' })
            ).rejects.toThrow('competencia e valor obrigatorios');
        });

        it('throws when valor < 10', async () => {
            await expect(
                provider.gerarDarf({
                    empresaCnpj: '12345678000199',
                    competencia: '2025-01',
                    valor: 5,
                    regime: 'Presumido',
                    tributo: 'IRPJ',
                })
            ).rejects.toThrow('Valor minimo DARF: R$ 10,00');
        });
    });

    // ========================================================================
    // Vencimento calculation
    // ========================================================================
    describe('vencimento calculation (via gerarDarf without override)', () => {

        it('IRPJ trimestral: vencimento is month after end of quarter', async () => {
            // Competencia 2025-03 -> trimestre 1 -> mesFimTrim = 3 -> venc month = 4
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-03',
                valor: 5000,
                regime: 'Presumido',
                tributo: 'IRPJ',
                periodicidade: 'trimestral',
            });

            // Vencimento should be April 30
            expect(result.vencimento).toBe('2025-04-30');
        });

        it('PIS: vencimento is day 25 of next month', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-06',
                valor: 1500,
                regime: 'Presumido',
                tributo: 'PIS',
            });

            expect(result.vencimento).toBe('2025-07-25');
        });

        it('COFINS: vencimento is day 25 of next month', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-12',
                valor: 3000,
                regime: 'Presumido',
                tributo: 'COFINS',
            });

            // December -> January next year
            expect(result.vencimento).toBe('2026-01-25');
        });

        it('IRPJ trimestral Q4 (competencia 2025-12): vencimento January next year', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-12',
                valor: 5000,
                regime: 'Presumido',
                tributo: 'IRPJ',
                periodicidade: 'trimestral',
            });

            // Q4 trimestre = 4, mesFimTrim = 12, next month = January 2026
            expect(result.vencimento).toBe('2026-01-30');
        });
    });

    // ========================================================================
    // Custom vencimento override
    // ========================================================================
    describe('gerarDarf - custom vencimento', () => {

        it('uses custom vencimento when provided', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-03',
                valor: 5000,
                regime: 'Presumido',
                tributo: 'IRPJ',
                vencimento: '2025-05-15',
            });

            expect(result.vencimento).toBe('2025-05-15');
        });
    });

    // ========================================================================
    // Custom codigoReceita override
    // ========================================================================
    describe('gerarDarf - custom codigoReceita', () => {

        it('uses custom codigoReceita when provided', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-03',
                valor: 5000,
                regime: 'Presumido',
                tributo: 'IRPJ',
                codigoReceita: '9999',
            });

            expect(result.codigoReceita).toBe('9999');
        });
    });

    // ========================================================================
    // Precise arithmetic checks
    // ========================================================================
    describe('precise arithmetic', () => {

        it('multa and juros are rounded to 2 decimal places', async () => {
            const result = await provider.gerarDarf({
                empresaCnpj: '12345678000199',
                competencia: '2025-01',
                valor: 3333.33,
                regime: 'Presumido',
                tributo: 'IRPJ',
                vencimento: '2025-01-30',
                dataPagamento: '2025-02-06', // 7 days late
            });

            // Multa = 3333.33 * 0.0033 * 7 = 76.9999...
            // Rounded to 2 decimals
            expect(result.multa).toBe(+(3333.33 * 0.0033 * 7).toFixed(2));

            // Juros = 3333.33 * 0.009 * 1 = 29.999...
            expect(result.juros).toBe(+(3333.33 * 0.009 * 1).toFixed(2));

            // Total = rounded(principal + multa + juros)
            const expectedTotal = +(3333.33 + result.multa + result.juros).toFixed(2);
            expect(result.valor).toBe(expectedTotal);
        });
    });
});
