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

    it('encerrarApuracaoMit barra apuração com movimento e Debitos VAZIO antes do SERPRO (caso MIT-MSG_0003)', async () => {
        // Apuração criada no e-CAC, em edição: Debitos existe mas sem nenhum
        // débito lançado. Antes o clique ia ao SERPRO e voltava 400
        // [EntradaIncorreta-MIT-MSG_0003].
        for (const debitosVazios of [{}, { Irpj: { ListaDebitos: [] } }, []]) {
            await expect(provider.encerrarApuracaoMit({
                empresaCnpj: '55070577000161',
                anoPA: 2026,
                mesPA: 6,
                dadosApuracaoMit: {
                    PeriodoApuracao: { MesApuracao: 6, AnoApuracao: 2026 },
                    DadosIniciais: { SemMovimento: false, QualificacaoPj: 1 },
                    Debitos: debitosVazios,
                },
            })).rejects.toThrow(/sem nenhum debito lancado/i);
        }
        expect(mockInvokeIntegraContador).not.toHaveBeenCalled();
    });

    it('encerrarApuracaoMit remove campo que o SERPRO recusa ("não deve ser informado") e retransmite', async () => {
        // Caso real 55070577000161 · 06/2026 (Lucro Presumido): a consulta
        // devolve DadosIniciais.RegimePisCofins, o encerramento rejeita.
        mockInvokeIntegraContador
            .mockRejectedValueOnce(new Error(
                'SERPRO 400: [EntradaIncorreta-MIT-MSG_0003] - O Json contém dados inválidos - DadosIniciais.RegimePisCofins: campo não deve ser informado.'
            ))
            .mockResolvedValueOnce({ dados: { protocoloEncerramento: 'PROTO-RETRY', idApuracao: 700 } });

        const r = await provider.encerrarApuracaoMit({
            empresaCnpj: '55070577000161',
            anoPA: 2026,
            mesPA: 6,
            dadosApuracaoMit: {
                PeriodoApuracao: { MesApuracao: 6, AnoApuracao: 2026 },
                DadosIniciais: { SemMovimento: false, QualificacaoPj: 1, TributacaoLucro: 3, RegimePisCofins: 2 },
                Debitos: { Irpj: { ListaDebitos: [{ IdDebito: 1, CodigoDebito: '236201', ValorDebito: 100 }] } },
            },
        });

        expect(r.protocolo).toBe('PROTO-RETRY');
        expect(r.camposRemovidos).toEqual(['DadosIniciais.RegimePisCofins']);
        expect(mockInvokeIntegraContador).toHaveBeenCalledTimes(2);
        const segundaChamada = mockInvokeIntegraContador.mock.calls[1][0];
        expect(segundaChamada.dados.DadosIniciais.RegimePisCofins).toBeUndefined();
        expect(segundaChamada.dados.DadosIniciais.TributacaoLucro).toBe(3); // demais campos intactos
        expect(segundaChamada.dados.Debitos.Irpj.ListaDebitos).toHaveLength(1);
    });

    it('encerrarApuracaoMit NÃO insiste em erro sem padrão "não deve ser informado"', async () => {
        mockInvokeIntegraContador.mockRejectedValueOnce(new Error('SERPRO 500: indisponível'));
        await expect(provider.encerrarApuracaoMit({
            empresaCnpj: '55070577000161',
            anoPA: 2026,
            mesPA: 6,
            dadosApuracaoMit: {
                PeriodoApuracao: { MesApuracao: 6, AnoApuracao: 2026 },
                DadosIniciais: { SemMovimento: true },
            },
        })).rejects.toThrow(/500/);
        expect(mockInvokeIntegraContador).toHaveBeenCalledTimes(1);
    });

    it('encerrarApuracaoMit não entra em loop quando o campo apontado não existe no payload', async () => {
        mockInvokeIntegraContador.mockRejectedValue(new Error(
            'SERPRO 400: [MIT-MSG_0003] - DadosIniciais.CampoFantasma: campo não deve ser informado.'
        ));
        await expect(provider.encerrarApuracaoMit({
            empresaCnpj: '55070577000161',
            anoPA: 2026,
            mesPA: 6,
            dadosApuracaoMit: {
                PeriodoApuracao: { MesApuracao: 6, AnoApuracao: 2026 },
                DadosIniciais: { SemMovimento: true },
            },
        })).rejects.toThrow(/CampoFantasma/);
        expect(mockInvokeIntegraContador).toHaveBeenCalledTimes(1);
    });

    it('encerrarApuracaoMit transmite quando há ao menos um débito real', async () => {
        mockInvokeIntegraContador.mockResolvedValue({
            dados: { protocoloEncerramento: 'PROTO-6', idApuracao: 606 },
        });
        const r = await provider.encerrarApuracaoMit({
            empresaCnpj: '55070577000161',
            anoPA: 2026,
            mesPA: 6,
            dadosApuracaoMit: {
                PeriodoApuracao: { MesApuracao: 6, AnoApuracao: 2026 },
                DadosIniciais: { SemMovimento: false, QualificacaoPj: 1 },
                Debitos: { Irpj: { ListaDebitos: [{ CodigoDebito: '236201', ValorDebito: 1234.56 }] } },
            },
        });
        expect(r.protocolo).toBe('PROTO-6');
        expect(mockInvokeIntegraContador).toHaveBeenCalledTimes(1);
    });

    it('listarDeclaracoes traduz DCTFWEB-MG10 em _info amigável (aguardando transmissão), sem _erro', async () => {
        // Caso RADIO E TV 06/2026: declaração gerada pelo MIT ainda "Em
        // Andamento" — a consulta completa devolve MG10, que NÃO é erro.
        mockInvokeIntegraContador.mockRejectedValueOnce(new Error(
            'SERPRO 400: [EntradaIncorreta-DCTFWEB-MG10] - A declaração mais recente está na situação "Em Andamento", '
            + 'incompatível com a execução da funcionalidade. Favor informar o "numeroReciboEntrega".'
        ));
        const r = await provider.listarDeclaracoes('09010732000137', { anoPA: 2026, mesPA: 6 });
        expect(r).toHaveLength(1);
        expect(r[0].situacao).toBe('EM_ANDAMENTO');
        expect(r[0]._erro).toBeNull();
        expect(r[0]._info).toMatch(/aguardando transmissão/i);
        expect(r[0]._info).toMatch(/Transmitir/);
    });

    it('listarDeclaracoes mantém _erro para falhas que não são MG10', async () => {
        mockInvokeIntegraContador.mockRejectedValueOnce(new Error('SERPRO 500: indisponível'));
        const r = await provider.listarDeclaracoes('09010732000137', { anoPA: 2026, mesPA: 6 });
        expect(r[0]._erro).toMatch(/500/);
        expect(r[0]._info).toBeNull();
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
        mockInvokeIntegraContador
            .mockResolvedValueOnce({
                dados: {
                    Apuracoes: [
                        { periodoApuracao: 202601, idApuracao: 111 },
                        { periodoApuracao: 202602, idApuracao: 222 },
                    ],
                },
            })
            // fallback dirigido ao mês também não encontra
            .mockResolvedValueOnce({ dados: { Apuracoes: [] } });

        const r = await provider.consultarApuracaoMit({
            empresaCnpj: '51227692000146',
            anoPA: 2026,
            mesPA: 5,
        });

        expect(r.apuracaoMit).toBeNull();
        expect(r.motivo).toMatch(/202605/);
        // Diagnóstico: mostra o que o MIT tem, pra ficar óbvio o que falta
        expect(r.motivo).toMatch(/202601, 202602/);
        expect(r.motivo).toMatch(/e-CAC/);
        // 2 chamadas: LISTAAPURACOES317 por ano + fallback por mês (sem CONSAPURACAO316)
        expect(mockInvokeIntegraContador).toHaveBeenCalledTimes(2);
        expect(mockInvokeIntegraContador).toHaveBeenNthCalledWith(2, expect.objectContaining({
            idSistema: 'MIT',
            idServico: MIT_SERVICOS.LISTAR_APURACOES,
            dados: { anoApuracao: 2026, mesApuracao: 5 },
        }));
    });

    it('consultarApuracaoMit acha a apuração pela consulta MENSAL quando o histórico anual não traz o PA', async () => {
        mockInvokeIntegraContador
            // 1ª: histórico anual SEM a competência pedida (caso real 202606)
            .mockResolvedValueOnce({
                dados: {
                    Apuracoes: [
                        { periodoApuracao: 202604, idApuracao: 111 },
                        { periodoApuracao: 202605, idApuracao: 222 },
                    ],
                },
            })
            // 2ª: consulta dirigida ao mês encontra (ex.: apuração em edição)
            .mockResolvedValueOnce({
                dados: { Apuracoes: [{ periodoApuracao: 202606, idApuracao: 333, situacao: 1 }] },
            })
            // 3ª: detalhe da apuração encontrada
            .mockResolvedValueOnce({
                dados: {
                    dadosApuracaoMit: [{
                        PeriodoApuracao: { MesApuracao: 6, AnoApuracao: 2026 },
                        DadosIniciais: { SemMovimento: false },
                        Debitos: {},
                    }],
                },
            });

        const r = await provider.consultarApuracaoMit({
            empresaCnpj: '55070577000161',
            anoPA: 2026,
            mesPA: 6,
        });

        expect(r.idApuracao).toBe(333);
        expect(mockInvokeIntegraContador).toHaveBeenNthCalledWith(2, expect.objectContaining({
            idServico: MIT_SERVICOS.LISTAR_APURACOES,
            dados: { anoApuracao: 2026, mesApuracao: 6 },
        }));
        expect(mockInvokeIntegraContador).toHaveBeenNthCalledWith(3, expect.objectContaining({
            idServico: MIT_SERVICOS.CONSULTAR_APURACAO,
            dados: { idApuracao: 333 },
        }));
    });

    it('consultarApuracaoMit degrada com clareza se a consulta mensal falhar', async () => {
        mockInvokeIntegraContador
            .mockResolvedValueOnce({
                dados: { Apuracoes: [{ periodoApuracao: 202605, idApuracao: 222 }] },
            })
            .mockRejectedValueOnce(new Error('ICGERENCIADOR-999 indisponível'));

        const r = await provider.consultarApuracaoMit({
            empresaCnpj: '55070577000161',
            anoPA: 2026,
            mesPA: 6,
        });

        expect(r.apuracaoMit).toBeNull();
        expect(r.motivo).toMatch(/consulta por mês falhou/i);
        expect(r.motivo).toMatch(/202605/);
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
