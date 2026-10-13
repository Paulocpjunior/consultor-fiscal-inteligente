/**
 * @jest-environment node
 */
/**
 * Consultas de situação que o Consultor DP usa pelo túnel e o selo do eSocial
 * no semáforo da DCTFWeb (Paulo, 13/10/2026: "pode corrigir com a resposta
 * real" e "pode seguir com o S-1299 no semáforo"). Medido em produção:
 * ESOCIAL/CONSULTARFECHAMENTO, FGTS/CONSULTARRECOLHIMENTO e FGTS/CONSULTARCRF
 * não existem no Integra Contador (ICGERENCIADOR-052) e o CONSDECCOMPLETA33 com
 * { periodoApuracao } é recusado (DCTFWEB-MG07). O que trava aqui:
 *   1. DCTFWeb pelo RECIBO (CONSRECIBO32, GERAL_MENSAL, anoPA/mesPA): PDF =
 *      transmitida; 200 sem PDF = sem recibo; erro = ok:false com os códigos,
 *      sem CNPJ na mensagem;
 *   2. eSocial e FGTS não chamam o SERPRO (o mock falha se for chamado);
 *   3. CRF direto na consulta pública da Caixa;
 *   4. selo do eSocial = S-1299 aceito com recibo que o DP registrou, lido no
 *      Firestore do DP com o token do usuário; S-1298 depois derruba; outro
 *      CNPJ/período/ambiente não conta; corpo forjado não liga o selo.
 * Nenhum dado real: CNPJ 11.222.333/0001-81, e-mails @exemplo.com.br.
 */
// @ts-nocheck — módulos .js do backend

jest.mock('express', () => {
    const rota = () => ({ get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} });
    return { __esModule: true, default: Object.assign(() => rota(), { Router: rota, json: () => () => {} }) };
});
jest.mock('firebase-admin', () => ({
    __esModule: true,
    default: {
        apps: [{}],
        initializeApp: () => {},
        credential: { applicationDefault: () => ({}) },
        firestore: Object.assign(() => ({}), { FieldValue: { serverTimestamp: () => 'agora' } }),
    },
}));

const mockInvoke = jest.fn(async (req) => {
    throw new Error(`SERPRO não devia ser chamado: ${req.idSistema}/${req.idServico}`);
});
jest.mock('../sefaz-backend/serpro-client.js', () => ({
    invokeIntegraContador: (req) => mockInvoke(req),
    getSerproConfig: () => ({}),
}));

const mockMit = jest.fn();
const mockTransmitir = jest.fn();
jest.mock('../sefaz-backend/dctfweb-orchestrator.js', () => ({
    consultarApuracaoMit: (...a) => mockMit(...a),
    transmitirDeclaracao: (...a) => mockTransmitir(...a),
    listarDebitosDeclaracao: async () => ({ lido: false }),
}));

import {
    consultarDctfWeb, consultarESocial, consultarFgtsDigital, consultarCrfFgtsSerpro, SERPRO_NAO_OFERECE,
} from '../sefaz-backend/nfp-compliance-provider.js';
import { avaliarFechamentoEsocial, valorFirestore } from '../sefaz-backend/dp-fechamento-esocial.js';
import { montarSemaforoInsumos, transmitirComRegras } from '../sefaz-backend/dctfweb-routes.js';

const CNPJ = '11222333000181';
const CNPJ_FORMATADO = '11.222.333/0001-81';
const OUTRO_CNPJ = '11444777000161';
const PDF = Buffer.from('%PDF-1.4 recibo de teste').toString('base64');

// ─── Firestore REST do DP (runQuery) e Firestore do CFI em memória ─────────────
function paraFirestore(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(paraFirestore) } };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, paraFirestore(x)])) } };
    return { stringValue: String(v) };
}
function fetchDpCom(envios) {
    const chamadas = [];
    const fn = async (url, init) => {
        chamadas.push({ url, init });
        const pedido = JSON.parse(init.body);
        const empresaId = pedido.structuredQuery.where.fieldFilter.value.stringValue;
        const linhas = envios.filter((e) => e.empresaId === empresaId)
            .map((e, i) => ({ document: { name: `x/esocial_envios/e${i}`, fields: paraFirestore(e).mapValue.fields }, readTime: '2026-10-13T12:00:00Z' }));
        return { status: 200, ok: true, json: async () => (linhas.length ? linhas : [{ readTime: '2026-10-13T12:00:00Z' }]) };
    };
    fn.chamadas = chamadas;
    return fn;
}
function firestoreFalso({ lotes = [] } = {}) {
    const adicionados = [];
    const consulta = (nome) => {
        const q = {
            where: () => q,
            limit: () => q,
            startAfter: () => ({ get: async () => ({ docs: [], size: 0, empty: true }) }),
            get: async () => {
                const docs = (nome === 'reinf_gateway_lotes' ? lotes : []).map((d, i) => ({ id: `l${i}`, data: () => d }));
                return { docs, size: docs.length, empty: docs.length === 0 };
            },
        };
        return q;
    };
    return {
        adicionados,
        collection: (nome) => ({
            ...consulta(nome),
            doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
            add: async (d) => { adicionados.push({ nome, d }); return { id: 'a1' }; },
        }),
    };
}

const s1299 = (extra = {}, ev = {}) => ({
    empresaId: 'emp-carteira', cnpj: CNPJ_FORMATADO, tpAmb: 1, situacao: 'processado', enviadoEm: new Date('2026-10-05T13:00:00Z'),
    eventos: [{ id: 'ID1112223330000002026100513000000001', tipo: 'S-1299', perApur: '2026-09', cdResposta: 201, nrRecibo: '1.1.0000000000000000001', ...ev }],
    ...extra,
});
const s1298 = (extra = {}, ev = {}) => ({
    empresaId: 'emp-carteira', cnpj: CNPJ_FORMATADO, tpAmb: 1, situacao: 'processado', enviadoEm: new Date('2026-10-08T13:00:00Z'),
    eventos: [{ id: 'ID1112223330000002026100813000000002', tipo: 'S-1298', perApur: '2026-09', cdResposta: 201, nrRecibo: '1.1.0000000000000000002', ...ev }],
    ...extra,
});
const MIT_ENCERRADO = { apuracaoMit: { x: 1 }, apuracaoResumo: { situacao: 3, descricaoSituacao: 'Encerrada' } };
const REINF_OK = [{ declarante: CNPJ, competencias: ['2026-09'], httpStatus: 201, protocolo: '2.2026.77', por: 'contabil.teste@exemplo.com.br' }];
const USUARIO_DP = { uid: 'u1', email: 'dp.teste@exemplo.com.br', role: 'colaborador', departamentos: ['dp-folha'] };

beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (req) => { throw new Error(`SERPRO não devia ser chamado: ${req.idSistema}/${req.idServico}`); });
    mockMit.mockReset();
    mockMit.mockResolvedValue(MIT_ENCERRADO);
    mockTransmitir.mockReset();
    mockTransmitir.mockResolvedValue({ numeroRecibo: '2026.09.00001', situacao: 'ATIVA', fonte: 'serpro' });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('DCTFWeb do DP pelo recibo (CONSRECIBO32)', () => {
    it('recibo com PDF = transmitida; o pedido é o recibo GERAL_MENSAL com anoPA e mesPA', async () => {
        mockInvoke.mockImplementation(async () => ({ status: 200, dados: { PDFByteArrayBase64: PDF }, mensagens: [] }));
        expect(await consultarDctfWeb(CNPJ, '2026-09')).toEqual({ ok: true, entregue: true, situacao: 'TRANSMITIDA', dataEntrega: null });
        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect(mockInvoke.mock.calls[0][0]).toMatchObject({
            idSistema: 'DCTFWEB', idServico: 'CONSRECIBO32', acao: 'Consultar', contribuinteCnpj: CNPJ,
            dados: { categoria: 'GERAL_MENSAL', anoPA: '2026', mesPA: '09' },
        });
    });

    it('200 sem PDF = sem recibo (não transmitida), nunca "transmitida"', async () => {
        mockInvoke.mockImplementation(async () => ({ status: 200, dados: [{}], mensagens: [] }));
        expect(await consultarDctfWeb(CNPJ, '2026-09')).toEqual({ ok: true, entregue: false, situacao: 'SEM_RECIBO', dataEntrega: null });
    });

    it('erro de negócio = ok:false com os códigos e sem o CNPJ na mensagem', async () => {
        mockInvoke.mockImplementation(async () => {
            const e = new Error(`SERPRO 400: [EntradaIncorreta-DCTFWEB-MG07] - Ano PA é obrigatório (${CNPJ_FORMATADO})`);
            e.serproMessages = [
                { codigo: '[EntradaIncorreta-DCTFWEB-MG07]', texto: `Ano PA é obrigatório para ${CNPJ_FORMATADO}` },
                { codigo: '[Aviso-DCTFWEB-MG02]', texto: `Encaminhamento não autorizado ${CNPJ}` },
            ];
            throw e;
        });
        const r = await consultarDctfWeb(CNPJ, '2026-09');
        expect(r).toMatchObject({ ok: false, entregue: false, situacao: 'indisponivel', codigos: ['EntradaIncorreta-DCTFWEB-MG07', 'Aviso-DCTFWEB-MG02'] });
        expect(r.erro).toMatch(/\[EntradaIncorreta-DCTFWEB-MG07\] Ano PA é obrigatório/);
        expect(r.erro).not.toContain(CNPJ);
        expect(r.erro).not.toContain(CNPJ_FORMATADO);
    });

    it('200 sem PDF mas com erro de negócio na mensagem = ok:false (não vira "sem recibo")', async () => {
        mockInvoke.mockImplementation(async () => ({ status: 200, dados: {}, mensagens: [{ codigo: '[EntradaIncorreta-DCTFWEB-MG07]', texto: 'Categoria é obrigatória' }] }));
        const r = await consultarDctfWeb(CNPJ, '2026-09');
        expect(r.ok).toBe(false);
        expect(r.codigos).toEqual(['EntradaIncorreta-DCTFWEB-MG07']);
    });
});

describe('eSocial, FGTS e CRF: nada de serviço inexistente no SERPRO', () => {
    it('eSocial responde "não oferecido" sem chamar o SERPRO', async () => {
        expect(await consultarESocial(CNPJ, '2026-09')).toEqual({ ok: false, entregue: false, situacao: 'nao_oferecido_serpro', dataEntrega: null, erro: SERPRO_NAO_OFERECE });
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('FGTS mantém os campos numéricos, mas ok:false e regular:false (zero não é "regular")', async () => {
        const r = await consultarFgtsDigital(CNPJ, '2026-09');
        expect(r).toEqual({ ok: false, regular: false, depositoDevido: 0, depositoRealizado: 0, situacao: 'nao_oferecido_serpro', erro: SERPRO_NAO_OFERECE });
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('CRF vai direto à consulta pública da Caixa, com o link do portal', async () => {
        const urls = [];
        jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
            urls.push(String(url));
            return { ok: true, status: 200, text: async () => '<html>Empregador REGULAR perante o FGTS. Válido até 30/11/2026</html>' };
        });
        const r = await consultarCrfFgtsSerpro(CNPJ);
        expect(r).toMatchObject({ ok: true, status: 'negativa', validade: '2026-11-30', fonte: 'consulta_publica', tipo: 'CRF (FGTS)' });
        expect(r.portalUrl).toMatch(/consulta-crf\.caixa\.gov\.br/);
        expect(urls).toHaveLength(1);
        expect(urls[0]).toMatch(/consulta-crf\.caixa\.gov\.br/);
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('CRF com a Caixa fora: indisponível com o motivo, ok:false', async () => {
        jest.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: false, status: 503, text: async () => '' }));
        expect(await consultarCrfFgtsSerpro(CNPJ)).toMatchObject({ ok: false, status: 'indisponivel', motivo: 'HTTP 503' });
        expect(mockInvoke).not.toHaveBeenCalled();
    });
});

describe('fechamento do eSocial pelo que o DP registrou (núcleo puro)', () => {
    const json = (envios) => envios.map((e) => valorFirestore(paraFirestore(e)));
    const avaliar = (envios, cnpj = CNPJ) => avaliarFechamentoEsocial(json(envios), { cnpj, competencia: '2026-09' });

    it('S-1299 aceito com recibo = entregue', () => {
        expect(avaliar([s1299()])).toEqual({ ok: true, entregue: true, situacao: 'S1299_ACEITO', dataEntrega: '2026-10-05', nrRecibo: '1.1.0000000000000000001' });
    });
    it('sem registro = não entregue, com o motivo', () => {
        expect(avaliar([])).toMatchObject({ ok: true, entregue: false, situacao: 'SEM_S1299', motivo: 'Fechamento do eSocial (S-1299) não encontrado no DP para 09/2026.' });
    });
    it('S-1298 depois do S-1299 derruba; S-1299 de novo depois religa', () => {
        expect(avaliar([s1299(), s1298()])).toMatchObject({ entregue: false, situacao: 'REABERTO_S1298' });
        const refechou = s1299({ enviadoEm: new Date('2026-10-09T13:00:00Z') }, { nrRecibo: '1.1.0000000000000000003' });
        expect(avaliar([s1299(), s1298(), refechou])).toMatchObject({ entregue: true, nrRecibo: '1.1.0000000000000000003' });
        // S-1298 recusado não reabre; S-1298 ANTES do S-1299 também não.
        expect(avaliar([s1299(), s1298({}, { cdResposta: 401, nrRecibo: '' })]).entregue).toBe(true);
        expect(avaliar([s1298({ enviadoEm: new Date('2026-10-01T13:00:00Z') }), s1299()]).entregue).toBe(true);
    });
    it('outro CNPJ, outro período, produção restrita, sem recibo ou lote não processado: não conta', () => {
        expect(avaliar([s1299({ cnpj: OUTRO_CNPJ })]).entregue).toBe(false);
        expect(avaliar([s1299({}, { perApur: '2026-08' })]).entregue).toBe(false);
        expect(avaliar([s1299({ tpAmb: 2 })]).entregue).toBe(false);
        expect(avaliar([s1299({}, { nrRecibo: '' })]).entregue).toBe(false);
        expect(avaliar([s1299({}, { cdResposta: 401 })]).entregue).toBe(false);
        expect(avaliar([s1299({ situacao: 'em-processamento' }, { cdResposta: null, nrRecibo: null })])).toMatchObject({ entregue: false, situacao: 'S1299_SEM_RESULTADO' });
        // Filial da mesma raiz (o empregador do eSocial é a raiz): conta.
        expect(avaliar([s1299({ cnpj: '11.222.333/0002-62' })]).entregue).toBe(true);
    });
});

describe('selo do eSocial no semáforo da DCTFWeb', () => {
    const DP = (envios) => ({ token: 'token-do-usuario-dp', empresaId: 'emp-carteira', fetchImpl: fetchDpCom(envios) });
    const selo = (r) => r.selos.find((s) => s.departamento === 'dp-folha');

    it('verde com S-1299 aceito; lido no Firestore do DP com o token do usuário, sem SERPRO para o eSocial', async () => {
        const dp = DP([s1299()]);
        const r = await montarSemaforoInsumos(firestoreFalso({ lotes: REINF_OK }), { cnpj: CNPJ, competencia: '2026-09', empresaId: null, dp });
        expect(selo(r)).toMatchObject({ estado: 'recebido' });
        expect(selo(r).detalhe).toMatch(/recibo 1\.1\.0000000000000000001/);
        expect(r.veredito).toBe('pronto');
        expect(dp.fetchImpl.chamadas).toHaveLength(1);
        const { url, init } = dp.fetchImpl.chamadas[0];
        expect(url).toBe('https://firestore.googleapis.com/v1/projects/consultor-dp-folha/databases/(default)/documents:runQuery');
        expect(init.headers.Authorization).toBe('Bearer token-do-usuario-dp');
        expect(JSON.parse(init.body).structuredQuery.from).toEqual([{ collectionId: 'esocial_envios' }]);
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('pendente sem registro (com o motivo), com S-1298 depois e para outro CNPJ/período', async () => {
        const casos = [
            [[], /Fechamento do eSocial \(S-1299\) não encontrado no DP para 09\/2026/],
            [[s1299(), s1298()], /reaberta por S-1298/],
            [[s1299({ cnpj: OUTRO_CNPJ })], /não encontrado no DP para 09\/2026/],
            [[s1299({}, { perApur: '2026-08' })], /não encontrado no DP para 09\/2026/],
        ];
        for (const [envios, motivo] of casos) {
            const r = await montarSemaforoInsumos(firestoreFalso({ lotes: REINF_OK }), { cnpj: CNPJ, competencia: '2026-09', empresaId: null, dp: DP(envios) });
            expect(selo(r).estado).toBe('pendente');
            expect(selo(r).detalhe).toMatch(motivo);
            expect(r.veredito).toBe('incompleto');
        }
    });

    it('leitura do DP que falha = indeterminado (não afirma); tela do CFI sem token = indeterminado, sem ler o DP', async () => {
        const negado = Object.assign(async () => ({ status: 403, ok: false, json: async () => ({}) }), {});
        const r = await montarSemaforoInsumos(firestoreFalso(), { cnpj: CNPJ, competencia: '2026-09', empresaId: null, dp: { token: 't', empresaId: 'emp-carteira', fetchImpl: negado } });
        expect(selo(r).estado).toBe('indeterminado');
        expect(selo(r).detalhe).toMatch(/HTTP 403/);
        const cfi = await montarSemaforoInsumos(firestoreFalso(), { cnpj: CNPJ, competencia: '2026-09', empresaId: null });
        expect(selo(cfi).estado).toBe('indeterminado');
        expect(selo(cfi).detalhe).toMatch(/login do DP/);
    });

    it('corpo forjado não liga o selo: o DP sem S-1299 no registro é recusado (T1-DP), sem transmitir', async () => {
        const db = firestoreFalso({ lotes: REINF_OK });
        const r = await transmitirComRegras({
            user: USUARIO_DP, db, origem: 'dp', dp: DP([]),
            body: {
                empresaCnpj: CNPJ, anoPA: 2026, mesPA: 9, categoria: 'GERAL_MENSAL',
                // Tudo isto vem do corpo e NÃO pode virar prova:
                selos: [{ departamento: 'dp-folha', estado: 'recebido' }], veredito: 'pronto',
                esocial: { ok: true, entregue: true }, fechamentoEsocial: { entregue: true, nrRecibo: '9' },
                dp: { token: 'forjado', empresaId: 'emp-carteira', fetchImpl: fetchDpCom([s1299()]) },
            },
        });
        expect(r.status).toBe(403);
        expect(r.json.veredito).toBe('incompleto');
        expect(r.json.error).toMatch(/eSocial \(pendente\)/);
        expect(mockTransmitir).not.toHaveBeenCalled();
    });

    it('com o S-1299 aceito no registro do DP, o DP transmite (T1-DP com os três insumos)', async () => {
        const db = firestoreFalso({ lotes: REINF_OK });
        const r = await transmitirComRegras({
            user: USUARIO_DP, db, origem: 'dp', dp: DP([s1299()]),
            body: { empresaCnpj: CNPJ, anoPA: 2026, mesPA: 9, categoria: 'GERAL_MENSAL' },
        });
        expect(r.status).toBe(200);
        expect(mockTransmitir).toHaveBeenCalledTimes(1);
        expect(db.adicionados.find((x) => x.nome === 'dctfweb_transmissoes').d).toMatchObject({ origem: 'dp', vereditoInsumos: 'pronto', pendentes: [] });
    });
});
