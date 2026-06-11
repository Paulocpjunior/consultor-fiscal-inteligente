// @ts-ignore modulo .js puro
import { assertValorPgdasCompativel, extrairDeclaracaoTransmitidaPgdas, montarDadosDeclaracaoPgdas, normalizarValoresDevidosPgdas, somaValoresDevidosPgdas } from '../sefaz-backend/pgdas-utils.js';

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
