/**
 * Retificação da apuração MIT (reencerramento com valores do app).
 *
 * Caso real que motivou a feature (CLINICA MANTOAN 06/2026): apuração
 * transmitida e DEPOIS as aplicações financeiras entraram no app —
 * IRPJ/CSLL mudaram e o MIT precisa ser reencerrado (a DCTFWeb
 * retificadora é gerada automaticamente pela Receita).
 *
 * Trava aqui:
 *  - builder puro montarDebitosRetificacaoMit (antes → depois, preserva
 *    família que o app não apura, nunca chuta código);
 *  - retificarMit fase proposta: exige apuração ENCERRADA, recusa
 *    não-admin, recusa quando não há diferença.
 */
const mockInvokeIntegraContador = jest.fn();

jest.mock('../sefaz-backend/serpro-client.js', () => ({
    invokeIntegraContador: mockInvokeIntegraContador,
}));

import { montarDebitosRetificacaoMit, extrairModeloDebitosMit } from '../sefaz-backend/mit-debitos-builder.js';
// @ts-expect-error — modulo .js puro
import { retificarMit } from '../sefaz-backend/dctfweb-orchestrator.js';

// Débitos como estão HOJE na apuração encerrada (antes da retificação).
const DEBITOS_ATUAIS = {
    Irpj: { ListaDebitos: [{ IdDebito: 1, CodigoDebito: '236201', ValorDebito: 100 }] },
    Csll: { ListaDebitos: [{ IdDebito: 2, CodigoDebito: '248401', ValorDebito: 50 }] },
    PisPasep: { ListaDebitos: [{ IdDebito: 3, CodigoDebito: '810901', ValorDebito: 13 }] },
    Cofins: { ListaDebitos: [{ IdDebito: 4, CodigoDebito: '217201', ValorDebito: 60 }] },
};

describe('montarDebitosRetificacaoMit (puro)', () => {
    it('caso MANTOAN: IRPJ/CSLL sobem, PIS/COFINS iguais — antes → depois honesto', () => {
        const r = montarDebitosRetificacaoMit(
            { IRPJ: 148.8, CSLL: 178.56, PIS: 13, COFINS: 60, IPI: 0 },
            DEBITOS_ATUAIS,
            { codigoPorFamilia: {} },
        );
        expect(r.ok).toBe(true);
        expect(r.temDiferenca).toBe(true);
        expect(r.totalAntes).toBe(223);
        expect(r.totalDepois).toBe(400.36);

        const porFam = Object.fromEntries(r.mapeamento.map((m: any) => [m.familia, m]));
        expect(porFam.IRPJ).toMatchObject({ antes: 100, depois: 148.8, diferenca: 48.8, acao: 'ajustado', codigo: '236201' });
        expect(porFam.CSLL).toMatchObject({ antes: 50, depois: 178.56, acao: 'ajustado', codigo: '248401' });
        expect(porFam.PIS).toMatchObject({ antes: 13, depois: 13, diferenca: 0, acao: 'mantido' });
        expect(porFam.COFINS).toMatchObject({ antes: 60, depois: 60, diferenca: 0, acao: 'mantido' });

        // Débitos reescritos com os códigos ATUAIS da própria apuração.
        expect(r.debitos.Irpj.ListaDebitos[0]).toMatchObject({ CodigoDebito: '236201', ValorDebito: 148.8 });
        expect(r.debitos.Csll.ListaDebitos[0]).toMatchObject({ CodigoDebito: '248401', ValorDebito: 178.56 });
    });

    it('renumera IdDebito sequencialmente na ordem canônica (IRPJ, CSLL, IPI, PIS, COFINS)', () => {
        const comIpi = {
            ...DEBITOS_ATUAIS,
            Ipi: { ListaDebitos: [{ IdDebito: 5, CodigoDebito: '066801', ValorDebito: 20, CnpjEstabelecimento: '000178' }] },
        };
        const r = montarDebitosRetificacaoMit(
            { IRPJ: 110, CSLL: 55, PIS: 14, COFINS: 61, IPI: 25 },
            comIpi,
            { codigoPorFamilia: {} },
        );
        expect(r.ok).toBe(true);
        expect(r.debitos.Irpj.ListaDebitos[0].IdDebito).toBe(1);
        expect(r.debitos.Csll.ListaDebitos[0].IdDebito).toBe(2);
        expect(r.debitos.Ipi.ListaDebitos[0].IdDebito).toBe(3);      // IPI ANTES de PIS/COFINS
        expect(r.debitos.PisPasep.ListaDebitos[0].IdDebito).toBe(4);
        expect(r.debitos.Cofins.ListaDebitos[0].IdDebito).toBe(5);
        // IPI preserva o CnpjEstabelecimento do débito atual (sufixo 6 dígitos).
        expect(r.debitos.Ipi.ListaDebitos[0].CnpjEstabelecimento).toBe('000178');
    });

    it('família com débito no MIT e valor 0 no app é PRESERVADA intacta (não remove tributo declarado)', () => {
        const r = montarDebitosRetificacaoMit(
            { IRPJ: 200, CSLL: 0, PIS: 0, COFINS: 0, IPI: 0 },
            DEBITOS_ATUAIS,
            { codigoPorFamilia: {} },
        );
        expect(r.ok).toBe(true);
        const porFam = Object.fromEntries(r.mapeamento.map((m: any) => [m.familia, m]));
        expect(porFam.CSLL).toMatchObject({ antes: 50, depois: 50, acao: 'mantido' });
        expect(r.debitos.Csll.ListaDebitos[0]).toMatchObject({ CodigoDebito: '248401', ValorDebito: 50 });
        expect(r.debitos.PisPasep.ListaDebitos[0].ValorDebito).toBe(13);
        expect(r.debitos.Cofins.ListaDebitos[0].ValorDebito).toBe(60);
    });

    it('família NOVA usa código do modelo (mês anterior); sem modelo → falha clara, nunca chuta', () => {
        const soIrpjCsll = { Irpj: DEBITOS_ATUAIS.Irpj, Csll: DEBITOS_ATUAIS.Csll };
        const ok = montarDebitosRetificacaoMit(
            { IRPJ: 100, CSLL: 50, PIS: 13, COFINS: 0, IPI: 0 },
            soIrpjCsll,
            { codigoPorFamilia: { PIS: { codigo: '810901', grupo: 'PisPasep' } } },
        );
        expect(ok.ok).toBe(true);
        const pis = ok.mapeamento.find((m: any) => m.familia === 'PIS');
        expect(pis).toMatchObject({ antes: 0, depois: 13, acao: 'incluido', codigo: '810901' });

        const sem = montarDebitosRetificacaoMit(
            { IRPJ: 100, CSLL: 50, PIS: 13, COFINS: 0, IPI: 0 },
            soIrpjCsll,
            { codigoPorFamilia: {} },
        );
        expect(sem.ok).toBe(false);
        expect(sem.erros.join(' ')).toMatch(/PIS/);
        expect(sem.erros.join(' ')).toMatch(/código de débito/);
    });

    it('valores idênticos → temDiferenca false (o orquestrador recusa retificar à toa)', () => {
        const r = montarDebitosRetificacaoMit(
            { IRPJ: 100, CSLL: 50, PIS: 13, COFINS: 60, IPI: 0 },
            DEBITOS_ATUAIS,
            { codigoPorFamilia: {} },
        );
        expect(r.ok).toBe(true);
        expect(r.temDiferenca).toBe(false);
    });

    it('débito atual não classificável por tributo derruba a retificação inteira', () => {
        const estranho = {
            ...DEBITOS_ATUAIS,
            GrupoMisterioso: { ListaDebitos: [{ IdDebito: 9, CodigoDebito: '999901', ValorDebito: 10 }] },
        };
        const r = montarDebitosRetificacaoMit(
            { IRPJ: 200, CSLL: 50, PIS: 13, COFINS: 60, IPI: 0 },
            estranho,
            { codigoPorFamilia: {} },
        );
        expect(r.ok).toBe(false);
        expect(r.erros.join(' ')).toMatch(/não pôde ser classificado/);
        expect(r.debitos).toBeNull();
    });
});

// ── Orquestrador: fase de PROPOSTA (transmitir=false, sem Firestore/emissão) ──

const DADOS_INICIAIS = {
    SemMovimento: false,
    QualificacaoPj: 1,
    TributacaoLucro: 3,
    ResponsavelApuracao: { CpfResponsavel: '70646236849' },
};

const DETALHE_ALVO_ENCERRADO = {
    dados: {
        dadosApuracaoMit: [{
            PeriodoApuracao: { MesApuracao: 6, AnoApuracao: 2026 },
            DadosIniciais: DADOS_INICIAIS,
            Debitos: DEBITOS_ATUAIS,
        }],
    },
};

describe('retificarMit — fase de proposta', () => {
    beforeEach(() => mockInvokeIntegraContador.mockReset());

    const listaComAlvo = (situacao: number) => ({
        dados: { Apuracoes: [{ periodoApuracao: 202606, idApuracao: 333, situacaoApuracao: situacao }] },
    });

    it('apuração ENCERRADA + valores diferentes → proposta antes→depois', async () => {
        mockInvokeIntegraContador
            .mockResolvedValueOnce(listaComAlvo(3))          // LISTAAPURACOES317 anual
            .mockResolvedValueOnce(DETALHE_ALVO_ENCERRADO);  // CONSAPURACAO316 do alvo

        const r = await retificarMit({
            empresaCnpj: '13344638000191',
            anoPA: 2026, mesPA: 6,
            tributosApp: { IRPJ: 148.8, CSLL: 178.56, PIS: 13, COFINS: 60 },
            transmitir: false,
            usuario: { uid: 'u1', email: 'admin@x', role: 'admin' },
        });
        expect(r.ok).toBe(true);
        expect(r.transmitido).toBe(false);
        expect(r.proposta.modo).toBe('retificacao');
        expect(r.proposta.totalAntes).toBe(223);
        expect(r.proposta.totalDepois).toBe(400.36);
        const irpj = r.proposta.mapeamento.find((m: any) => m.familia === 'IRPJ');
        expect(irpj).toMatchObject({ antes: 100, depois: 148.8, acao: 'ajustado' });
    });

    it('apuração NÃO encerrada → recusa e aponta o fluxo normal de preenchimento', async () => {
        mockInvokeIntegraContador
            .mockResolvedValueOnce(listaComAlvo(2))
            .mockResolvedValueOnce(DETALHE_ALVO_ENCERRADO);

        const r = await retificarMit({
            empresaCnpj: '13344638000191',
            anoPA: 2026, mesPA: 6,
            tributosApp: { IRPJ: 148.8, CSLL: 178.56, PIS: 13, COFINS: 60 },
            transmitir: false,
            usuario: { uid: 'u1', email: 'admin@x', role: 'admin' },
        });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/NÃO está encerrada/);
        expect(r.motivo).toMatch(/Preencher MIT/);
    });

    it('usuário sem role admin é recusado ANTES de qualquer consulta ao SERPRO', async () => {
        const r = await retificarMit({
            empresaCnpj: '13344638000191',
            anoPA: 2026, mesPA: 6,
            tributosApp: { IRPJ: 148.8, CSLL: 178.56, PIS: 13, COFINS: 60 },
            transmitir: false,
            usuario: { uid: 'u2', email: 'colab@x', role: 'colaborador' },
        });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/administradores/i);
        expect(mockInvokeIntegraContador).not.toHaveBeenCalled();
    });

    it('valores já batem → recusa com "nada a retificar"', async () => {
        mockInvokeIntegraContador
            .mockResolvedValueOnce(listaComAlvo(3))
            .mockResolvedValueOnce(DETALHE_ALVO_ENCERRADO);

        const r = await retificarMit({
            empresaCnpj: '13344638000191',
            anoPA: 2026, mesPA: 6,
            tributosApp: { IRPJ: 100, CSLL: 50, PIS: 13, COFINS: 60 },
            transmitir: false,
            usuario: { uid: 'u1', email: 'admin@x', role: 'admin' },
        });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/já batem/);
        expect(r.proposta).toBeTruthy(); // preview ainda vem, pra conferência
    });
});

describe('extrairModeloDebitosMit sobre a apuração-alvo', () => {
    it('extrai os códigos das famílias já declaradas (fonte da retificação)', () => {
        const m = extrairModeloDebitosMit(DETALHE_ALVO_ENCERRADO.dados.dadosApuracaoMit[0]);
        expect(m.codigoPorFamilia.IRPJ.codigo).toBe('236201');
        expect(m.codigoPorFamilia.COFINS.codigo).toBe('217201');
    });
});
