/**
 * Regressão dos serviços MIT no Integra Contador.
 * O SERPRO documenta MIT como idSistema próprio; usar DCTFWEB aqui retorna
 * ICGERENCIADOR-052 (serviço inexistente no catálogo).
 */
const mockInvokeIntegraContador = jest.fn();

jest.mock('../sefaz-backend/serpro-client.js', () => ({
    invokeIntegraContador: mockInvokeIntegraContador,
}));

// Transmissão DCTFWeb assina o XML com o cert do escritório (Secret Manager)
// — mocka o loader e o assinador pra manter o teste unitário.
jest.mock('../sefaz-backend/secret-loader.js', () => ({
    loadCertificate: jest.fn().mockResolvedValue({ pemKey: 'KEY', pemCert: 'CERT' }),
}));
jest.mock('../sefaz-backend/dctfweb-xml-signer.js', () => ({
    assinarXmlDctfwebBase64: jest.fn().mockReturnValue('XML_ASSINADO_B64_FAKE'),
}));

// @ts-expect-error — modulo .js puro
import { getDctfwebProvider, MIT_SERVICOS, extrairXmlDeclaracao } from '../sefaz-backend/dctfweb-provider.js';
// @ts-expect-error — modulo .js puro (mockado acima; import pra inspecionar chamadas)
import { assinarXmlDctfwebBase64 } from '../sefaz-backend/dctfweb-xml-signer.js';

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

    it('transmitir/gerarDarf usam os idServico OFICIAIS do catálogo DCTFWEB (não os chutes antigos)', async () => {
        // ICGERENCIADOR-052 de 07/07/2026: TRANSDECLARACAO11 (que é do PGDASD),
        // GERARDOCUMENTOARRECADACAO12 e GERARDARFANDAMENTO não existem no
        // catálogo DCTFWEB. Oficiais: TRANSDECLARACAO310 / GERARGUIA31 /
        // GERARGUIAANDAMENTO313 / CONSXMLDECLARACAO38.
        mockInvokeIntegraContador.mockResolvedValue({ dados: {} });

        // Transmissão: 1º consulta o XML (CONSXMLDECLARACAO38), 2º transmite
        // com o XML assinado em base64 (TRANS21_Xml_Assinado_Base64 exigido).
        mockInvokeIntegraContador.mockResolvedValueOnce({ dados: { xml: '<DeclaracaoDctfWeb/>' } });
        await provider.transmitirDeclaracao({ empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6 });
        expect(mockInvokeIntegraContador).toHaveBeenNthCalledWith(1, expect.objectContaining({
            idSistema: 'DCTFWEB', idServico: 'CONSXMLDECLARACAO38', acao: 'Consultar',
        }));
        expect(mockInvokeIntegraContador).toHaveBeenLastCalledWith(expect.objectContaining({
            idSistema: 'DCTFWEB', idServico: 'TRANSDECLARACAO310', acao: 'Declarar',
            dados: expect.objectContaining({ xmlAssinadoBase64: 'XML_ASSINADO_B64_FAKE' }),
        }));

        await provider.gerarDarf({ empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6 });
        expect(mockInvokeIntegraContador).toHaveBeenLastCalledWith(expect.objectContaining({
            idServico: 'GERARGUIA31', acao: 'Emitir',
        }));

        await provider.gerarDarf({ empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6, emAndamento: true });
        expect(mockInvokeIntegraContador).toHaveBeenLastCalledWith(expect.objectContaining({
            idServico: 'GERARGUIAANDAMENTO313', acao: 'Emitir',
        }));

        await provider.consultarXmlDeclaracao({ empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6 });
        expect(mockInvokeIntegraContador).toHaveBeenLastCalledWith(expect.objectContaining({
            idServico: 'CONSXMLDECLARACAO38', acao: 'Consultar',
        }));
    });

    it('transmitirDeclaracao falha claro quando a consulta do XML volta vazia', async () => {
        mockInvokeIntegraContador.mockResolvedValueOnce({ dados: {} }); // sem xml
        await expect(provider.transmitirDeclaracao({
            empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6,
        })).rejects.toThrow(/não retornou o XML/i);
        expect(mockInvokeIntegraContador).toHaveBeenCalledTimes(1); // não tenta transmitir
    });

    it('transmitirDeclaracao lê o XML de dados.XMLStringBase64 (shape oficial do CONSXMLDECLARACAO38)', async () => {
        // Caso RADIO E TV 06/2026 (08/07/2026): a resposta 200 vinha CHEIA em
        // XMLStringBase64, mas o código só olhava XMLByteArrayBase64/xmlBase64
        // e abortava com "CONSXMLDECLARACAO38 vazio".
        const xml = '<DeclaracaoDctfWeb versao="1.0"/>';
        mockInvokeIntegraContador
            .mockResolvedValueOnce({ dados: { XMLStringBase64: Buffer.from(xml, 'utf8').toString('base64') } })
            .mockResolvedValueOnce({ dados: { numeroRecibo: 'R-1' } });

        const r = await provider.transmitirDeclaracao({
            empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6,
        });

        expect(r.numeroRecibo).toBe('R-1');
        // O XML assinado deve ser EXATAMENTE o recebido (exigência do SERPRO).
        expect(assinarXmlDctfwebBase64).toHaveBeenCalledWith(expect.objectContaining({ xml }));
        expect(mockInvokeIntegraContador).toHaveBeenLastCalledWith(expect.objectContaining({
            idServico: 'TRANSDECLARACAO310',
            dados: expect.objectContaining({ xmlAssinadoBase64: 'XML_ASSINADO_B64_FAKE' }),
        }));
    });

    it('erro de XML vazio inclui as mensagens e os campos que o SERPRO devolveu', async () => {
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: { info: 'sem xml aqui' },
            mensagens: [{ codigo: 'DCTFWEB-XYZ', texto: 'Situação inesperada' }],
        });
        await expect(provider.transmitirDeclaracao({
            empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6,
        })).rejects.toThrow(/DCTFWEB-XYZ - Situação inesperada.*Campos retornados: info/s);
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

describe('extrairXmlDeclaracao — shapes de resposta do CONSXMLDECLARACAO38', () => {
    const XML = '<?xml version="1.0"?><DeclaracaoDctfWeb/>';
    const b64 = Buffer.from(XML, 'utf8').toString('base64');

    it('lê o shape oficial XMLStringBase64', () => {
        expect(extrairXmlDeclaracao({ XMLStringBase64: b64 })).toBe(XML);
    });

    it('mantém compatibilidade com os campos legados', () => {
        expect(extrairXmlDeclaracao({ XMLByteArrayBase64: b64 })).toBe(XML);
        expect(extrairXmlDeclaracao({ xmlBase64: b64 })).toBe(XML);
        expect(extrairXmlDeclaracao({ xml: XML })).toBe(XML);
    });

    it('aceita dados como string crua (XML direto ou base64 sem wrapper JSON)', () => {
        expect(extrairXmlDeclaracao(XML)).toBe(XML);
        expect(extrairXmlDeclaracao(b64)).toBe(XML);
    });

    it('varre campos desconhecidos que contenham XML (cru ou base64)', () => {
        expect(extrairXmlDeclaracao({ outroNomeQualquer: b64 })).toBe(XML);
    });

    it('devolve vazio para respostas sem XML (não inventa conteúdo)', () => {
        expect(extrairXmlDeclaracao({})).toBe('');
        expect(extrairXmlDeclaracao(null)).toBe('');
        expect(extrairXmlDeclaracao({ mensagem: 'sem declaracao para o periodo' })).toBe('');
    });
});

describe('SerproProvider — recibo, DARF e transmissão (retornos pós-transmissão)', () => {
    beforeEach(() => {
        mockInvokeIntegraContador.mockReset();
    });

    it('consultarRecibo envia a categoria pelo NOME do catálogo (nunca o código interno 13)', async () => {
        // Caso real 08/07/2026: CONSRECIBO32 com categoria numérica 13 (código
        // interno do app) voltava 200 sem PDF — o catálogo SERPRO usa nomes
        // (GERAL_MENSAL) ou os códigos DELE (40), que não são os do app.
        mockInvokeIntegraContador.mockResolvedValue({ dados: { PDFByteArrayBase64: 'PDF64' } });

        const r = await provider.consultarRecibo({
            empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6, categoria: 'GERAL_MENSAL',
        });
        expect(mockInvokeIntegraContador).toHaveBeenCalledWith(expect.objectContaining({
            idServico: 'CONSRECIBO32',
            dados: expect.objectContaining({ categoria: 'GERAL_MENSAL', anoPA: '2026', mesPA: '06' }),
        }));
        expect(r.pdfBase64).toBe('PDF64');

        // Código numérico legado (13) é convertido de volta pro nome.
        await provider.consultarRecibo({
            empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6, categoria: 13,
        });
        expect(mockInvokeIntegraContador).toHaveBeenLastCalledWith(expect.objectContaining({
            dados: expect.objectContaining({ categoria: 'GERAL_MENSAL' }),
        }));
    });

    it('consultarRecibo lê dados em LISTA e expõe mensagens + campos quando não vem PDF', async () => {
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: [{ situacao: 'PROCESSANDO' }],
            mensagens: [{ codigo: 'DCTFWEB-AVISO', texto: 'Recibo ainda em processamento' }],
        });
        const r = await provider.consultarRecibo({
            empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6,
        });
        expect(r.pdfBase64).toBe('');
        expect(r.mensagens).toEqual([{ codigo: 'DCTFWEB-AVISO', texto: 'Recibo ainda em processamento' }]);
        expect(r._camposRetornados).toEqual(['situacao']);

        // Com PDF em lista, extrai normalmente e não expõe _camposRetornados.
        mockInvokeIntegraContador.mockResolvedValueOnce({ dados: [{ PDFByteArrayBase64: 'PDF64' }] });
        const ok = await provider.consultarRecibo({
            empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6,
        });
        expect(ok.pdfBase64).toBe('PDF64');
        expect(ok._camposRetornados).toBeUndefined();
    });

    it('gerarDarf: valor null (não 0 fake) quando o SERPRO só retorna o PDF, e _raw sem o base64', async () => {
        // GERARGUIA31 retorna APENAS PDFByteArrayBase64 — valor/vencimento/
        // código de barras constam só dentro do PDF (shape oficial).
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: { PDFByteArrayBase64: 'PDF_DARF_64' },
            mensagens: [{ codigo: 'Sucesso-DCTFWEB', texto: 'Guia emitida' }],
        });
        const r = await provider.gerarDarf({ empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6 });
        expect(r.pdfBase64).toBe('PDF_DARF_64');
        expect(r.valor).toBeNull();
        expect(r.vencimento).toBe('');
        expect(r.codigoBarras).toBe('');
        expect(r._raw).not.toHaveProperty('PDFByteArrayBase64');
        expect(r.mensagens).toHaveLength(1);

        // Se algum dia o SERPRO mandar valor, continua sendo lido.
        mockInvokeIntegraContador.mockResolvedValueOnce({
            dados: { PDFByteArrayBase64: 'PDF64', valor: '123.45', dataVencimento: '2026-07-25' },
        });
        const r2 = await provider.gerarDarf({ empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6 });
        expect(r2.valor).toBe(123.45);
        expect(r2.vencimento).toBe('2026-07-25');
    });

    it('transmitirDeclaracao extrai numeroRecibo de campos alternativos e monta transmitidoEm', async () => {
        // Caso real 08/07/2026: recibo ficava "Não informado" — o shape oficial
        // traz numeroRecibo/dataTransmissao/horaTransmissao, mas há variações.
        const xml = '<DeclaracaoDctfWeb/>';
        mockInvokeIntegraContador
            .mockResolvedValueOnce({ dados: { XMLStringBase64: Buffer.from(xml).toString('base64') } })
            .mockResolvedValueOnce({
                dados: { numRecibo: '2026.06.98765', dataTransmissao: '08/07/2026', horaTransmissao: '09:31' },
                mensagens: [{ codigo: 'Sucesso-DCTFWEB', texto: 'Declaração transmitida' }],
            });
        const r = await provider.transmitirDeclaracao({
            empresaCnpj: '09010732000137', anoPA: 2026, mesPA: 6,
        });
        expect(r.numeroRecibo).toBe('2026.06.98765');
        expect(r.transmitidoEm).toBe('08/07/2026 09:31');
        expect(r.mensagens).toHaveLength(1);
    });
});
