import { calcularLucro } from '../services/lucroService';
import type { LucroInput } from '../types';

/**
 * Paulo, 05/08 (olhando o PDF novo ao lado do demonstrativo do E-Fiscal):
 * "consegue desmembrar o IRPJ? deixar o valor do IRPJ 15% e o valor do
 * adicional 10%, igual aqui".
 *
 * O motor sempre devolveu o IRPJ SOMADO (15% + adicional) porque é assim que
 * vai no DARF. Agora ele carimba o adicional à parte, sem mexer no total —
 * senão a guia mudaria junto com o relatório.
 *
 * Caso real: PEC PRONTA ENTREGA, 2º trimestre de 2026.
 */
const base = (over: Partial<LucroInput> = {}): LucroInput => ({
    regimeSelecionado: 'Presumido',
    periodoApuracao: 'Trimestral',
    mesReferencia: '2026-06',
    faturamentoComercio: 0,
    faturamentoIndustria: 0,
    faturamentoServico: 638779.28,
    faturamentoMonofasico: 0,
    receitaFinanceira: 4302.54,
    despesasOperacionais: 0,
    despesasDedutiveis: 0,
    folhaPagamento: 0,
    custoMercadoriaVendida: 0,
    issConfig: { aliquota: 0 } as any,
    retencaoPis: 0,
    retencaoCofins: 0,
    retencaoIrpj: 967.73,
    retencaoCsll: 0,
    ...over,
} as LucroInput);

const irpj = (r: ReturnType<typeof calcularLucro>) =>
    r.detalhamento.find(d => /^IRPJ/i.test(d.imposto))!;

describe('IRPJ trimestral — adicional carimbado à parte', () => {
    it('separa a base do adicional (o que excede R$ 60.000 no trimestre)', () => {
        const d = irpj(calcularLucro(base()));
        // 32% de 638.779,28 = 204.409,37 + 4.302,54 de receita financeira.
        expect(d.baseCalculo).toBeCloseTo(208711.91, 2);
        expect(d.baseAdicional).toBeCloseTo(148711.91, 2);
        expect(d.adicional).toBeCloseTo(14871.19, 2);
    });

    it('15% + adicional continuam somando o valor bruto (o DARF não muda)', () => {
        const d = irpj(calcularLucro(base()));
        const quinzePorCento = d.baseCalculo * 0.15;
        expect(quinzePorCento + (d.adicional || 0)).toBeCloseTo(d.valorBruto!, 2);
        // E o valor A PAGAR segue líquido da retenção (regra #298).
        expect(d.valor).toBeCloseTo((d.valorBruto || 0) - 967.73, 2);
    });

    it('base abaixo do limite não gera adicional (fica zerado, não ausente)', () => {
        const d = irpj(calcularLucro(base({ faturamentoServico: 100000, receitaFinanceira: 0, retencaoIrpj: 0 })));
        expect(d.baseCalculo).toBeCloseTo(32000, 2);
        expect(d.adicional).toBe(0);
        expect(d.baseAdicional).toBe(0);
    });
});
