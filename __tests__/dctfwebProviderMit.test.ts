/**
 * Regressão dos serviços MIT no Integra Contador.
 * O SERPRO documenta MIT como idSistema próprio; usar DCTFWEB aqui retorna
 * ICGERENCIADOR-052 (serviço inexistente no catálogo).
 */
const mockInvokeIntegraContador = jest.fn();

jest.mock('../sefaz-backend/serpro-client.js', () => ({
    invokeIntegraContador: mockInvokeIntegraContador,
}));

// @ts-expect-error — modulo .js puro
import { getDctfwebProvider, MIT_SERVICOS } from '../sefaz-backend/dctfweb-provider.js';

const provider = getDctfwebProvider() as any;

describe('SerproProvider MIT — catálogo oficial', () => {
    beforeEach(() => {
        mockInvokeIntegraContador.mockReset();
    });

    it('encerrarApuracaoMit usa MIT/ENCAPURACAO314 e exige payload completo', async () => {
        mockInvokeIntegraContador.mockResolvedValue({
            dados: { protocoloEncerramento: 'PROTO-1', idApuracao: 123 },
        });
        const dadosApuracaoMit = {
            PeriodoApuracao: { MesApuracao: 5, AnoApuracao: 2026 },
            DadosIniciais: {
                SemMovimento: true,
                QualificacaoPj: 11,
                ResponsavelApuracao: { CpfResponsavel: '12345678900' },
            },
            TransmissaoImediata: false,
        };

        const r = await provider.encerrarApuracaoMit({
            empresaCnpj: '51.227.692/0001-46',
            anoPA: 2026,
            mesPA: 5,
            dadosApuracaoMit,
        });

        expect(r.protocolo).toBe('PROTO-1');
        expect(r.idApuracao).toBe(123);
        expect(mockInvokeIntegraContador).toHaveBeenCalledWith(expect.objectContaining({
            idSistema: 'MIT',
            idServico: MIT_SERVICOS.ENCERRAR_APURACAO,
            acao: 'Declarar',
            contribuinteCnpj: '51227692000146',
            dados: dadosApuracaoMit,
        }));
    });

    it('encerrarApuracaoMit não chama SERPRO quando só recebeu ano/mês', async () => {
        await expect(provider.encerrarApuracaoMit({
            empresaCnpj: '51227692000146',
            anoPA: 2026,
            mesPA: 5,
        })).rejects.toThrow(/apuracao completa|ano\/mes/i);
        expect(mockInvokeIntegraContador).not.toHaveBeenCalled();
    });

    it('encerrarApuracaoMit não chama SERPRO sem DadosIniciais', async () => {
        await expect(provider.encerrarApuracaoMit({
            empresaCnpj: '51227692000146',
            anoPA: 2026,
            mesPA: 5,
            dadosApuracaoMit: {
                PeriodoApuracao: { MesApuracao: 5, AnoApuracao: 2026 },
            },
        })).rejects.toThrow(/DadosIniciais/i);
        expect(mockInvokeIntegraContador).not.toHaveBeenCalled();
    });

    it('consultarApuracoesAno usa MIT/LISTAAPURACOES317', async () => {
        mockInvokeIntegraContador.mockResolvedValue({
            dados: { Apuracoes: [{ periodoApuracao: '202605', idApuracao: 456 }] },
        });

        const r = await provider.consultarApuracoesAno({
            empresaCnpj: '51227692000146',
            anoPA: 2026,
            mesPA: 5,
        });

        expect(r.apuracoes).toHaveLength(1);
        expect(mockInvokeIntegraContador).toHaveBeenCalledWith(expect.objectContaining({
            idSistema: 'MIT',
            idServico: MIT_SERVICOS.LISTAR_APURACOES,
            acao: 'Consultar',
            dados: { anoApuracao: 2026, mesApuracao: 5 },
        }));
    });

    it('consultarApuracaoMit usa histórico anual e consulta detalhe do PA correto por idApuracao', async () => {
        mockInvokeIntegraContador
            .mockResolvedValueOnce({
                dados: {
                    Apuracoes: [
                        { periodoApuracao: 202601, idApuracao: 111 },
                        { periodoApuracao: '202605', idApuracao: 789 },
                    ],
                },
            })
            .mockResolvedValueOnce({
                dados: {
                    situacaoApuracao: 2,
                    dadosApuracaoMit: [{ PeriodoApuracao: { MesApuracao: 5, AnoApuracao: 2026 } }],
                },
            });

        const r = await provider.consultarApuracaoMit({
            empresaCnpj: '51227692000146',
            anoPA: 2026,
            mesPA: 5,
        });

        expect(r.idApuracao).toBe(789);
        expect(mockInvokeIntegraContador).toHaveBeenNthCalledWith(1, expect.objectContaining({
            idSistema: 'MIT',
            idServico: MIT_SERVICOS.LISTAR_APURACOES,
            dados: { anoApuracao: 2026 },
        }));
        expect(mockInvokeIntegraContador).toHaveBeenNthCalledWith(2, expect.objectContaining({
            idSistema: 'MIT',
            idServico: MIT_SERVICOS.CONSULTAR_APURACAO,
            dados: { idApuracao: 789 },
        }));
    });

    it('consultarApuracaoMit não usa apuração de outro mês quando o PA solicitado não existe', async () => {
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: {
                Apuracoes: [
                    { periodoApuracao: 202601, idApuracao: 111 },
                    { periodoApuracao: 202602, idApuracao: 222 },
                ],
            },
        });

        const r = await provider.consultarApuracaoMit({
            empresaCnpj: '51227692000146',
            anoPA: 2026,
            mesPA: 5,
        });

        expect(r.apuracaoMit).toBeNull();
        expect(r.motivo).toMatch(/202605/);
        expect(mockInvokeIntegraContador).toHaveBeenCalledTimes(1);
    });

    it('consultarApuracaoMit reconhece PeriodoApuracao em objeto no histórico anual', async () => {
        mockInvokeIntegraContador
            .mockResolvedValueOnce({
                dados: {
                    Apuracoes: [{
                        PeriodoApuracao: { AnoApuracao: 2026, MesApuracao: 5 },
                        IdApuracao: 987,
                    }],
                },
            })
            .mockResolvedValueOnce({
                dados: {
                    dadosApuracaoMit: [{
                        PeriodoApuracao: { MesApuracao: 5, AnoApuracao: 2026 },
                        DadosIniciais: { SemMovimento: true },
                    }],
                },
            });

        const r = await provider.consultarApuracaoMit({
            empresaCnpj: '51227692000146',
            anoPA: 2026,
            mesPA: 5,
        });

        expect(r.idApuracao).toBe(987);
        expect(mockInvokeIntegraContador).toHaveBeenNthCalledWith(2, expect.objectContaining({
            idSistema: 'MIT',
            idServico: MIT_SERVICOS.CONSULTAR_APURACAO,
            dados: { idApuracao: 987 },
        }));
    });
});
