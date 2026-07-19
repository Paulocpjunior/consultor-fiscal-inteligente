/**
 * Testes do aviso da presunção reduzida de 16% (avaliarPresuncaoReduzida16).
 * É só ALERTA (não bloqueia, não muda cálculo): vedação por CNAE de atividade
 * regulamentada/administração de bens/factoring/corretagem/construção só-mão-de-
 * obra (RIR/2018 art. 15 §7º) e teto de receita bruta anual de R$ 120k.
 */
import { avaliarPresuncaoReduzida16 } from '../services/lucroService';

describe('avaliarPresuncaoReduzida16 — vedação por CNAE', () => {
    it('advocacia/contabilidade (div. 69) → alerta', () => {
        const r = avaliarPresuncaoReduzida16({ cnae: '6911-7/01' });
        expect(r.alertar).toBe(true);
        expect(r.motivos[0]).toMatch(/vedad/i);
    });

    it('engenharia (div. 71) e saúde (div. 86) → alerta', () => {
        expect(avaliarPresuncaoReduzida16({ cnae: '7112-0/00' }).alertar).toBe(true);
        expect(avaliarPresuncaoReduzida16({ cnae: '8610-1/01' }).alertar).toBe(true);
    });

    it('corretagem de imóveis (grupo 6831) → alerta; construção (div. 41/43) → alerta', () => {
        expect(avaliarPresuncaoReduzida16({ cnae: '6831-7/00' }).alertar).toBe(true);
        expect(avaliarPresuncaoReduzida16({ cnae: '4120-4/00' }).alertar).toBe(true);
        expect(avaliarPresuncaoReduzida16({ cnae: '4321-5/00' }).alertar).toBe(true);
    });

    it('atividade NÃO vedada (ex.: transporte de passageiros div. 49) → sem alerta', () => {
        const r = avaliarPresuncaoReduzida16({ cnae: '4923-0/01' });
        expect(r.alertar).toBe(false);
        expect(r.motivos).toHaveLength(0);
    });

    it('grupo 4 díg. só casa o grupo certo (6820 aluguel? não; 6822 sim)', () => {
        expect(avaliarPresuncaoReduzida16({ cnae: '6822-6/00' }).alertar).toBe(true);  // administração de imóveis
        expect(avaliarPresuncaoReduzida16({ cnae: '6820-0/00' }).alertar).toBe(false); // não está na lista
    });
});

describe('avaliarPresuncaoReduzida16 — teto de R$ 120k', () => {
    it('receita anual acima de 120k → alerta (mesmo CNAE não vedado)', () => {
        const r = avaliarPresuncaoReduzida16({ cnae: '4923-0/01', receitaBrutaAnualEstimada: 150000 });
        expect(r.alertar).toBe(true);
        expect(r.motivos.some(m => /120\.000/.test(m))).toBe(true);
    });

    it('receita anual até 120k e CNAE ok → sem alerta', () => {
        const r = avaliarPresuncaoReduzida16({ cnae: '4923-0/01', receitaBrutaAnualEstimada: 100000 });
        expect(r.alertar).toBe(false);
    });

    it('CNAE vedado E receita alta → dois motivos', () => {
        const r = avaliarPresuncaoReduzida16({ cnae: '6911-7/01', receitaBrutaAnualEstimada: 200000 });
        expect(r.motivos).toHaveLength(2);
    });
});

describe('avaliarPresuncaoReduzida16 — entradas vazias', () => {
    it('sem cnae nem receita → sem alerta', () => {
        expect(avaliarPresuncaoReduzida16({}).alertar).toBe(false);
        expect(avaliarPresuncaoReduzida16({ cnae: null, receitaBrutaAnualEstimada: null }).alertar).toBe(false);
    });
});
