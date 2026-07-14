// @ts-ignore modulo .js puro
const mockInvokeIntegraContador = jest.fn();

jest.mock('../sefaz-backend/serpro-client.js', () => ({
    invokeIntegraContador: mockInvokeIntegraContador,
}));

// @ts-ignore modulo .js puro
import { normalizarRespostaDasSerpro } from '../sefaz-backend/das-response-normalizer.js';
// @ts-ignore modulo .js puro
import { extrairNumeroDeclaracaoConsultaPgdas, getDasProvider, inferirTipoDeclaracaoCorretoPgdas, extrairEstabelecimentosFaltantesPgdas, adicionarEstabelecimentosFaltantes } from '../sefaz-backend/das-provider.js';

describe('normalizarRespostaDasSerpro', () => {
    it('extrai PDF e detalhamento quando SERPRO retorna dados em array', () => {
        const result = {
            dados: [
                {
                    pdf: 'JVBERi0xLjQK',
                    detalhamentoDas: {
                        numeroDocumento: '07202616267783487',
                        dataVencimento: '20260622',
                        valores: { total: 4652.41 },
                    },
                },
            ],
        };

        expect(normalizarRespostaDasSerpro(result, 0)).toMatchObject({
            numeroDocumento: '07202616267783487',
            vencimento: '2026-06-22',
            valor: 4652.41,
            pdfBase64: 'JVBERi0xLjQK',
        });
    });

    it('mantem fallback para campos planos esperados', () => {
        const result = {
            dados: {
                numeroDarf: '123',
                linhaDigitavel: '858200000000',
                vencimento: '2026-06-20',
                pdfBase64: 'PDF',
            },
        };

        expect(normalizarRespostaDasSerpro(result, 10)).toMatchObject({
            numeroDocumento: '123',
            codigoBarras: '858200000000',
            vencimento: '2026-06-20',
            valor: 10,
            pdfBase64: 'PDF',
        });
    });
});

describe('das-provider PGDAS retificadora', () => {
    beforeEach(() => {
        mockInvokeIntegraContador.mockReset();
    });

    it('extrai numero de declaracao quando CONSULTIMADECREC14 devolve dados como string JSON', () => {
        const result = {
            dados: JSON.stringify([{
                numeroDeclaracao: '12345678901234567',
                recibo: { nomeArquivo: 'recibo.pdf', pdf: 'PDF' },
            }]),
        };

        expect(extrairNumeroDeclaracaoConsultaPgdas(result)).toBe('12345678901234567');
    });

    it('identifica MSG_ISN_041 pedindo tipo 2-Retificadora', () => {
        const err = new Error(
            'SERPRO 400: [EntradaIncorreta-PGDASD-MSG_ISN_041] - ' +
            'O tipo de declaracao 1-Original nao esta de acordo com a base de dados. ' +
            'O correto e 2-Retificadora.'
        );

        expect(inferirTipoDeclaracaoCorretoPgdas(err)).toBe(2);
    });

    it('refaz validacao como retificadora antes de transmitir quando SERPRO recusa original', async () => {
        const err = new Error(
            'SERPRO 400: [EntradaIncorreta-PGDASD-MSG_ISN_041] - ' +
            'O tipo de declaração 1-Original não está de acordo com a base de dados. ' +
            'O correto é 2-Retificadora.'
        ) as Error & { serproMessages?: Array<{ codigo: string; texto: string }> };
        err.serproMessages = [{
            codigo: 'EntradaIncorreta-PGDASD-MSG_ISN_041',
            texto: 'O tipo de declaração 1-Original não está de acordo com a base de dados. O correto é 2-Retificadora.',
        }];

        const declaracao = {
            receitaPaCompetenciaInterno: 3540.5,
            receitaPaCompetenciaExterno: 0,
            receitaPaCaixaInterno: null,
            receitaPaCaixaExterno: null,
            valorFixoIcms: null,
            valorFixoIss: null,
            receitasBrutasAnteriores: [],
            estabelecimentos: [{
                cnpjCompleto: '12309335000175',
                atividades: [{
                    idAtividade: 11,
                    valorAtividade: 3540.5,
                    receitasAtividade: [{ valor: 3540.5 }],
                }],
            }],
        };

        mockInvokeIntegraContador
            .mockResolvedValueOnce({ dados: {} })
            .mockRejectedValueOnce(err)
            .mockResolvedValueOnce({
                dados: [{
                    valoresDevidos: [{ codigoTributo: 1010, valor: 3540.5 }],
                }],
            })
            .mockResolvedValueOnce({
                dados: [{
                    numeroDeclaracao: '12345678901234567',
                    numeroRecibo: 'REC-1',
                    valoresDevidos: [{ codigoTributo: 1010, valor: 3540.5 }],
                }],
            });

        const provider = getDasProvider() as any;
        const result = await provider.transmitirPgdasD({
            empresaCnpj: '12.309.335/0001-75',
            competencia: '2026-05',
            valor: 3540.5,
            dadosPgdas: { declaracao },
        });

        expect(result.tipoDeclaracao).toBe(2);
        expect(result.numeroDeclaracao).toBe('12345678901234567');
        expect(mockInvokeIntegraContador).toHaveBeenCalledTimes(4);
        expect(mockInvokeIntegraContador.mock.calls[1][0].dados.declaracao.tipoDeclaracao).toBe(1);
        expect(mockInvokeIntegraContador.mock.calls[2][0].dados.declaracao.tipoDeclaracao).toBe(2);
        expect(mockInvokeIntegraContador.mock.calls[3][0].dados.indicadorTransmissao).toBe(true);
        expect(mockInvokeIntegraContador.mock.calls[3][0].dados.declaracao.tipoDeclaracao).toBe(2);
    });
});

describe('PGDAS-D — estabelecimentos faltantes (MSG_ISN_018, empresa com filial)', () => {
    beforeEach(() => mockInvokeIntegraContador.mockReset());

    const erroFilial = () => {
        const e = new Error(
            'SERPRO 400: [EntradaIncorreta-PGDASD-MSG_ISN_018] - SN-Entregar: Um ou mais nis '
            + 'existentes no Cadastro CNPJ não foram enviados no campo Estabelecimento: 54121843000256.'
        ) as Error & { serproMessages?: Array<{ codigo: string; texto: string }> };
        e.serproMessages = [{
            codigo: 'EntradaIncorreta-PGDASD-MSG_ISN_018',
            texto: 'Um ou mais nis existentes no Cadastro CNPJ não foram enviados no campo Estabelecimento: 54121843000256.',
        }];
        return e;
    };

    it('extrairEstabelecimentosFaltantesPgdas pega o(s) CNPJ(s) do erro', () => {
        expect(extrairEstabelecimentosFaltantesPgdas(erroFilial())).toEqual(['54121843000256']);
        expect(extrairEstabelecimentosFaltantesPgdas(new Error('outro erro'))).toEqual([]);
    });

    it('adicionarEstabelecimentosFaltantes inclui filial sem atividades e não duplica a matriz', () => {
        const decl = { estabelecimentos: [{ cnpjCompleto: '54121843000175', atividades: [{ idAtividade: 11, valorAtividade: 10, receitasAtividade: [] }] }] };
        const novo = adicionarEstabelecimentosFaltantes(decl, ['54121843000256', '54121843000175']);
        expect(novo.estabelecimentos).toHaveLength(2);
        expect(novo.estabelecimentos[1]).toEqual({ cnpjCompleto: '54121843000256', atividades: [] });
        // nada novo → null
        expect(adicionarEstabelecimentosFaltantes(decl, ['54121843000175'])).toBeNull();
    });

    it('transmitir: ao receber MSG_ISN_018, adiciona a filial e revalida (auto-correção)', async () => {
        const declaracao = {
            receitaPaCompetenciaInterno: 26832.42,
            receitaPaCompetenciaExterno: 0,
            receitaPaCaixaInterno: null, receitaPaCaixaExterno: null,
            valorFixoIcms: null, valorFixoIss: null,
            receitasBrutasAnteriores: [],
            estabelecimentos: [{ cnpjCompleto: '54121843000175', atividades: [{ idAtividade: 11, valorAtividade: 26832.42, receitasAtividade: [{ valor: 26832.42 }] }] }],
        };

        mockInvokeIntegraContador
            .mockResolvedValueOnce({ dados: {} })            // consultarDeclaracaoPa → não existe (tipo 1)
            .mockRejectedValueOnce(erroFilial())             // validação → MSG_ISN_018
            .mockResolvedValueOnce({ dados: [{ valoresDevidos: [{ codigoTributo: 1010, valor: 26832.42 }] }] }) // revalidação OK
            .mockResolvedValueOnce({ dados: [{ numeroDeclaracao: '99999999999999999', numeroRecibo: 'REC-9', valoresDevidos: [{ codigoTributo: 1010, valor: 26832.42 }] }] }); // transmissão

        const provider = getDasProvider() as any;
        const result = await provider.transmitirPgdasD({
            empresaCnpj: '54.121.843/0001-75', competencia: '2026-06', valor: 26832.42,
            dadosPgdas: { declaracao },
        });

        expect(result.numeroDeclaracao).toBe('99999999999999999');
        expect(mockInvokeIntegraContador).toHaveBeenCalledTimes(4);
        // a revalidação (call[2]) já leva a filial no array de estabelecimentos
        const estabRevalidacao = mockInvokeIntegraContador.mock.calls[2][0].dados.declaracao.estabelecimentos;
        expect(estabRevalidacao.map((e: any) => e.cnpjCompleto).sort())
            .toEqual(['54121843000175', '54121843000256']);
        // e a transmissão também
        expect(mockInvokeIntegraContador.mock.calls[3][0].dados.indicadorTransmissao).toBe(true);
        expect(mockInvokeIntegraContador.mock.calls[3][0].dados.declaracao.estabelecimentos)
            .toHaveLength(2);
    });
});
