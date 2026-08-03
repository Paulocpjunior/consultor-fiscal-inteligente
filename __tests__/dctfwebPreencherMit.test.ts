/**
 * Trava a fase de PROPOSTA do preenchimento automático do MIT
 * (preencherEncerrarMit com transmitir=false — não toca Firestore/emissão).
 *
 * Casos reais 07/07/2026:
 *  - RADIO E TV IBIRAPUERA 06/2026: apuração NÃO existe no MIT → modo
 *    CRIAÇÃO (DadosIniciais copiados do mês-modelo, sem passar pelo e-CAC).
 *  - PEC PRONTA 06/2026: PIS/COFINS lançados, IRPJ/CSLL faltando → modo
 *    COMPLEMENTO preservando débitos existentes.
 */
const mockInvokeIntegraContador = jest.fn();

jest.mock('../sefaz-backend/serpro-client.js', () => ({
    invokeIntegraContador: mockInvokeIntegraContador,
}));

// @ts-expect-error — modulo .js puro
import { preencherEncerrarMit } from '../sefaz-backend/dctfweb-orchestrator.js';

const DADOS_INICIAIS_MODELO = {
    SemMovimento: false,
    QualificacaoPj: 1,
    TributacaoLucro: 3,
    RegimePisCofins: 2,
    ResponsavelApuracao: { CpfResponsavel: '70646236849' },
};

const DETALHE_MODELO_MAIO = {
    dados: {
        dadosApuracaoMit: [{
            PeriodoApuracao: { MesApuracao: 5, AnoApuracao: 2026 },
            DadosIniciais: DADOS_INICIAIS_MODELO,
            Debitos: {
                Irpj: { ListaDebitos: [{ IdDebito: 1, CodigoDebito: '236201', ValorDebito: 100 }] },
                Csll: { ListaDebitos: [{ IdDebito: 2, CodigoDebito: '248401', ValorDebito: 50 }] },
                PisPasep: { ListaDebitos: [{ IdDebito: 3, CodigoDebito: '810901', ValorDebito: 10 }] },
                Cofins: { ListaDebitos: [{ IdDebito: 4, CodigoDebito: '217201', ValorDebito: 40 }] },
            },
        }],
    },
};

describe('preencherEncerrarMit — fase de proposta', () => {
    beforeEach(() => mockInvokeIntegraContador.mockReset());

    it('modo CRIAÇÃO: apuração inexistente vira proposta com DadosIniciais do mês-modelo', async () => {
        mockInvokeIntegraContador
            // consultarApuracaoMit: histórico anual (sem 202606) + fallback mensal (vazio)
            .mockResolvedValueOnce({ dados: { Apuracoes: [{ periodoApuracao: 202605, idApuracao: 222 }] } })
            .mockResolvedValueOnce({ dados: { Apuracoes: [] } })
            // busca do modelo: histórico anual de novo + detalhe do 202605
            .mockResolvedValueOnce({ dados: { Apuracoes: [{ periodoApuracao: 202605, idApuracao: 222 }] } })
            .mockResolvedValueOnce(DETALHE_MODELO_MAIO);

        const r = await preencherEncerrarMit({
            empresaCnpj: '13344638000191',
            anoPA: 2026, mesPA: 6,
            tributosApp: { IRPJ: 148.8, CSLL: 178.56, PIS: 13, COFINS: 60 },
            transmitir: false,
        });

        expect(r.ok).toBe(true);
        expect(r.transmitido).toBe(false);
        expect(r.proposta.modo).toBe('criacao');
        expect(r.proposta.modeloPeriodo).toBe('202605');
        expect(r.proposta.mapeamento.map((m: any) => m.familia)).toEqual(['IRPJ', 'CSLL', 'PIS', 'COFINS']);
        expect(r.proposta.totalProposto).toBe(400.36);
        expect(r.proposta.dadosIniciaisResumo).toEqual({
            qualificacaoPj: 1, tributacaoLucro: 3, cpfResponsavel: '70646236849',
        });
    });

    it('modo COMPLEMENTO: preserva PIS/COFINS lançados e propõe só IRPJ/CSLL', async () => {
        const alvoComPisCofins = {
            dados: {
                dadosApuracaoMit: [{
                    PeriodoApuracao: { MesApuracao: 6, AnoApuracao: 2026 },
                    DadosIniciais: DADOS_INICIAIS_MODELO,
                    Debitos: {
                        PisPasep: { ListaDebitos: [{ IdDebito: 1, CodigoDebito: '810901', ValorDebito: 1376.14 }] },
                        Cofins: { ListaDebitos: [{ IdDebito: 2, CodigoDebito: '217201', ValorDebito: 6351.41 }] },
                    },
                }],
            },
        };
        mockInvokeIntegraContador
            // consultarApuracaoMit: acha 202606 no anual + detalhe do alvo
            .mockResolvedValueOnce({
                dados: { Apuracoes: [
                    { periodoApuracao: 202605, idApuracao: 222 },
                    { periodoApuracao: 202606, idApuracao: 900, situacao: 1 },
                ] },
            })
            .mockResolvedValueOnce(alvoComPisCofins)
            // busca do modelo: histórico anual + detalhe do 202605
            .mockResolvedValueOnce({
                dados: { Apuracoes: [
                    { periodoApuracao: 202605, idApuracao: 222 },
                    { periodoApuracao: 202606, idApuracao: 900 },
                ] },
            })
            .mockResolvedValueOnce(DETALHE_MODELO_MAIO);

        const r = await preencherEncerrarMit({
            empresaCnpj: '11111111000191',
            anoPA: 2026, mesPA: 6,
            tributosApp: { IRPJ: 45102.34, CSLL: 18396.84, PIS: 1376.14, COFINS: 6351.41 },
            transmitir: false,
        });

        expect(r.ok).toBe(true);
        expect(r.proposta.modo).toBe('complemento');
        expect(r.proposta.mapeamento.map((m: any) => m.familia)).toEqual(['IRPJ', 'CSLL']);
        expect(r.proposta.jaDeclarados).toEqual([
            { familia: 'PIS', valor: 1376.14 },
            { familia: 'COFINS', valor: 6351.41 },
        ]);
        // IdDebito continua a numeração dos existentes (1,2 → novos começam em 3)
        const idsNovos = r.proposta.mapeamento.map((m: any, i: number) => i);
        expect(idsNovos).toHaveLength(2);
    });

    it('apuração ENCERRADA (situação 3) bloqueia com orientação de retificação', async () => {
        mockInvokeIntegraContador
            .mockResolvedValueOnce({
                dados: { Apuracoes: [{ periodoApuracao: 202606, idApuracao: 900, situacao: 3 }] },
            })
            .mockResolvedValueOnce({
                dados: {
                    dadosApuracaoMit: [{
                        PeriodoApuracao: { MesApuracao: 6, AnoApuracao: 2026 },
                        DadosIniciais: DADOS_INICIAIS_MODELO,
                        Debitos: { PisPasep: { ListaDebitos: [{ IdDebito: 1, CodigoDebito: '810901', ValorDebito: 10 }] } },
                    }],
                },
            });

        const r = await preencherEncerrarMit({
            empresaCnpj: '11111111000191',
            anoPA: 2026, mesPA: 6,
            tributosApp: { IRPJ: 100, CSLL: 0, PIS: 0, COFINS: 0 },
            transmitir: false,
        });

        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/ENCERRADA/i);
        expect(r.motivo).toMatch(/retifique/i);
    });

    // ── Seleção de quais débitos vão nesta transmissão ────────────────────
    // Pedido do colaborador (03/08/2026): "ter uma opção para selecionar quais
    // débitos com valores do app eu vou transmitir esse mês". Caso típico:
    // Presumido em mês que não fecha trimestre — só PIS/COFINS vão.
    it('familiasSelecionadas RESTRINGE a proposta e registra o que ficou de fora', async () => {
        mockInvokeIntegraContador
            .mockResolvedValueOnce({ dados: { Apuracoes: [{ periodoApuracao: 202605, idApuracao: 222 }] } })
            .mockResolvedValueOnce({ dados: { Apuracoes: [] } })
            .mockResolvedValueOnce({ dados: { Apuracoes: [{ periodoApuracao: 202605, idApuracao: 222 }] } })
            .mockResolvedValueOnce(DETALHE_MODELO_MAIO);

        const r = await preencherEncerrarMit({
            empresaCnpj: '13344638000191',
            anoPA: 2026, mesPA: 7,
            tributosApp: { IRPJ: 1150.92, CSLL: 778.21, PIS: 274.56, COFINS: 1267.2 },
            familiasSelecionadas: ['PIS', 'COFINS'],
            transmitir: false,
        });

        expect(r.ok).toBe(true);
        expect(r.proposta.mapeamento.map((m: any) => m.familia)).toEqual(['PIS', 'COFINS']);
        expect(r.proposta.totalProposto).toBe(1541.76);
        // Farol honesto: o desmarcado aparece na proposta (e na auditoria).
        expect(r.proposta.familiasDesmarcadas).toEqual([
            { familia: 'IRPJ', valor: 1150.92 },
            { familia: 'CSLL', valor: 778.21 },
        ]);
    });

    it('seleção vazia não transmite apuração vazia — para com o motivo', async () => {
        mockInvokeIntegraContador
            .mockResolvedValueOnce({ dados: { Apuracoes: [{ periodoApuracao: 202605, idApuracao: 222 }] } })
            .mockResolvedValueOnce({ dados: { Apuracoes: [] } });

        const r = await preencherEncerrarMit({
            empresaCnpj: '13344638000191',
            anoPA: 2026, mesPA: 7,
            tributosApp: { IRPJ: 100, CSLL: 50, PIS: 10, COFINS: 40 },
            familiasSelecionadas: [],
            transmitir: false,
        });

        expect(r.ok).toBe(false);
        expect(r.etapa).toBe('selecao');
        expect(r.motivo).toMatch(/Marque ao menos um/i);
    });

    it('seleção NUNCA inclui família a mais do que o app apurou', async () => {
        mockInvokeIntegraContador
            .mockResolvedValueOnce({ dados: { Apuracoes: [{ periodoApuracao: 202605, idApuracao: 222 }] } })
            .mockResolvedValueOnce({ dados: { Apuracoes: [] } })
            .mockResolvedValueOnce({ dados: { Apuracoes: [{ periodoApuracao: 202605, idApuracao: 222 }] } })
            .mockResolvedValueOnce(DETALHE_MODELO_MAIO);

        const r = await preencherEncerrarMit({
            empresaCnpj: '13344638000191',
            anoPA: 2026, mesPA: 7,
            // IRPJ/CSLL zerados no app (mês que não fecha trimestre): marcá-los
            // no cliente não pode fazê-los aparecer no MIT.
            tributosApp: { IRPJ: 0, CSLL: 0, PIS: 274.56, COFINS: 1267.2 },
            familiasSelecionadas: ['IRPJ', 'CSLL', 'PIS', 'COFINS'],
            transmitir: false,
        });

        expect(r.ok).toBe(true);
        expect(r.proposta.mapeamento.map((m: any) => m.familia)).toEqual(['PIS', 'COFINS']);
    });
});
