// @ts-nocheck — módulo .js do backend (sem tipos)
import {
    classificarItemCredito,
    apurarBaseCredito,
    compararComBaseUsada,
    ALIQ_PIS,
    ALIQ_COFINS,
} from '../sefaz-backend/pis-cofins-credito.js';

/**
 * BASE DE CRÉDITO DE PIS/COFINS DERIVADA DOS DOCUMENTOS (caso WALDESA, 12/08).
 *
 * A planilha aplicava 1,65% e 7,6% sobre a CONTA CONTÁBIL inteira de compras —
 * R$ 451.611,87 de crédito em junho/2025 sem nenhum filtro. O não-cumulativo
 * credita por OPERAÇÃO, e quem decide é o CST de PIS do item.
 *
 * A regra que estes testes travam é a que separa este módulo da planilha:
 * "não sei" NUNCA vira "credita". O indefinido sai separado e derruba a
 * confiabilidade do número — porque tratar dúvida como crédito é exatamente o
 * erro que estamos corrigindo, só que com outro nome.
 */
const item = (over = {}) => ({ vProd: 1000, cfop: '1102', ...over });

describe('classificarItemCredito — o CST do documento é quem decide', () => {
    it('CST 50-56: credita, e a prova é o DOCUMENTO', () => {
        const r = classificarItemCredito(item({ cstPis: '50' }));
        expect(r.veredito).toBe('credita');
        expect(r.prova).toBe('documento');
    });

    it('CST 70-75: aquisição SEM direito a crédito', () => {
        expect(classificarItemCredito(item({ cstPis: '70' })).veredito).toBe('nao-credita');
        expect(classificarItemCredito(item({ cstPis: '73' })).motivo).toMatch(/sem direito/i);
    });

    it('CST 60-66 é crédito PRESUMIDO — não entra no confirmado', () => {
        const r = classificarItemCredito(item({ cstPis: '60' }));
        expect(r.veredito).toBe('presumido');
        expect(r.motivo).toMatch(/parâmetro do cliente/i);
    });

    it('CST fora das faixas conhecidas vira INDEFINIDO, não um default otimista', () => {
        expect(classificarItemCredito(item({ cstPis: '99' })).veredito).toBe('indefinido');
    });
});

describe('sem CST — indício prova a NEGATIVA, nunca a positiva', () => {
    it('fornecedor optante do Simples (CSOSN) não gera crédito', () => {
        const r = classificarItemCredito(item({ cst: '102' }));
        expect(r.veredito).toBe('nao-credita');
        expect(r.prova).toBe('indicio');
        expect(r.motivo).toMatch(/Simples/i);
    });

    it('CFOP de mercadoria com ST encerrada não gera crédito', () => {
        const r = classificarItemCredito(item({ cfop: '1403' }));
        expect(r.veredito).toBe('nao-credita');
        expect(r.motivo).toMatch(/ST\/monofásica/i);
    });

    // A REGRA QUE SEPARA ESTE MÓDULO DA PLANILHA.
    it('CFOP de compra comum SEM CST NÃO vira "credita" — vira indefinido', () => {
        const r = classificarItemCredito(item({ cfop: '1102' }));
        expect(r.veredito).toBe('indefinido');
        expect(r.motivo).toMatch(/reprocessar o XML/i);
    });

    it('CFOP fora da base (devolução de venda) sai da conta', () => {
        expect(classificarItemCredito(item({ cfop: '1202' })).veredito).toBe('nao-credita');
    });
});

describe('apurarBaseCredito — o indefinido é contado, não escondido', () => {
    const docs = [{
        itens: [
            item({ cstPis: '50', vProd: 100000 }),   // credita
            item({ cstPis: '70', vProd: 30000 }),    // não credita
            item({ cst: '102', vProd: 20000 }),      // Simples — não credita
            item({ cfop: '1102', vProd: 50000 }),    // sem CST — INDEFINIDO
        ],
    }];

    it('separa os quatro montantes e nunca soma o indefinido ao confirmado', () => {
        const r = apurarBaseCredito(docs);
        expect(r.baseConfirmada).toBe(100000);
        expect(r.baseNaoCredita).toBe(50000);
        expect(r.baseIndefinida).toBe(50000);
        expect(r.totalEntradas).toBe(200000);
    });

    it('com indefinido no meio, o número NÃO é confiável pra fechar apuração', () => {
        expect(apurarBaseCredito(docs).confiavel).toBe(false);
        const limpo = [{ itens: [item({ cstPis: '50', vProd: 100 })] }];
        expect(apurarBaseCredito(limpo).confiavel).toBe(true);
    });

    it('conta quantos itens estão sem CST — é a medida do backfill que falta', () => {
        const r = apurarBaseCredito(docs);
        // 2 dos 4: o do Simples (decidido por indício) e o indefinido. Os
        // outros dois têm cstPis e por isso não pedem backfill.
        expect(r.itensSemCst).toBe(2);
        expect(r.totalItens).toBe(4);
    });

    it('agrupa por motivo, do maior valor pro menor — causa junto do número', () => {
        const r = apurarBaseCredito(docs);
        expect(r.porMotivo[0].valor).toBe(100000);
        for (const m of r.porMotivo) expect(m.motivo).toBeTruthy();
    });

    it('lista vazia não vira "confiável" — zero item não prova nada', () => {
        expect(apurarBaseCredito([]).confiavel).toBe(false);
    });
});

describe('compararComBaseUsada — o confronto com a planilha', () => {
    // Números REAIS de junho/2025 da WALDESA (docs/achados-apuracao-...):
    // base usada 4.882.290,45 → crédito 451.611,87 (PIS+COFINS).
    const BASE_PLANILHA = 4882290.45;

    it('reproduz o crédito da planilha a partir da base dela', () => {
        const r = compararComBaseUsada(apurarBaseCredito([]), BASE_PLANILHA);
        expect(r.creditoUsado).toBeCloseTo(BASE_PLANILHA * (ALIQ_PIS + ALIQ_COFINS), 2);
        expect(r.creditoUsado).toBe(451611.87);
    });

    it('base usada maior COM entradas sem CST não acusa crédito indevido — manda reprocessar', () => {
        const apur = apurarBaseCredito([{ itens: [item({ cfop: '1102', vProd: 1000000 })] }]);
        const r = compararComBaseUsada(apur, BASE_PLANILHA);
        expect(r.leitura).toBe('a-maior-com-duvida');
        expect(r.acao).toMatch(/Reprocesse os XMLs/i);
        expect(r.acao).not.toMatch(/indício de CRÉDITO INDEVIDO/i);
    });

    it('sem dúvida documental, base usada maior VIRA indício de crédito indevido', () => {
        const apur = apurarBaseCredito([{ itens: [item({ cstPis: '50', vProd: 1000000 })] }]);
        const r = compararComBaseUsada(apur, BASE_PLANILHA);
        expect(r.leitura).toBe('a-maior');
        expect(r.acao).toMatch(/CRÉDITO INDEVIDO/i);
        expect(r.diferencaCredito).toBeGreaterThan(0);
    });

    it('base usada MENOR aponta crédito não aproveitado', () => {
        const apur = apurarBaseCredito([{ itens: [item({ cstPis: '50', vProd: 9000000 })] }]);
        expect(compararComBaseUsada(apur, BASE_PLANILHA).leitura).toBe('a-menor');
    });
});
