// @ts-ignore modulo .js puro
import { assertValorPgdasCompativel, extrairDeclaracaoTransmitidaPgdas, montarDadosDeclaracaoPgdas, normalizarValoresDevidosPgdas, somaValoresDevidosPgdas, lerValoresDevidosPgdas } from '../sefaz-backend/pgdas-utils.js';

// ═══ 03/09: VALOR AUSENTE DO SERPRO VIRAVA 0,00 E ENTRAVA NA SOMA ══════════
// `round2(Number(n) || 0)` + `valor >= 0` mantinham o tributo sem valor
// valendo zero: divergência falsa contra a apuração local, ou — pior — soma
// batendo por coincidência com um débito a menos na declaração.
describe('pgdas-utils — item ilegível sai NOMEADO e a soma se recusa', () => {
    const comIlegivel = [
        { codigoTributo: 1001, valor: 80 },
        { codigoTributo: 1010 },                 // valor ausente
        { codigoTributo: 1004, valor: 'abc' },   // ilegível
        { codigoTributo: 1005, valor: -3 },      // negativo
        { valor: 12 },                           // sem tributo
    ];

    it('lerValoresDevidosPgdas separa os legíveis dos ilegíveis, com o motivo', () => {
        const r = lerValoresDevidosPgdas(comIlegivel);
        expect(r.valores).toEqual([{ codigoTributo: 1001, valor: 80 }]);
        expect(r.ilegiveis).toHaveLength(4);
        expect(r.ilegiveis.map((i: any) => i.codigoTributo)).toEqual([1010, 1004, 1005, undefined]);
        expect(r.ilegiveis[0].motivo).toMatch(/ausente/);
    });

    it('a SOMA se recusa enquanto houver ilegível — parcial vira "total"', () => {
        expect(() => somaValoresDevidosPgdas(comIlegivel)).toThrow(/nao da para ler/);
        try { somaValoresDevidosPgdas(comIlegivel); } catch (e: any) {
            expect(e.code).toBe('PGDAS_VALOR_ILEGIVEL');
            expect(e.message).toMatch(/tributo 1010 = undefined/);
            expect(e.message).toMatch(/Nenhuma declaracao foi transmitida/);
        }
    });

    it('a comparação e o payload de comparação também se recusam', () => {
        expect(() => assertValorPgdasCompativel({ valorLocal: 80, valoresDevidos: comIlegivel }))
            .toThrow(/PGDAS|nao da para ler/);
        expect(() => montarDadosDeclaracaoPgdas({
            cnpjLimpo: '28810670000192', pa: 202605, transmitir: true, declaracao: {}, valoresParaComparacao: comIlegivel,
        })).toThrow(/nao da para ler/);
    });

    it('zero de verdade continua sendo zero (é resposta, não ausência)', () => {
        expect(somaValoresDevidosPgdas([{ codigoTributo: 1010, valor: 0 }, { codigoTributo: 1001, valor: '80.5' }])).toBe(80.5);
    });
});

describe('pgdas-utils', () => {
    const declaracao = {
        tipoDeclaracao: 1,
        receitaPaCompetenciaInterno: 43270.5,
        receitaPaCompetenciaExterno: 0,
        receitaPaCaixaInterno: null,
        receitaPaCaixaExterno: null,
        valorFixoIcms: null,
        valorFixoIss: null,
        receitasBrutasAnteriores: [],
        estabelecimentos: [{
            cnpjCompleto: '28810670000192',
            atividades: [{
                idAtividade: 14,
                valorAtividade: 43270.5,
                receitasAtividade: [{ valor: 43270.5 }],
            }],
        }],
    };

    it('monta validacao sem transmissao e sem comparacao', () => {
        const dados = montarDadosDeclaracaoPgdas({
            cnpjLimpo: '28810670000192',
            pa: 202605,
            transmitir: false,
            declaracao,
        });

        expect(dados.indicadorTransmissao).toBe(false);
        expect(dados.indicadorComparacao).toBe(false);
        expect(dados).not.toHaveProperty('valoresParaComparacao');
    });

    it('monta transmissao com valoresParaComparacao normalizados', () => {
        const dados = montarDadosDeclaracaoPgdas({
            cnpjLimpo: '28810670000192',
            pa: 202605,
            transmitir: true,
            declaracao,
            valoresParaComparacao: [
                { codigoTributo: 1010, valor: 120.555 },
                { codigoTributo: 1001, valor: 80 },
            ],
        });

        expect(dados.indicadorTransmissao).toBe(true);
        expect(dados.indicadorComparacao).toBe(true);
        expect(dados.valoresParaComparacao).toEqual([
            { codigoTributo: 1001, valor: 80 },
            { codigoTributo: 1010, valor: 120.56 },
        ]);
    });

    it('extrai valores devidos quando SERPRO retorna dados como string JSON', () => {
        const retorno = {
            dados: JSON.stringify([{
                idDeclaracao: 'abc',
                valoresDevidos: [
                    { codigoTributo: 1010, valor: 120.55 },
                    { codigoTributo: 1001, valor: 80 },
                ],
            }]),
        };

        expect(extrairDeclaracaoTransmitidaPgdas(retorno).idDeclaracao).toBe('abc');
        expect(normalizarValoresDevidosPgdas(retorno)).toEqual([
            { codigoTributo: 1001, valor: 80 },
            { codigoTributo: 1010, valor: 120.55 },
        ]);
        expect(somaValoresDevidosPgdas(retorno)).toBe(200.55);
    });

    it('bloqueia transmissao quando total SERPRO diverge da apuracao local', () => {
        expect(() => assertValorPgdasCompativel({
            valorLocal: 4652.41,
            valoresDevidos: [{ codigoTributo: 1010, valor: 4300 }],
            tolerancia: 0.05,
        })).toThrow(/Nenhuma declaracao foi transmitida/);
    });
});
