/**
 * Testes do motor de comparação Presumido × Real (parte pura).
 *
 * O renderizador PDF em si não roda no jest (jsPDF precisa de DOM real),
 * mas a lógica de decisão (qual regime vence, economia projetada) é pura
 * e crítica — se errar, o cliente recebe recomendação errada.
 */
import type { LucroInput } from '../types';
import { compararRegimes } from '../services/lucroComparativoPdf';

const inputBase: LucroInput = {
    regimeSelecionado: 'Presumido', // sobrescrito internamente
    periodoApuracao: 'Trimestral',
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
};

describe('compararRegimes — escolha de regime vencedor', () => {
    it('comércio com margem alta → Presumido vence (BC presumida < lucro real)', () => {
        // Comércio R$ 500k, despesas R$ 100k → lucro real ~80% → Presumido (8% BC) vence.
        const r = compararRegimes({
            ...inputBase,
            faturamentoComercio: 500_000,
            despesasOperacionais: 100_000,
        });
        expect(r.vencedor).toBe('Presumido');
        expect(r.presumido.totalImpostos).toBeLessThan(r.real.totalImpostos);
        expect(r.economiaAnual).toBeGreaterThan(0);
    });

    it('comércio com margem baixa → Real vence', () => {
        // Faturamento R$ 500k, despesas R$ 490k → margem 2% < presunção 8%.
        // despesasGeramCreditoPisCofins separado da folha: folha NAO gera credito
        // (Lei 10.637/02 art. 3 §2 I). Aqui R$ 300k de despesas geram credito
        // PIS/COFINS (aluguel PJ, insumos, energia etc).
        const r = compararRegimes({
            ...inputBase,
            faturamentoComercio: 500_000,
            despesasOperacionais: 490_000,
            folhaPagamento: 50_000,
            despesasDedutiveis: 200_000,
            despesasGeramCreditoPisCofins: 300_000,
        });
        expect(r.vencedor).toBe('Real');
        expect(r.real.totalImpostos).toBeLessThan(r.presumido.totalImpostos);
    });

    it('economia anual = diferença × 4 (trimestral) ou × 12 (mensal)', () => {
        const trimestral = compararRegimes({
            ...inputBase,
            faturamentoComercio: 500_000,
            despesasOperacionais: 100_000,
            periodoApuracao: 'Trimestral',
        });
        const diffTrim = Math.abs(trimestral.presumido.totalImpostos - trimestral.real.totalImpostos);
        expect(trimestral.economiaAnual).toBeCloseTo(diffTrim * 4, 2);

        const mensal = compararRegimes({
            ...inputBase,
            faturamentoComercio: 500_000,
            despesasOperacionais: 100_000,
            periodoApuracao: 'Mensal',
        });
        const diffMes = Math.abs(mensal.presumido.totalImpostos - mensal.real.totalImpostos);
        expect(mensal.economiaAnual).toBeCloseTo(diffMes * 12, 2);
    });

    it('diferencaPercentual é positiva e dentro de [0,1]', () => {
        const r = compararRegimes({
            ...inputBase,
            faturamentoComercio: 500_000,
            despesasOperacionais: 100_000,
        });
        expect(r.diferencaPercentual).toBeGreaterThan(0);
        expect(r.diferencaPercentual).toBeLessThanOrEqual(1);
    });

    it('zero faturamento → totais zerados, não quebra (empate ou zero)', () => {
        const r = compararRegimes(inputBase);
        expect(r.presumido.totalImpostos).toBeGreaterThanOrEqual(0);
        expect(r.real.totalImpostos).toBeGreaterThanOrEqual(0);
        // Pode ser "Empate" se ambos forem zero — ou um vencer por arredondamento.
        expect(['Presumido', 'Real', 'Empate']).toContain(r.vencedor);
    });

    it('forma do retorno: presumido + real + vencedor + economia + percentual', () => {
        const r = compararRegimes({
            ...inputBase,
            faturamentoComercio: 100_000,
        });
        expect(r).toHaveProperty('presumido');
        expect(r).toHaveProperty('real');
        expect(r).toHaveProperty('vencedor');
        expect(r).toHaveProperty('economiaAnual');
        expect(r).toHaveProperty('diferencaPercentual');
        expect(r.presumido.regime).toBe('Presumido');
        expect(r.real.regime).toBe('Real');
    });
});
