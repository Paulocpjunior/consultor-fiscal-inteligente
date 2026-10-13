/**
 * @jest-environment node
 */
/**
 * Obrigação cuja consulta não foi feita/possível é "não verificada", nunca
 * "pendente" nem "em dia" (Paulo, 13/10/2026). Depois do #1406, eSocial e
 * FGTS Digital respondem ok:false 'nao_oferecido_serpro' (o Integra Contador
 * não tem a consulta), e a análise completa ainda os listava como pendentes.
 * O que trava aqui:
 *   1. analisarEmpresaCompleta (fixture que passa pelas consultas reais do
 *      provider, com o SERPRO simulado): nao_oferecido_serpro e indisponivel
 *      → 'nao_verificada' com o motivo; ok:true entregue → 'entregue';
 *      ok:true não entregue → 'pendente'; resumo não conta não verificada
 *      como pendente;
 *   2. o túnel do DP ganha statusObrigacao sem perder campo;
 *   3. a tela: o mapeador leva status + motivo (inclusive FGTS/SPED, que o
 *      backend nomeia diferente da base) e a contagem dos cards.
 * Nenhum dado real: CNPJ 11.222.333/0001-81.
 */
// @ts-nocheck — módulos .js do backend

const mockRotas = {};
jest.mock('express', () => {
    const rota = () => {
        const r = { get() {}, put() {}, patch() {}, delete() {}, use() {} };
        r.post = (caminho, ...fns) => { mockRotas[caminho] = fns[fns.length - 1]; };
        return r;
    };
    return { __esModule: true, default: Object.assign(() => rota(), { Router: rota, json: () => () => {} }) };
});
jest.mock('firebase-admin', () => ({
    __esModule: true,
    default: {
        apps: [{}],
        initializeApp: () => {},
        credential: { applicationDefault: () => ({}) },
        // Sem Firestore: as consultas com cache (situação, dívida, certidões,
        // parcelamentos) falham e caem no allSettled — não são o assunto aqui.
        firestore: Object.assign(() => ({}), { FieldValue: { serverTimestamp: () => 'agora' } }),
    },
}));

const mockInvoke = jest.fn();
jest.mock('../sefaz-backend/serpro-client.js', () => ({
    invokeIntegraContador: (req) => mockInvoke(req),
    getSerproConfig: () => ({}),
}));

// CRF vai à consulta pública da Caixa: sem rede no teste.
jest.mock('../sefaz-backend/cnd-publica-provider.js', () => ({
    consultarCrfFgtsPublica: async () => ({ status: 'negativa', fonte: 'consulta_publica' }),
    consultarCndsPublicas: async () => ({ certidoes: [] }),
}));

const mockRecibo = jest.fn();
jest.mock('../sefaz-backend/dctfweb-provider.js', () => ({
    getDctfwebProvider: () => ({ consultarRecibo: (...a) => mockRecibo(...a) }),
}));

import {
    analisarEmpresaCompleta, statusDaObrigacao, comStatusDaObrigacao, resumoDasObrigacoes,
    consultarESocial, consultarFgtsDigital, SERPRO_NAO_OFERECE,
} from '../sefaz-backend/nfp-compliance-provider.js';
import '../sefaz-backend/dp-integration-routes.js';
import { mapearRespostaSerpro } from '../services/nfpAnaliseSerpro';
import { contarObrigacoes } from '../services/nfpManualAnalysis';
import { OBRIGACOES_BASE } from '../components/NfpProCloud/_common';

const CNPJ = '11222333000181';

beforeEach(() => {
    mockInvoke.mockReset();
    mockRecibo.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('statusDaObrigacao', () => {
    it('nao_oferecido_serpro → não verificada, com o motivo', async () => {
        expect(statusDaObrigacao(await consultarESocial(CNPJ, '2026-09'))).toEqual({ status: 'nao_verificada', motivo: SERPRO_NAO_OFERECE });
        expect(statusDaObrigacao(await consultarFgtsDigital(CNPJ, '2026-09'))).toEqual({ status: 'nao_verificada', motivo: SERPRO_NAO_OFERECE });
        // Sem a frase de erro, o motivo vem da situação.
        expect(statusDaObrigacao({ ok: false, situacao: 'nao_oferecido_serpro' })).toEqual({ status: 'nao_verificada', motivo: SERPRO_NAO_OFERECE });
    });

    it('indisponivel → não verificada, com o motivo (nunca pendente nem entregue)', () => {
        const r = statusDaObrigacao({ ok: false, entregue: false, situacao: 'indisponivel', erro: 'Serviço indisponível' });
        expect(r).toEqual({ status: 'nao_verificada', motivo: 'Serviço indisponível' });
        const semErro = statusDaObrigacao({ ok: false, entregue: false, situacao: 'indisponivel' });
        expect(semErro.status).toBe('nao_verificada');
        expect(semErro.motivo).toBeTruthy();
        // FGTS com regular:false e zeros de "não consultado" também não é pendente.
        expect(statusDaObrigacao({ ok: false, regular: false, depositoDevido: 0, situacao: 'nao_oferecido_serpro' }).status).toBe('nao_verificada');
        expect(statusDaObrigacao(undefined).status).toBe('nao_verificada');
    });

    it('ok:true entregue → em dia (entregue); ok:true não entregue → pendente', () => {
        expect(statusDaObrigacao({ ok: true, entregue: true, situacao: 'TRANSMITIDA' })).toEqual({ status: 'entregue' });
        expect(statusDaObrigacao({ ok: true, regular: true })).toEqual({ status: 'entregue' });
        expect(statusDaObrigacao({ ok: true, gerado: true, pago: true })).toEqual({ status: 'entregue' });
        expect(statusDaObrigacao({ ok: true, entregue: false, situacao: 'SEM_RECIBO' })).toEqual({ status: 'pendente' });
        expect(statusDaObrigacao({ ok: true, gerado: true, pago: false })).toEqual({ status: 'pendente' });
    });
});

describe('analisarEmpresaCompleta — lista de obrigações', () => {
    it('lucro presumido: cada consulta cai no status certo e a contagem não soma não verificada', async () => {
        mockRecibo.mockResolvedValue({ fonte: 'serpro', pdfBase64: 'JVBERi0=' }); // DCTFWeb transmitida
        mockInvoke.mockImplementation(async ({ idSistema, idServico }) => {
            if (idServico === 'CONSULTARECD') return { situacao: 'ENTREGUE', dataEntrega: '2026-05-29' };
            if (idServico === 'CONSULTARECF') return { situacao: 'EM ABERTO' };
            throw new Error(`SERPRO 400: ${idSistema}/${idServico} fora do ar`);
        });

        const r = await analisarEmpresaCompleta(CNPJ, 'lucro_presumido', {});
        const por = Object.fromEntries(r.obrigacoes.obrigacoes.map((o) => [o.sigla, o]));

        expect(por.DCTFWeb).toMatchObject({ status: 'entregue' });
        expect(por.DCTFWeb.motivo).toBeUndefined();
        expect(por.ECD).toMatchObject({ status: 'entregue' });
        expect(por.ECF).toMatchObject({ status: 'pendente' });
        expect(por.eSocial).toMatchObject({ status: 'nao_verificada', motivo: SERPRO_NAO_OFERECE });
        expect(por['FGTS Digital']).toMatchObject({ status: 'nao_verificada', motivo: SERPRO_NAO_OFERECE });
        expect(por['SPED Fiscal']).toMatchObject({ status: 'nao_verificada', motivo: 'Serviço SERPRO indisponível no momento' });
        expect(por['SPED Contribuicoes']).toMatchObject({ status: 'nao_verificada' });
        expect(por['SPED Contribuicoes'].motivo).toBeTruthy();

        expect(r.obrigacoes.resumo).toEqual({ total: 7, entregues: 2, pendentes: 1, naoVerificadas: 4 });
        // eSocial/FGTS não chamam o SERPRO; ECD, ECF e os dois SPED sim.
        const chamados = mockInvoke.mock.calls.map(([q]) => q.idServico);
        expect(chamados).not.toContain('CONSULTARFECHAMENTO');
        expect(chamados).not.toContain('CONSULTARRECOLHIMENTO');
        expect(chamados).toEqual(expect.arrayContaining(['CONSULTARECD', 'CONSULTARECF', 'CONSULTARENTREGA']));
    });

    it('DCTFWeb sem recibo (ok:true, não entregue) é pendente; recibo recusado é não verificada', async () => {
        mockInvoke.mockRejectedValue(new Error('SERPRO 500'));
        mockRecibo.mockResolvedValueOnce({ fonte: 'serpro', mensagens: [] });
        const semRecibo = await analisarEmpresaCompleta(CNPJ, 'simples_nacional', {});
        const d1 = semRecibo.obrigacoes.obrigacoes.find((o) => o.sigla === 'DCTFWeb');
        expect(d1).toMatchObject({ status: 'pendente' });

        mockRecibo.mockRejectedValueOnce(new Error('SERPRO 503'));
        const recusado = await analisarEmpresaCompleta(CNPJ, 'simples_nacional', {});
        const d2 = recusado.obrigacoes.obrigacoes.find((o) => o.sigla === 'DCTFWeb');
        expect(d2.status).toBe('nao_verificada');
        expect(d2.motivo).toBeTruthy();
        // DAS e DEFIS com o SERPRO fora: não verificadas, nada de pendente.
        expect(recusado.obrigacoes.obrigacoes.filter((o) => o.status === 'pendente')).toEqual([]);
        expect(recusado.obrigacoes.resumo.pendentes).toBe(0);
    });
});

describe('resumoDasObrigacoes', () => {
    it('não verificada não conta como pendente; atrasada conta', () => {
        expect(resumoDasObrigacoes([
            { status: 'pendente' }, { status: 'atrasada' }, { status: 'nao_verificada' }, { status: 'nao_verificada' }, { status: 'entregue' },
        ])).toEqual({ total: 5, entregues: 1, pendentes: 2, naoVerificadas: 2 });
        expect(resumoDasObrigacoes(undefined)).toEqual({ total: 0, entregues: 0, pendentes: 0, naoVerificadas: 0 });
    });
});

describe('túnel do DP (empresa-completo)', () => {
    it('acrescenta statusObrigacao (+ motivo) sem tirar campo', async () => {
        const fgts = await consultarFgtsDigital(CNPJ, '2026-09');
        const comStatus = comStatusDaObrigacao(fgts);
        expect(comStatus).toEqual({ ...fgts, statusObrigacao: 'nao_verificada', motivo: SERPRO_NAO_OFERECE });

        const dctf = { ok: true, entregue: true, situacao: 'TRANSMITIDA', dataEntrega: null };
        expect(comStatusDaObrigacao(dctf)).toEqual({ ...dctf, statusObrigacao: 'entregue' });
        expect(comStatusDaObrigacao({ ok: true, entregue: false, situacao: 'SEM_RECIBO' }).statusObrigacao).toBe('pendente');
        expect(comStatusDaObrigacao({ ok: false, erro: 'timeout' })).toEqual({ ok: false, erro: 'timeout', statusObrigacao: 'nao_verificada', motivo: 'timeout' });
    });
});

describe('rota POST /empresa-completo do túnel', () => {
    it('responde os campos de antes + statusObrigacao; eSocial/FGTS não verificados, DCTFWeb entregue', async () => {
        mockRecibo.mockResolvedValue({ fonte: 'serpro', pdfBase64: 'JVBERi0=' });
        mockInvoke.mockRejectedValue(new Error('SERPRO 500'));
        let corpo;
        const res = { status() { return res; }, json(b) { corpo = b; return res; } };
        await mockRotas['/empresa-completo']({ body: { cnpj: CNPJ, competencia: '2026-09' } }, res);

        expect(corpo).toMatchObject({ cnpj: CNPJ, competencia: '2026-09' });
        expect(corpo.esocial).toEqual({ ...(await consultarESocial(CNPJ, '2026-09')), statusObrigacao: 'nao_verificada', motivo: SERPRO_NAO_OFERECE });
        expect(corpo.fgts).toEqual({ ...(await consultarFgtsDigital(CNPJ, '2026-09')), statusObrigacao: 'nao_verificada', motivo: SERPRO_NAO_OFERECE });
        expect(corpo.dctfweb).toMatchObject({ ok: true, entregue: true, situacao: 'TRANSMITIDA', statusObrigacao: 'entregue' });
        expect(corpo.crfFgts).toEqual({ status: 'negativa', fonte: 'consulta_publica', ok: true }); // certidão: sem statusObrigacao
    });
});

describe('tela (NFP Pro Cloud)', () => {
    const analiseVazia = (obrigacoes = []) => ({
        empresaId: 'emp1', empresaNome: 'EMPRESA EXEMPLO', empresaCnpj: CNPJ,
        dataAnalise: '2026-10-01T12:00:00.000Z', analisadoPor: 'Teste', fonte: 'offline',
        debitos: [], certidoes: [], obrigacoes, parcelamentos: [], acoes: [], planoAcao: [],
    });

    it('o mapeador leva não verificada + motivo, inclusive FGTS/SPED (nomes diferentes da base), e corrige o pendente falso de antes', () => {
        let n = 0;
        const { updated } = mapearRespostaSerpro({
            resp: {
                obrigacoes: {
                    ok: true,
                    obrigacoes: [
                        { nome: 'eSocial', sigla: 'eSocial', competencia: '2026-09', status: 'nao_verificada', motivo: SERPRO_NAO_OFERECE },
                        { nome: 'FGTS Digital', sigla: 'FGTS Digital', competencia: '2026-09', status: 'nao_verificada', motivo: SERPRO_NAO_OFERECE },
                        { nome: 'SPED Fiscal', sigla: 'SPED Fiscal', competencia: '2026-09', status: 'nao_verificada', motivo: 'Serviço indisponível' },
                        { nome: 'DCTFWeb', sigla: 'DCTFWeb', competencia: '2026-09', status: 'entregue' },
                        { nome: 'ECF', sigla: 'ECF', competencia: '2025', status: 'pendente' },
                    ],
                },
            },
            // Análise anterior gravada com o mapeamento antigo (eSocial "pendente" falso).
            baseAnalise: analiseVazia([{ id: 'o1', empresaId: 'emp1', nome: 'eSocial', sigla: 'eSocial', esfera: 'federal', periodicidade: 'mensal', status: 'pendente' }]),
            activeEmpresaId: 'emp1', analisadoPor: 'Teste', fonteAnalise: 'certificado_escritorio',
            certidoesBase: [], obrigacoesBase: OBRIGACOES_BASE, uid: () => `id${++n}`,
        });
        const por = Object.fromEntries(updated.obrigacoes.map((o) => [o.sigla, o]));
        expect(por.eSocial).toMatchObject({ id: 'o1', status: 'nao_verificada', motivo: SERPRO_NAO_OFERECE });
        expect(por.FGTS).toMatchObject({ status: 'nao_verificada', motivo: SERPRO_NAO_OFERECE });
        expect(por.EFD).toMatchObject({ status: 'nao_verificada', motivo: 'Serviço indisponível' });
        expect(por.DCTFWeb).toMatchObject({ status: 'entregue' });
        expect(por.DCTFWeb.motivo).toBeUndefined();
        expect(por.ECF).toMatchObject({ status: 'pendente' });

        const c = contarObrigacoes(updated.obrigacoes);
        expect(c.pendentes).toBe(1); // só a ECF
        expect(c.entregues).toBe(1);
        expect(c.naoVerificadas).toBe(updated.obrigacoes.length - 2);
    });
});
