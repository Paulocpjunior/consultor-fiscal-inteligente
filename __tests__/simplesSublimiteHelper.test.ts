/**
 * Testes do cálculo RBT12 e classificação contra teto (R$ 4,8M) e sublimite
 * ICMS/ISS (R$ 3,6M) do Simples Nacional. Errar aqui = exclusão indevida do
 * Simples ou tributação errada no estado.
 */
// @ts-expect-error — módulo .js puro
import { calcularRbt12, classificarRbt12, LIMITE_TETO_SIMPLES, LIMITE_SUBLIMITE_ICMS_ISS, _constantes } from '../sefaz-backend/simples-sublimite-helper.js';

describe('calcularRbt12 — soma últimos 12 meses', () => {
    it('faturamento constante de 100k/mês × 12 = 1.2M', () => {
        const fm: Record<string, number> = {};
        // Considerando mes referencia 2026-06: olha de 2025-06 a 2026-05
        for (let y = 2025, m = 6; ; ) {
            fm[`${y}-${String(m).padStart(2, '0')}`] = 100_000;
            if (y === 2026 && m === 5) break;
            m++; if (m > 12) { m = 1; y++; }
        }
        const r = calcularRbt12(fm, '2026-06');
        expect(r.rbt12).toBe(1_200_000);
        expect(r.mesesConsiderados).toHaveLength(12);
        expect(r.mesesSemDado).toHaveLength(0);
    });

    it('faturamento parcial — só 6 meses preenchidos → soma só esses', () => {
        const fm = { '2026-01': 50_000, '2026-02': 50_000, '2026-03': 50_000, '2026-04': 50_000, '2026-05': 50_000 };
        const r = calcularRbt12(fm, '2026-06');
        expect(r.rbt12).toBe(250_000);
        expect(r.mesesConsiderados).toHaveLength(5);
        expect(r.mesesSemDado.length).toBe(7);
    });

    it('mês com valor 0 ou ausente conta como "sem dado"', () => {
        const fm = { '2026-05': 100_000, '2026-04': 0 };
        const r = calcularRbt12(fm, '2026-06');
        expect(r.rbt12).toBe(100_000);
        expect(r.mesesConsiderados).toEqual(['2026-05']);
    });

    it('mês de referência ANTERIOR (mar/2026) olha mar/2025 a fev/2026', () => {
        const fm = { '2025-03': 100_000, '2026-02': 200_000, '2026-03': 999_999 /* este NÃO entra */ };
        const r = calcularRbt12(fm, '2026-03');
        expect(r.rbt12).toBe(300_000);
        expect(r.mesesConsiderados).toContain('2025-03');
        expect(r.mesesConsiderados).toContain('2026-02');
        expect(r.mesesConsiderados).not.toContain('2026-03');
    });

    it('faturamentoManual ausente / null → rbt12 = 0', () => {
        expect(calcularRbt12(null, '2026-06').rbt12).toBe(0);
        expect(calcularRbt12(undefined, '2026-06').rbt12).toBe(0);
        expect(calcularRbt12({}, '2026-06').rbt12).toBe(0);
    });

    it('valor não-numérico no faturamento → ignorado', () => {
        const fm = { '2026-05': 100_000, '2026-04': 'bug' as any };
        const r = calcularRbt12(fm, '2026-06');
        expect(r.rbt12).toBe(100_000);
    });
});

describe('classificarRbt12 — faixas de risco', () => {
    it('RBT12 baixo (1M) → ok para ambos os limites', () => {
        const r = classificarRbt12(1_000_000);
        expect(r.teto.faixa).toBe('ok');
        expect(r.sublimite.faixa).toBe('ok');
    });

    it('RBT12 2.6M → 72% do sublimite (alerta) / 54% do teto (ok)', () => {
        const r = classificarRbt12(2_600_000);
        expect(r.sublimite.faixa).toBe('alerta'); // 72.2%
        expect(r.teto.faixa).toBe('ok');           // 54.2%
    });

    it('RBT12 3.3M → 91% do sublimite (crítico) / 68% do teto (ok)', () => {
        const r = classificarRbt12(3_300_000);
        expect(r.sublimite.faixa).toBe('critico'); // 91.7%
        expect(r.teto.faixa).toBe('ok');            // 68.75%
    });

    it('RBT12 = 3.6M EXATO → sublimite 100% = crítico (ainda dentro)', () => {
        const r = classificarRbt12(3_600_000);
        expect(r.sublimite.faixa).toBe('critico');
        expect(r.sublimite.pct).toBe(100);
        expect(r.sublimite.restante).toBe(0);
    });

    it('RBT12 3.7M → sublimite ULTRAPASSOU (102.7%)', () => {
        const r = classificarRbt12(3_700_000);
        expect(r.sublimite.faixa).toBe('ultrapassou');
        expect(r.sublimite.restante).toBe(0);
    });

    it('RBT12 4.5M → sublimite ultrapassou + teto crítico (93.75%)', () => {
        const r = classificarRbt12(4_500_000);
        expect(r.sublimite.faixa).toBe('ultrapassou');
        expect(r.teto.faixa).toBe('critico');
    });

    it('RBT12 > 4.8M → teto ULTRAPASSOU (exclusão do Simples!)', () => {
        const r = classificarRbt12(4_900_000);
        expect(r.teto.faixa).toBe('ultrapassou');
        expect(r.teto.restante).toBe(0);
    });

    it('restante calcula corretamente quando dentro do limite', () => {
        const r = classificarRbt12(3_000_000);
        // Sublimite: 3.6M - 3M = 600k restantes
        expect(r.sublimite.restante).toBe(600_000);
        // Teto: 4.8M - 3M = 1.8M restantes
        expect(r.teto.restante).toBe(1_800_000);
    });
});

describe('constantes legais', () => {
    it('teto Simples = R$ 4.800.000 (LC 123/2006)', () => {
        expect(LIMITE_TETO_SIMPLES).toBe(4_800_000);
    });
    it('sublimite ICMS/ISS = R$ 3.600.000 (CGSN 169/2022 mantido em 2026)', () => {
        expect(LIMITE_SUBLIMITE_ICMS_ISS).toBe(3_600_000);
    });
    it('fronteiras: 70% = alerta, 90% = crítico', () => {
        expect(_constantes.PCT_ALERTA).toBe(0.70);
        expect(_constantes.PCT_CRITICO).toBe(0.90);
    });
});
