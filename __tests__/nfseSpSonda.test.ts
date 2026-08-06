// @ts-expect-error — módulo .js puro (sem tipos)
import { interpretarSonda } from '../sefaz-backend/nfse-sp-sonda-leitura';

/**
 * Onde a investigação chegou em 06/08: o contrato do WSDL foi lido e os
 * parâmetros BATEM ("declara: VersaoSchema, MensagemXML · enviamos: os
 * mesmos"). O envelope está descartado — sobram duas causas OPOSTAS pro
 * "Mensagem XML de Pedido do serviço sem conteúdo":
 *
 *   (A) TRANSPORTE — o conteúdo não chega (CDATA/encoding);
 *   (B) CONTEÚDO — chega e é recusado (root do Pedido, schema, assinatura).
 *
 * A prova está na COMPARAÇÃO de códigos entre variantes conhecidas. Esta
 * função não sabe nada de leiaute fiscal: ela só compara.
 */
const r = (variante: string, codigo: string | null, descricao = 'x') => ({ variante, codigo, descricao });

describe('sonda do 1102', () => {
    it('código GENÉRICO (vazio == root inventado): o conteúdo chega e é RECUSADO', () => {
        const l = interpretarSonda([
            r('vazio', '1102'), r('root-desconhecido', '1102'),
            r('pedido-sem-assinatura', '1102'), r('pedido-assinado-cdata', '1102'),
        ]);
        expect(l.causa).toBe('conteudo');
        expect(l.veredicto).toMatch(/GENÉRICO/);
        expect(l.acao).toMatch(/não se deduz por tentativa/);
    });

    it('serviço DISTINGUE vazio e o nosso envio dá o código do vazio: não chega', () => {
        const l = interpretarSonda([
            r('vazio', '1102'), r('root-desconhecido', '1103'),
            r('pedido-assinado-cdata', '1102'),
        ]);
        expect(l.causa).toBe('transporte');
        expect(l.veredicto).toMatch(/não está chegando/);
    });

    it('se com entidades o código MUDA, aponta o CDATA pelo nome', () => {
        const l = interpretarSonda([
            r('vazio', '1102'), r('root-desconhecido', '1103'),
            r('pedido-assinado-escapado', '1103'), r('pedido-assinado-cdata', '1102'),
        ]);
        expect(l.causa).toBe('transporte');
        expect(l.veredicto).toMatch(/é o CDATA/);
        expect(l.acao).toMatch(/Trocar o CDATA por escape/);
    });

    it('assinatura mudando o código entra no veredicto', () => {
        const l = interpretarSonda([
            r('vazio', '1102'), r('root-desconhecido', '1102'),
            r('pedido-sem-assinatura', '1150'), r('pedido-assinado-cdata', '1102'),
        ]);
        expect(l.veredicto).toMatch(/assinatura entra na conta/);
    });

    it('variante que PASSA encerra a investigação e nomeia o formato', () => {
        const l = interpretarSonda([
            r('vazio', '1102'), r('root-desconhecido', '1102'),
            { variante: 'pedido-assinado-escapado', codigo: null, descricao: null },
        ]);
        expect(l.causa).toBe('variante-funciona');
        expect(l.acao).toMatch(/pedido-assinado-escapado/);
    });

    it('sem as variantes de referência NÃO conclui — silêncio não é prova', () => {
        const l = interpretarSonda([{ variante: 'vazio', erro: 'timeout' }]);
        expect(l.conclusivo).toBe(false);
        expect(l.veredicto).toMatch(/não dá pra concluir nada/);
    });

    it('lista vazia não inventa causa', () => {
        expect(interpretarSonda([]).conclusivo).toBe(false);
    });
});
