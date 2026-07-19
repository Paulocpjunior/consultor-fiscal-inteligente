/**
 * Testes da proporção majorada da LC 224/2025 (calcularProporcaoMajoradaLc224).
 *
 * Foco: o sublimite de R$ 1,25 mi é distribuído por trimestre DE VIGÊNCIA, não
 * por trimestre de calendário. Para a CSLL em 2026 a majoração só vigora a partir
 * do 2T, então o teto anual é R$ 3,75 mi (3 × 1,25 mi) — antes o código usava o
 * trimestre cru (1,25M×4 = 5 mi) e a majoração da CSLL escapava na faixa 3,75–5 mi.
 */
import { calcularProporcaoMajoradaLc224 } from '../services/lucroService';

// assinatura: (receitaPeriodoAtual, receitaAnoAcumuladaAnterior, tributo, ano, trimestre, periodo)
const prop = (
    atual: number, anterior: number, tributo: 'IRPJ' | 'CSLL', ano: number, tri: number,
) => calcularProporcaoMajoradaLc224(atual, anterior, tributo, ano, tri, 'Trimestral');

describe('LC224 — CSLL 2026 respeita o teto anual reduzido (R$ 3,75 mi)', () => {
    it('4T, R$ 5 mi todo no 4T → majora o excedente sobre 3,75 mi (25%)', () => {
        // sublimite 4T = 1,25M × 3 trimestres de vigência (2T,3T,4T) = 3,75 mi.
        // excedente = 5M − 3,75M = 1,25M → 1,25/5 = 0,25. (Antes retornava 0.)
        expect(prop(5_000_000, 0, 'CSLL', 2026, 4)).toBeCloseTo(0.25, 6);
    });

    it('2T: sublimite acumulado = 3,75mi × 2/4 = 1,875 mi', () => {
        // 2M no 2T, sublimite 1,875M → excedente 0,125M → 0,0625.
        expect(prop(2_000_000, 0, 'CSLL', 2026, 2)).toBeCloseTo(0.0625, 6);
    });

    it('1T/2026: majoração da CSLL ainda não vigora → 0', () => {
        expect(prop(2_000_000, 0, 'CSLL', 2026, 1)).toBe(0);
    });

    it('3T com sublimite acumulado já estourado → 100% majorado', () => {
        // sublimite 3T = 3,75M × 3/4 = 2,8125M; anterior 3M > 2,8125M → disponível <0.
        expect(prop(1_000_000, 3_000_000, 'CSLL', 2026, 3)).toBe(1);
    });

    it('REGRESSÃO: receita uniforme com anual = teto (3,75mi) → 0 majoração em todos os trimestres', () => {
        // 937.500/trimestre → anual exatamente 3,75mi (teto reduzido) → majoração
        // devida = ZERO. O bug da fase2-g cobrava ~R$811 no 3T; agora dá 0.
        // ant = receita acumulada dos trimestres ANTERIORES (uniforme).
        expect(prop(937_500, 937_500, 'CSLL', 2026, 2)).toBe(0);       // 2T: cumSub 1,875 − ant 0,9375 = 0,9375 ≥ 937,5k
        expect(prop(937_500, 1_875_000, 'CSLL', 2026, 3)).toBe(0);     // 3T: cumSub 2,8125 − 1,875 = 0,9375 ≥ 937,5k
        expect(prop(937_500, 2_812_500, 'CSLL', 2026, 4)).toBe(0);     // 4T: cumSub 3,75 − 2,8125 = 0,9375 ≥ 937,5k
    });
});

describe('LC224 — IRPJ mantém teto anual de R$ 5 mi (vigência desde 1T)', () => {
    it('4T, R$ 5 mi acumulado → ainda dentro do teto → 0', () => {
        // sublimite 4T = 1,25M × 4 = 5 mi. 5M <= 5M → sem majoração.
        expect(prop(5_000_000, 0, 'IRPJ', 2026, 4)).toBe(0);
    });

    it('4T, R$ 6 mi → majora o excedente de 1 mi (≈16,67%)', () => {
        expect(prop(6_000_000, 0, 'IRPJ', 2026, 4)).toBeCloseTo(1 / 6, 5);
    });

    it('1T/2026: IRPJ já vigora', () => {
        // 2M no 1T, sublimite 1,25M → excedente 0,75M → 0,375.
        expect(prop(2_000_000, 0, 'IRPJ', 2026, 1)).toBeCloseTo(0.375, 6);
    });
});

describe('LC224 — 2027+ ambos vigem desde 1T', () => {
    it('CSLL 2027 4T usa teto anual cheio (1,25M×4 = 5 mi)', () => {
        expect(prop(5_000_000, 0, 'CSLL', 2027, 4)).toBe(0);
        expect(prop(6_000_000, 0, 'CSLL', 2027, 4)).toBeCloseTo(1 / 6, 5);
    });

    it('antes de 2026 não há majoração', () => {
        expect(prop(9_000_000, 0, 'IRPJ', 2025, 4)).toBe(0);
    });
});
