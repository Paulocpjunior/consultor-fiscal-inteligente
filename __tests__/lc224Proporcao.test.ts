/**
 * Proporção majorada da LC 224/2025 (calcularProporcaoMajoradaLc224).
 *
 * REGRA (IN RFB 2.305/2025 art. 15 §§2º-4º), confirmada contra o relatório
 * oficial do cliente EDUARDO GUERRA HORTIFRUTI (2T/2026, Office Fiscal):
 *
 *   - o sublimite é de R$ 1,25 mi POR TRIMESTRE e RENOVA a cada trimestre;
 *   - receita acima dele → majora só o EXCEDENTE;
 *   - saldo não usado de trimestre anterior é transportado (§4º) — mas só
 *     quando se SABE o faturamento anterior;
 *   - NÃO existe "estourou o teto anual → 100% dali em diante": o relatório
 *     mostra R$ 13,2 mi no trimestre (muito acima do teto) e ainda assim
 *     "Limite do Trimestre 1.250.000,00".
 *
 * O teto anual (5 mi; 3,75 mi na CSLL/2026) é só a SOMA dos sublimites dos
 * trimestres vigentes — a CSLL de 2026 vale a partir do 2T, daí 3 × 1,25 mi.
 */
import { calcularProporcaoMajoradaLc224 } from '../services/lucroService';

// assinatura: (receitaPeriodoAtual, receitaAnoAcumuladaAnterior, tributo, ano, trimestre, periodo)
const prop = (
    atual: number, anterior: number, tributo: 'IRPJ' | 'CSLL', ano: number, tri: number,
) => calcularProporcaoMajoradaLc224(atual, anterior, tributo, ano, tri, 'Trimestral');

describe('CASO REAL — EDUARDO GUERRA HORTIFRUTI, 2T/2026 (IRPJ)', () => {
    // Receita do trimestre R$ 13.244.537,14 − devoluções R$ 56.263,21.
    const RECEITA_TRIMESTRE = 13_188_273.93;

    it('majora o excedente de R$ 1,25 mi → 90,52% da receita', () => {
        // Relatório oficial: no limite 1.250.000 (8%) + excedente 11.938.273,93 (8,8%).
        expect(prop(RECEITA_TRIMESTRE, 0, 'IRPJ', 2026, 2)).toBeCloseTo(0.9052, 4);
    });

    it('a base presumida resultante bate com o relatório (R$ 1.150.568,11)', () => {
        const p = prop(RECEITA_TRIMESTRE, 0, 'IRPJ', 2026, 2);
        const base = RECEITA_TRIMESTRE * (1 - p) * 0.08 + RECEITA_TRIMESTRE * p * 0.088;
        expect(base).toBeCloseTo(1_150_568.11, 2);
    });

    it('REGRESSÃO: o limite NÃO é 5 mi × trimestre/4 (dava base 10 mil menor)', () => {
        const p = prop(RECEITA_TRIMESTRE, 0, 'IRPJ', 2026, 2);
        const base = RECEITA_TRIMESTRE * (1 - p) * 0.08 + RECEITA_TRIMESTRE * p * 0.088;
        // O bug usava 2,5 mi de limite no 2T → base 1.140.568,11 (R$ 2.500 a
        // MENOS de IRPJ que o devido, somando 15% + 10% de adicional).
        expect(base).not.toBeCloseTo(1_140_568.11, 2);
    });
});

describe('sublimite trimestral renova — teto anual não vira "100% dali em diante"', () => {
    it('trimestre com receita muito acima do teto anual ainda tem 1,25 mi no limite', () => {
        expect(prop(20_000_000, 0, 'IRPJ', 2026, 3)).toBeCloseTo((20_000_000 - 1_250_000) / 20_000_000, 6);
    });

    it('faturamento anterior gigante não zera o limite do trimestre atual', () => {
        // 30 mi nos trimestres anteriores e 2 mi agora: o 2 mi ainda tem 1,25 mi
        // de sublimite próprio → majora só 0,75 mi.
        expect(prop(2_000_000, 30_000_000, 'IRPJ', 2026, 4)).toBeCloseTo(0.375, 6);
    });

    it('receita dentro do sublimite não majora nada', () => {
        expect(prop(1_250_000, 0, 'IRPJ', 2026, 2)).toBe(0);
        expect(prop(900_000, 0, 'IRPJ', 2026, 4)).toBe(0);
    });
});

describe('carry-forward do §4º (só com o faturamento anterior informado)', () => {
    it('sobra do 1T é transportada para o 2T quando o acumulado é informado', () => {
        // 1T faturou 250 mil → sobraram 1 mi do sublimite. No 2T: 1,25 + 1 = 2,25 mi.
        expect(prop(2_250_000, 250_000, 'IRPJ', 2026, 2)).toBe(0);
        expect(prop(3_250_000, 250_000, 'IRPJ', 2026, 2)).toBeCloseTo(1_000_000 / 3_250_000, 6);
    });

    it('sem o acumulado informado NÃO presume sobra (conservador e igual ao sistema oficial)', () => {
        // Era esse o bug: com "anterior = 0" o app presumia 1,25 mi de sobra por
        // trimestre anterior e inflava o limite.
        expect(prop(2_250_000, 0, 'IRPJ', 2026, 2)).toBeCloseTo(1_000_000 / 2_250_000, 6);
    });

    it('anterior acima do sublimite acumulado não gera transporte', () => {
        expect(prop(2_000_000, 5_000_000, 'IRPJ', 2026, 3)).toBeCloseTo(0.375, 6);
    });
});

describe('vigência por tributo', () => {
    it('CSLL só vale a partir do 2T/2026 — no 1T não majora', () => {
        expect(prop(9_000_000, 0, 'CSLL', 2026, 1)).toBe(0);
        expect(prop(2_000_000, 0, 'CSLL', 2026, 2)).toBeCloseTo(0.375, 6);
    });

    it('CSLL/2026: o 1T não transporta sublimite (não era vigente)', () => {
        // 2T com 500 mil informados no 1T: nenhum saldo vem do 1T → limite 1,25 mi.
        expect(prop(2_250_000, 500_000, 'CSLL', 2026, 2)).toBeCloseTo(1_000_000 / 2_250_000, 6);
        // No IRPJ, o mesmo cenário transporta 750 mil (1,25 − 0,5) → limite 2 mi.
        expect(prop(2_250_000, 500_000, 'IRPJ', 2026, 2)).toBeCloseTo(250_000 / 2_250_000, 6);
    });

    it('IRPJ vale desde o 1T/2026; antes de 2026 nada majora', () => {
        expect(prop(2_000_000, 0, 'IRPJ', 2026, 1)).toBeCloseTo(0.375, 6);
        expect(prop(9_000_000, 0, 'IRPJ', 2025, 4)).toBe(0);
        expect(prop(9_000_000, 0, 'CSLL', 2025, 4)).toBe(0);
    });

    it('2027+: ambos vigem desde o 1T, com o mesmo sublimite trimestral', () => {
        expect(prop(1_250_000, 0, 'CSLL', 2027, 1)).toBe(0);
        expect(prop(2_000_000, 0, 'CSLL', 2027, 3)).toBeCloseTo(0.375, 6);
    });
});

describe('bordas', () => {
    it('receita zero ou negativa não majora', () => {
        expect(prop(0, 0, 'IRPJ', 2026, 2)).toBe(0);
        expect(prop(-100, 0, 'IRPJ', 2026, 2)).toBe(0);
    });

    it('proporção fica sempre entre 0 e 1', () => {
        const p = prop(999_999_999, 0, 'IRPJ', 2026, 4);
        expect(p).toBeGreaterThan(0.99);
        expect(p).toBeLessThanOrEqual(1);
    });
});
