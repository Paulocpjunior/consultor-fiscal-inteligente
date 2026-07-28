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
import { calcularProporcaoMajoradaLc224, detalharLimiteLc224, calcularLucro } from '../services/lucroService';
import type { LucroInput } from '../types';

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

// ────────────────────────────────────────────────────────────────────────────
// REVISÃO 28/07 (tarde) — o colaborador reportou que "ainda não bate". Dois
// defeitos reais achados na revisão, ambos cobertos abaixo.
// ────────────────────────────────────────────────────────────────────────────

describe('DEFEITO 1 — apuração MENSAL usava o sublimite de um TRIMESTRE inteiro', () => {
    // Estimativa mensal (Lucro Real) apura por MÊS: o sublimite é 1/3 do
    // trimestral (R$ 416.666,67). Com o limite trimestral cheio, o mês ganhava
    // 3× o que tem direito e o imposto saía A MENOS.
    const mensal = (atual: number, anterior: number, mes: number) =>
        calcularProporcaoMajoradaLc224(atual, anterior, 'IRPJ', 2026, Math.ceil(mes / 3), 'Mensal', mes);

    it('mês com R$ 1 mi majora o que excede R$ 416.666,67 (antes: nada)', () => {
        const p = mensal(1_000_000, 0, 5);
        expect(p).toBeCloseTo((1_000_000 - 1_250_000 / 3) / 1_000_000, 6);
        expect(p).toBeGreaterThan(0);
    });

    it('mês dentro do sublimite mensal continua sem majoração', () => {
        expect(mensal(400_000, 0, 5)).toBe(0);
    });

    it('o mesmo valor no TRIMESTRAL não majora — são períodos diferentes', () => {
        expect(prop(1_000_000, 0, 'IRPJ', 2026, 2)).toBe(0);
    });

    it('saldo transportado no mensal conta MESES, não trimestres', () => {
        // Março (3º mês): 2 meses anteriores × 416.666,67 = 833.333,33 de
        // sublimite; faturou 300 mil → sobra 533.333,33 pro mês atual.
        const limite = detalharLimiteLc224(2_000_000, 300_000, 'IRPJ', 2026, 1, 'Mensal', 3);
        expect(limite.sublimitePeriodo).toBeCloseTo(416_666.67, 2);
        expect(limite.saldoTransportado).toBeCloseTo(533_333.33, 2);
        expect(limite.limiteAplicado).toBeCloseTo(950_000, 2);
    });

    it('CSLL/2026 no mensal só começa a contar em ABRIL (nonagesimal)', () => {
        // Maio é o 2º mês vigente da CSLL: 1 mês anterior de sublimite.
        const l = detalharLimiteLc224(2_000_000, 100_000, 'CSLL', 2026, 2, 'Mensal', 5);
        expect(l.saldoTransportado).toBeCloseTo(416_666.67 - 100_000, 2);
        // Março (1T) não vige pra CSLL nem no mensal.
        expect(calcularProporcaoMajoradaLc224(9_000_000, 0, 'CSLL', 2026, 1, 'Mensal', 3)).toBe(0);
    });
});

describe('DEFEITO 2 — o campo "receita dos períodos anteriores" não chegava ao cálculo', () => {
    // O dashboard gravava acumuladoAno no registro da ficha mas NÃO o passava
    // no input do cálculo: o colaborador digitava e o imposto não mudava.
    // Este teste trava o contrato pelo lado do serviço.
    const base: LucroInput = {
        regimeSelecionado: 'Presumido',
        periodoApuracao: 'Trimestral',
        mesReferencia: '2026-06',
        faturamentoComercio: 2_250_000,
        faturamentoIndustria: 0,
        faturamentoServico: 0,
        faturamentoMonofasico: 0,
        despesasOperacionais: 0,
        folhaPagamento: 0,
        custoMercadoriaVendida: 0,
        receitaFinanceira: 0,
        retencaoPis: 0, retencaoCofins: 0, retencaoIrpj: 0, retencaoCsll: 0,
        issConfig: { tipo: 'nao_incide', aliquota: 0 },
    } as unknown as LucroInput;

    const irpjDe = (input: LucroInput) =>
        calcularLucro(input).detalhamento.find(d => d.imposto.startsWith('IRPJ'))!;

    it('informar a receita anterior REDUZ o imposto (saldo transportado do §4º)', () => {
        const semInformar = irpjDe(base);
        // 1T faturou 250 mil → sobram 1 mi, que se somam ao limite do 2T.
        const informando = irpjDe({ ...base, acumuladoAno: 250_000 });
        expect(informando.baseCalculo).toBeLessThan(semInformar.baseCalculo);
        expect(informando.valor).toBeLessThan(semInformar.valor);
    });

    it('sem informar, o limite é o do próprio trimestre (comportamento conservador)', () => {
        const d = irpjDe(base);
        // 2,25 mi com limite 1,25 mi → 1 mi majorado (8,8%) e 1,25 mi a 8%.
        expect(d.baseCalculo).toBeCloseTo(1_250_000 * 0.08 + 1_000_000 * 0.088, 2);
    });

    it('a observação mostra o LIMITE aplicado — é a linha do relatório oficial', () => {
        expect(irpjDe(base).observacao).toMatch(/Limite do período: R\$\s?1\.250\.000,00/);
        expect(irpjDe({ ...base, acumuladoAno: 250_000 }).observacao).toMatch(/transportado/);
    });

    it('receita dentro do limite também informa o limite (some a dúvida "aplicou ou não?")', () => {
        const d = irpjDe({ ...base, faturamentoComercio: 900_000 });
        expect(d.observacao).toMatch(/não aplicada: receita do período dentro do limite/);
        expect(d.observacao).toMatch(/Limite do período/);
    });
});

describe('CASO REAL — A CASTELLANO METALURGICA, 2T/2026 (diferença de R$ 196,17 na base)', () => {
    // Relatório oficial:
    //   Limite do Trimestre        1.250.000,00
    //   Saldo do Trimestre Anterior   24.520,97   ← o app ignorava
    //   Total do Limite            1.274.520,97
    //   Receita do trimestre (8%)  1.531.859,51
    //   Base IRPJ                    124.607,47  (1.274.520,97×8% + 257.338,54×8,8%)
    //
    // O app usava 1.250.000 e chegava a 124.803,64 — exatamente
    // 24.520,97 × 0,8% (a diferença entre 8,8% e 8%) a mais.
    const RECEITA = 1_531_859_51 / 100;
    const SALDO_ANTERIOR = 24_520.97;

    const baseDe = (saldo: number) => {
        const l = detalharLimiteLc224(RECEITA, 0, 'IRPJ', 2026, 2, 'Trimestral', 6, saldo);
        return RECEITA * (1 - l.proporcaoMajorada) * 0.08 + RECEITA * l.proporcaoMajorada * 0.088;
    };

    it('com o saldo informado, a base bate com o relatório (R$ 124.607,47)', () => {
        expect(baseDe(SALDO_ANTERIOR)).toBeCloseTo(124_607.47, 2);
    });

    it('o limite aplicado é o "Total do Limite" do relatório', () => {
        const l = detalharLimiteLc224(RECEITA, 0, 'IRPJ', 2026, 2, 'Trimestral', 6, SALDO_ANTERIOR);
        expect(l.limiteAplicado).toBeCloseTo(1_274_520.97, 2);
        expect(l.sublimitePeriodo).toBe(1_250_000);
        expect(l.saldoTransportado).toBeCloseTo(24_520.97, 2);
    });

    it('REGRESSÃO: sem o saldo, a base dava R$ 196,17 a mais', () => {
        expect(baseDe(0) - baseDe(SALDO_ANTERIOR)).toBeCloseTo(196.17, 2);
        expect(baseDe(0)).toBeCloseTo(124_803.64, 2);
    });

    it('o saldo INFORMADO vence a derivação pela receita (o carry é por período)', () => {
        // Somar receitas do ano e subtrair do sublimite acumulado erra quando um
        // trimestre excedeu e outro sobrou: o excesso de um não consome a sobra
        // do outro. Quem manda é o número do relatório.
        const l = detalharLimiteLc224(RECEITA, 5_000_000, 'IRPJ', 2026, 2, 'Trimestral', 6, SALDO_ANTERIOR);
        expect(l.saldoTransportado).toBeCloseTo(24_520.97, 2);
    });

    it('no 1T não há de onde transportar — saldo informado é ignorado', () => {
        const l = detalharLimiteLc224(RECEITA, 0, 'IRPJ', 2026, 1, 'Trimestral', 3, 99_999);
        expect(l.saldoTransportado).toBe(0);
        expect(l.limiteAplicado).toBe(1_250_000);
    });

    it('CSLL/2026: no 2T (1º período vigente) também não transporta', () => {
        const l = detalharLimiteLc224(RECEITA, 0, 'CSLL', 2026, 2, 'Trimestral', 6, 24_520.97);
        expect(l.saldoTransportado).toBe(0);
    });
});
