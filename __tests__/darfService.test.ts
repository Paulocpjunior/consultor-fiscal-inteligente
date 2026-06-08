/**
 * Testes do cliente HTTP darfService.
 * Foco: montagem de URL/headers, tratamento de erro 4xx/5xx, parsing.
 */

jest.mock('firebase/auth', () => ({
    getAuth: () => ({
        currentUser: {
            getIdToken: async () => 'TOKEN_FAKE',
            email: 't@test.com',
            uid: 'uid1',
        },
    }),
}));

import {
    getResumoDarf, listarDarfs, emitirDarf, marcarDarfPago,
    listarCodigosReceita, sugerirCodigoReceita,
} from '../services/darfService';

const fetchMock = jest.fn();
global.fetch = fetchMock as any;

function okJson(body: any) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => body,
        statusText: 'OK',
    });
}
function errResp(status: number, body: any = {}) {
    return Promise.resolve({
        ok: false,
        status,
        statusText: 'ERR',
        json: async () => body,
    });
}

beforeEach(() => fetchMock.mockReset());

describe('darfService - URL e headers', () => {
    it('getResumoDarf monta GET com Bearer token', async () => {
        fetchMock.mockReturnValue(okJson({ total: 0, valorPendente: 0, valorPago: 0 }));
        await getResumoDarf(null);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/admin/darf/resumo');
        expect(opts.headers.Authorization).toBe('Bearer TOKEN_FAKE');
        expect(opts.headers['Content-Type']).toBe('application/json');
    });

    it('listarDarfs serializa filtros em querystring', async () => {
        fetchMock.mockReturnValue(okJson([]));
        await listarDarfs(null, { empresaId: 'emp1', tributo: 'IRPJ' as any, status: 'pendente' as any });
        const [url] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/admin/darf/listar?');
        expect(url).toContain('empresaId=emp1');
        expect(url).toContain('tributo=IRPJ');
        expect(url).toContain('status=pendente');
    });

    it('listarDarfs sem filtros chama com querystring vazia', async () => {
        fetchMock.mockReturnValue(okJson([]));
        await listarDarfs(null);
        const [url] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/admin/darf/listar?');
    });

    it('emitirDarf POSTa o payload como JSON', async () => {
        fetchMock.mockReturnValue(okJson({ id: 'd1', valor: 100 }));
        await emitirDarf(null, {
            empresaId: 'emp1', tributo: 'IRPJ', regime: 'LP', competencia: '04/2026', valor: 100,
        } as any);
        const [, opts] = fetchMock.mock.calls[0];
        expect(opts.method).toBe('POST');
        const body = JSON.parse(opts.body);
        expect(body.empresaId).toBe('emp1');
        expect(body.valor).toBe(100);
    });

    it('marcarDarfPago envia docId + dataPagamento', async () => {
        fetchMock.mockReturnValue(okJson({ ok: true }));
        const r = await marcarDarfPago(null, 'doc123', '2026-06-15');
        expect(r.ok).toBe(true);
        const [, opts] = fetchMock.mock.calls[0];
        expect(opts.method).toBe('POST');
        const body = JSON.parse(opts.body);
        expect(body.docId).toBe('doc123');
        expect(body.dataPagamento).toBe('2026-06-15');
    });

    it('sugerirCodigoReceita serializa regime + tributo + periodicidade', async () => {
        fetchMock.mockReturnValue(okJson({ codigo: '0220', descricao: 'IRPJ LP Mensal' }));
        await sugerirCodigoReceita(null, 'LP' as any, 'IRPJ' as any, 'mensal' as any);
        const [url] = fetchMock.mock.calls[0];
        expect(url).toContain('regime=LP');
        expect(url).toContain('tributo=IRPJ');
        expect(url).toContain('periodicidade=mensal');
    });

    it('sugerirCodigoReceita devolve null quando backend devolve objeto vazio', async () => {
        fetchMock.mockReturnValue(okJson(null));
        const r = await sugerirCodigoReceita(null, 'LP' as any, 'IRPJ' as any);
        expect(r).toBeNull();
    });
});

describe('darfService - tratamento de erro', () => {
    it('getResumoDarf lanca em 500', async () => {
        fetchMock.mockReturnValue(errResp(500));
        await expect(getResumoDarf(null)).rejects.toThrow('getResumoDarf: 500');
    });

    it('emitirDarf propaga mensagem de erro do backend', async () => {
        fetchMock.mockReturnValue(errResp(422, { error: 'Codigo de receita invalido' }));
        await expect(emitirDarf(null, {} as any)).rejects.toThrow('Codigo de receita invalido');
    });

    it('emitirDarf usa fallback de statusText quando backend nao devolve JSON', async () => {
        fetchMock.mockReturnValue({
            ok: false, status: 502, statusText: 'Bad Gateway',
            json: async () => { throw new Error('not json'); },
        });
        await expect(emitirDarf(null, {} as any)).rejects.toThrow('Bad Gateway');
    });

    it('listarCodigosReceita lanca em 404', async () => {
        fetchMock.mockReturnValue(errResp(404));
        await expect(listarCodigosReceita(null)).rejects.toThrow('listarCodigosReceita: 404');
    });
});

describe('darfService - usuario nao autenticado', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.doMock('firebase/auth', () => ({
            getAuth: () => ({ currentUser: null }),
        }));
    });

    it('lanca "Usuario nao autenticado" quando getAuth() nao tem currentUser', async () => {
        const { getResumoDarf: g2 } = await import('../services/darfService');
        await expect(g2(null)).rejects.toThrow('Usuario nao autenticado');
    });
});
