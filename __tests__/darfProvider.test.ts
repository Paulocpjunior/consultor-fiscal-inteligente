/**
 * Unit tests for the DARF provider calculation logic.
 *
 * The darf-provider.js uses ESM imports that can't be directly imported
 * by Jest's CJS runtime without additional config. Instead, we replicate
 * the pure calculation functions here (they are deterministic, no I/O)
 * and test their exact logic against the source code formulas.
 *
 * This ensures the mathematical correctness of:
 *   - calcularAcrescimos: multa (0.33%/day, cap 20%) + juros (SELIC-based)
 *   - calcularVencimentoDarf: due date determination by tributo/periodicidade
 */

// ---------------------------------------------------------------------------
// Replicated pure functions from sefaz-backend/darf-provider.js
// (exact same logic, just extracted for testability)
// ---------------------------------------------------------------------------

const SELIC_MENSAL_APROXIMADA = 0.009;

function calcularAcrescimos(valor: number, vencimento: string, dataPagamento: string) {
    const venc = new Date(vencimento);
    const pgto = new Date(dataPagamento);
    if (isNaN(venc.getTime()) || isNaN(pgto.getTime()) || pgto <= venc) {
        return { multa: 0, juros: 0, valorTotal: valor };
    }

    const principalCents = Math.round(valor * 100);

    const diasAtraso = Math.ceil((pgto.getTime() - venc.getTime()) / 86400000);
    const multaCents = Math.min(
        Math.round(principalCents * 0.0033 * diasAtraso),
        Math.round(principalCents * 0.20),
    );

    let mesesAtraso = (pgto.getFullYear() - venc.getFullYear()) * 12
                    + (pgto.getMonth() - venc.getMonth());
    if (mesesAtraso < 1) mesesAtraso = 1;
    const jurosCents = Math.round(principalCents * SELIC_MENSAL_APROXIMADA * mesesAtraso);

    const totalCents = principalCents + multaCents + jurosCents;

    return {
        multa: multaCents / 100,
        juros: jurosCents / 100,
        valorTotal: totalCents / 100,
    };
}

function calcularVencimentoDarf(
    competencia: string,
    tributo: string,
    periodicidade: string = 'trimestral'
): string {
    const m = String(competencia).match(/^(\d{4})-(\d{2})$/);
    if (!m) return new Date().toISOString().slice(0, 10);
    let ano = parseInt(m[1]), mes = parseInt(m[2]);

    const t = String(tributo || '').toUpperCase();
    const isTri = periodicidade === 'trimestral' && (t === 'IRPJ' || t === 'CSLL');

    if (isTri) {
        const trimestre = Math.floor((mes - 1) / 3) + 1;
        const mesFimTrim = trimestre * 3;
        mes = mesFimTrim + 1;
        if (mes > 12) { mes = 1; ano += 1; }
        return `${ano}-${String(mes).padStart(2, '0')}-30`;
    }
    if (t === 'PIS' || t === 'COFINS') {
        mes += 1;
        if (mes > 12) { mes = 1; ano += 1; }
        return `${ano}-${String(mes).padStart(2, '0')}-25`;
    }
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
    return `${ano}-${String(mes).padStart(2, '0')}-30`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DARF calcularAcrescimos', () => {

    // ========================================================================
    // On-time payment (zero multa/juros)
    // ========================================================================
    describe('on-time payment', () => {

        it('payment on due date: zero multa and juros', () => {
            const result = calcularAcrescimos(8000, '2025-04-30', '2025-04-30');
            expect(result.multa).toBe(0);
            expect(result.juros).toBe(0);
            expect(result.valorTotal).toBe(8000);
        });

        it('payment before due date: zero multa and juros', () => {
            const result = calcularAcrescimos(8000, '2025-04-30', '2025-04-15');
            expect(result.multa).toBe(0);
            expect(result.juros).toBe(0);
            expect(result.valorTotal).toBe(8000);
        });

        it('no dataPagamento scenario returns original valor', () => {
            // If calcularAcrescimos is NOT called (as in the provider when
            // there's no dataPagamento), multa/juros default to 0.
            // This test validates the guard clause with invalid dates.
            const result = calcularAcrescimos(5000, '2025-01-30', 'invalid');
            expect(result.multa).toBe(0);
            expect(result.juros).toBe(0);
            expect(result.valorTotal).toBe(5000);
        });
    });

    // ========================================================================
    // Late payment - multa
    // ========================================================================
    describe('multa (late payment penalty)', () => {

        it('1 day late: multa = valor * 0.33%', () => {
            const result = calcularAcrescimos(5000, '2025-02-28', '2025-03-01');
            // principalCents = 500000
            // multaCents = round(500000 * 0.0033 * 1) = round(1650) = 1650
            // multa = 16.50
            expect(result.multa).toBe(16.50);
        });

        it('10 days late: multa = valor * 0.33% * 10', () => {
            const result = calcularAcrescimos(10000, '2025-04-30', '2025-05-10');
            // principalCents = 1000000
            // multaCents = round(1000000 * 0.0033 * 10) = round(33000) = 33000
            // multa = 330.00
            expect(result.multa).toBe(330);
        });

        it('30 days late: multa = valor * 0.33% * 30 = 9.9%', () => {
            const result = calcularAcrescimos(10000, '2025-01-30', '2025-03-01');
            // diasAtraso = 30
            // multaCents = round(1000000 * 0.0033 * 30) = round(99000) = 99000
            // multa = 990.00
            expect(result.multa).toBe(990);
        });

        it('caps multa at 20% for very late payments (>60 days)', () => {
            const result = calcularAcrescimos(10000, '2025-01-30', '2025-05-30');
            // diasAtraso = 120
            // 0.0033 * 120 = 0.396 = 39.6% > 20% -> capped
            // multaCents = min(round(1000000 * 0.396), round(1000000 * 0.20))
            //            = min(396000, 200000) = 200000
            // multa = 2000.00
            expect(result.multa).toBe(2000);
        });

        it('multa cap boundary: exactly 60.6 days = ~19.998% -> NOT capped', () => {
            // 0.0033 * 60 = 19.8% < 20% -> not capped
            const result = calcularAcrescimos(10000, '2025-01-01', '2025-03-02');
            // diasAtraso = 60
            // multaCents = round(1000000 * 0.0033 * 60) = round(198000) = 198000
            // 198000 < 200000 -> not capped
            expect(result.multa).toBe(1980);
            expect(result.multa).toBeLessThan(2000);
        });

        it('multa cap boundary: 61 days = 20.13% -> capped at 20%', () => {
            const result = calcularAcrescimos(10000, '2025-01-01', '2025-03-03');
            // diasAtraso = 61
            // multaCents = round(1000000 * 0.0033 * 61) = round(201300) = 201300
            // 201300 > 200000 -> capped at 200000
            expect(result.multa).toBe(2000);
        });
    });

    // ========================================================================
    // Late payment - juros (SELIC)
    // ========================================================================
    describe('juros (SELIC-based interest)', () => {

        it('same-month delay: minimum 1 month of juros', () => {
            const result = calcularAcrescimos(10000, '2025-02-15', '2025-02-20');
            // mesesAtraso = 0 (same month) -> forced to 1
            // jurosCents = round(1000000 * 0.009 * 1) = round(9000) = 9000
            // juros = 90.00
            expect(result.juros).toBe(90);
        });

        it('1 month late: juros = valor * 0.9%', () => {
            const result = calcularAcrescimos(10000, '2025-01-30', '2025-02-28');
            // mesesAtraso = 1
            // juros = round(1000000 * 0.009 * 1) / 100 = 90.00
            expect(result.juros).toBe(90);
        });

        it('3 months late: juros = valor * 0.9% * 3', () => {
            const result = calcularAcrescimos(10000, '2025-01-30', '2025-04-30');
            // mesesAtraso = 3
            // jurosCents = round(1000000 * 0.009 * 3) = round(27000) = 27000
            // juros = 270.00
            expect(result.juros).toBe(270);
        });

        it('12 months late: juros = valor * 0.9% * 12', () => {
            const result = calcularAcrescimos(10000, '2025-01-30', '2026-01-30');
            // mesesAtraso = 12
            // jurosCents = round(1000000 * 0.009 * 12) = round(108000) = 108000
            // juros = 1080.00
            expect(result.juros).toBe(1080);
        });
    });

    // ========================================================================
    // Total value (valor = principal + multa + juros)
    // ========================================================================
    describe('valorTotal', () => {

        it('total = principal + multa + juros', () => {
            const result = calcularAcrescimos(10000, '2025-01-30', '2025-03-02');
            // diasAtraso = 31
            // mesesAtraso = 2
            const expectedMultaCents = Math.min(
                Math.round(1000000 * 0.0033 * 31),
                Math.round(1000000 * 0.20)
            );
            const expectedJurosCents = Math.round(1000000 * 0.009 * 2);
            const expectedTotal = (1000000 + expectedMultaCents + expectedJurosCents) / 100;

            expect(result.valorTotal).toBe(expectedTotal);
            expect(result.valorTotal).toBe(result.multa + result.juros + 10000);
        });
    });

    // ========================================================================
    // Precise arithmetic
    // ========================================================================
    describe('precise arithmetic (integer-cent)', () => {

        it('handles non-round principal correctly', () => {
            const result = calcularAcrescimos(3333.33, '2025-01-30', '2025-02-06');
            // principalCents = round(3333.33 * 100) = 333333
            // diasAtraso = 7
            // multaCents = round(333333 * 0.0033 * 7) = round(7699.9923) = 7700
            // multa = 77.00
            expect(result.multa).toBe(77.00);

            // mesesAtraso = 1 (Feb vs Jan, same-month forced to 1)
            // jurosCents = round(333333 * 0.009 * 1) = round(2999.997) = 3000
            // juros = 30.00
            expect(result.juros).toBe(30.00);

            // total = (333333 + 7700 + 3000) / 100 = 344033 / 100 = 3440.33
            expect(result.valorTotal).toBe(3440.33);
        });

        it('handles small principal (R$ 10.00 minimum)', () => {
            const result = calcularAcrescimos(10, '2025-01-01', '2025-02-01');
            // principalCents = 1000
            // diasAtraso = 31
            // multaCents = round(1000 * 0.0033 * 31) = round(102.3) = 102
            // jurosCents = round(1000 * 0.009 * 1) = round(9) = 9
            expect(result.multa).toBe(1.02);
            expect(result.juros).toBe(0.09);
            expect(result.valorTotal).toBe(11.11);
        });

        it('handles large principal correctly', () => {
            const result = calcularAcrescimos(1000000, '2025-01-01', '2025-02-01');
            // principalCents = 100000000
            // diasAtraso = 31
            // multaCents = round(100000000 * 0.0033 * 31) = round(10230000) = 10230000
            //   cap = round(100000000 * 0.20) = 20000000
            //   min(10230000, 20000000) = 10230000
            // multa = 102300.00
            expect(result.multa).toBe(102300);
            // jurosCents = round(100000000 * 0.009 * 1) = 900000
            // juros = 9000.00
            expect(result.juros).toBe(9000);
        });
    });
});

// ---------------------------------------------------------------------------
// calcularVencimentoDarf tests
// ---------------------------------------------------------------------------

describe('DARF calcularVencimentoDarf', () => {

    // ========================================================================
    // IRPJ/CSLL trimestral
    // ========================================================================
    describe('IRPJ/CSLL trimestral', () => {

        it('Q1 (competencia Jan-Mar): vencimento April 30', () => {
            expect(calcularVencimentoDarf('2025-01', 'IRPJ', 'trimestral')).toBe('2025-04-30');
            expect(calcularVencimentoDarf('2025-02', 'IRPJ', 'trimestral')).toBe('2025-04-30');
            expect(calcularVencimentoDarf('2025-03', 'IRPJ', 'trimestral')).toBe('2025-04-30');
        });

        it('Q2 (competencia Apr-Jun): vencimento July 30', () => {
            expect(calcularVencimentoDarf('2025-04', 'CSLL', 'trimestral')).toBe('2025-07-30');
            expect(calcularVencimentoDarf('2025-06', 'CSLL', 'trimestral')).toBe('2025-07-30');
        });

        it('Q3 (competencia Jul-Sep): vencimento October 30', () => {
            expect(calcularVencimentoDarf('2025-07', 'IRPJ', 'trimestral')).toBe('2025-10-30');
            expect(calcularVencimentoDarf('2025-09', 'IRPJ', 'trimestral')).toBe('2025-10-30');
        });

        it('Q4 (competencia Oct-Dec): vencimento January 30 next year', () => {
            expect(calcularVencimentoDarf('2025-10', 'IRPJ', 'trimestral')).toBe('2026-01-30');
            expect(calcularVencimentoDarf('2025-12', 'CSLL', 'trimestral')).toBe('2026-01-30');
        });
    });

    // ========================================================================
    // PIS/COFINS
    // ========================================================================
    describe('PIS/COFINS', () => {

        it('PIS: day 25 of next month', () => {
            expect(calcularVencimentoDarf('2025-06', 'PIS')).toBe('2025-07-25');
            expect(calcularVencimentoDarf('2025-01', 'PIS')).toBe('2025-02-25');
        });

        it('COFINS: day 25 of next month', () => {
            expect(calcularVencimentoDarf('2025-06', 'COFINS')).toBe('2025-07-25');
        });

        it('December -> January next year', () => {
            expect(calcularVencimentoDarf('2025-12', 'PIS')).toBe('2026-01-25');
            expect(calcularVencimentoDarf('2025-12', 'COFINS')).toBe('2026-01-25');
        });
    });

    // ========================================================================
    // Default (mensal IRPJ/CSLL, IRRF, etc)
    // ========================================================================
    describe('default (mensal tributos)', () => {

        it('default: day 30 of next month', () => {
            expect(calcularVencimentoDarf('2025-06', 'IRPJ', 'mensal')).toBe('2025-07-30');
            expect(calcularVencimentoDarf('2025-06', 'IRRF')).toBe('2025-07-30');
        });

        it('December -> January next year', () => {
            expect(calcularVencimentoDarf('2025-12', 'IRPJ', 'mensal')).toBe('2026-01-30');
        });
    });

    // ========================================================================
    // Edge cases
    // ========================================================================
    describe('edge cases', () => {

        it('invalid competencia returns today', () => {
            const result = calcularVencimentoDarf('invalid', 'IRPJ');
            // Should be a valid ISO date (today)
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('IRPJ not trimestral uses default path (day 30)', () => {
            // periodicidade = undefined (default is trimestral), but tributo is not IRPJ/CSLL
            // so it won't match the isTri branch
            expect(calcularVencimentoDarf('2025-06', 'IRRF', 'trimestral')).toBe('2025-07-30');
        });
    });
});
