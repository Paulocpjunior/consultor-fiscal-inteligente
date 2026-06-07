/**
 * Testes do cliente HTTP dctfwebService + helpers de display.
 */
jest.mock('firebase/auth', () => ({
    getAuth: () => ({
        currentUser: {
            getIdToken: async () => 'TOK',
            email: 't@t.com', uid: 'u1',
        },
    }),
}));

import {
    getStatus, getResumo, listarDeclaracoes, sincronizarEmpresa,
    transmitirDeclaracao, gerarDarf, consultarDeclaracaoCompleta,
    formatPaLabel, situacaoLabel, situacaoColorClass,
    downloadPdfFromBase64,
} from '../services/dctfwebService';

const fetchMock = jest.fn();
global.fetch = fetchMock as any;

const okJson = (body: any) => Promise.resolve({
    ok: true, status: 200, json: async () => body, statusText: 'OK',
});
const errResp = (status: number) => Promise.resolve({
    ok: false, status, statusText: 'X',
    json: async () => ({}),
});

beforeEach(() => fetchMock.mockReset());

describe('dctfwebService - URL/headers', () => {
    it('getStatus chama BASE/status com Bearer', async () => {
        fetchMock.mockReturnValue(okJson({ mode: 'mock', ok: true }));
        const r = await getStatus(null);
        expect(r.mode).toBe('mock');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/status');
        expect(opts.headers.Authorization).toBe('Bearer TOK');
    });

    it('getResumo devolve resumo', async () => {
        fetchMock.mockReturnValue(okJson({ total: 5, pendentes: 2 }));
        const r = await getResumo(null);
        expect(r).toEqual({ total: 5, pendentes: 2 });
    });

    it('listarDeclaracoes serializa filtros em querystring', async () => {
        fetchMock.mockReturnValue(okJson([]));
        await listarDeclaracoes(null, { empresaCnpj: '11222333000181', anoPA: 2026, mesPA: 6, situacao: 'ATIVA' as any });
        const [url] = fetchMock.mock.calls[0];
        expect(url).toContain('empresaCnpj=11222333000181');
        expect(url).toContain('anoPA=2026');
        expect(url).toContain('mesPA=6');
        expect(url).toContain('situacao=ATIVA');
    });

    it('sincronizarEmpresa POSTa payload empresaId/anoPA/mesPA', async () => {
        fetchMock.mockReturnValue(okJson({ ok: true }));
        await sincronizarEmpresa(null, { empresaId: 'e1', anoPA: 2026, mesPA: 6 } as any);
        const [, opts] = fetchMock.mock.calls[0];
        expect(opts.method).toBe('POST');
        const body = JSON.parse(opts.body);
        expect(body.empresaId).toBe('e1');
        expect(body.mesPA).toBe(6);
    });

    it('transmitirDeclaracao POSTa', async () => {
        fetchMock.mockReturnValue(okJson({ ok: true, recibo: 'R1' }));
        const r = await transmitirDeclaracao(null, { docId: 'd1' } as any);
        expect(r.ok).toBe(true);
        const [, opts] = fetchMock.mock.calls[0];
        expect(opts.method).toBe('POST');
    });

    it('gerarDarf POSTa e devolve resposta', async () => {
        fetchMock.mockReturnValue(okJson({ pdfBase64: 'JVBERi0xLjQ=' }));
        const r = await gerarDarf(null, { docId: 'd1' } as any);
        expect(r.pdfBase64).toBe('JVBERi0xLjQ=');
    });

    it('consultarDeclaracaoCompleta usa GET com querystring', async () => {
        fetchMock.mockReturnValue(okJson({ decl: {} }));
        await consultarDeclaracaoCompleta(null, { empresaCnpj: '11222333000181', anoPA: 2026, mesPA: 6 } as any);
        const [url, opts] = fetchMock.mock.calls[0];
        expect(opts.method).toBeUndefined();   // GET é default
        expect(url).toContain('empresaCnpj=11222333000181');
    });
});

describe('dctfwebService - erros', () => {
    it('listarDeclaracoes lanca em 500', async () => {
        fetchMock.mockReturnValue(errResp(500));
        await expect(listarDeclaracoes(null)).rejects.toThrow('listarDeclaracoes: 500');
    });

    it('getStatus lanca em 503', async () => {
        fetchMock.mockReturnValue(errResp(503));
        await expect(getStatus(null)).rejects.toThrow('getStatus: 503');
    });
});

describe('dctfwebService - helpers de display', () => {
    describe('formatPaLabel', () => {
        it('formata 1 -> 01', () => expect(formatPaLabel(2026, 1)).toBe('01/2026'));
        it('formata 12 -> 12', () => expect(formatPaLabel(2026, 12)).toBe('12/2026'));
    });

    describe('situacaoLabel', () => {
        it('EM_ANDAMENTO -> Em andamento', () => expect(situacaoLabel('EM_ANDAMENTO')).toBe('Em andamento'));
        it('ATIVA -> Transmitida', () => expect(situacaoLabel('ATIVA')).toBe('Transmitida'));
        it('ENCERRADA -> Encerrada', () => expect(situacaoLabel('ENCERRADA')).toBe('Encerrada'));
        it('valor desconhecido devolve original', () => expect(situacaoLabel('XYZ')).toBe('XYZ'));
    });

    describe('situacaoColorClass', () => {
        it('classes Tailwind por status', () => {
            expect(situacaoColorClass('EM_ANDAMENTO')).toContain('amber');
            expect(situacaoColorClass('ATIVA')).toContain('emerald');
        });
    });

    describe('downloadPdfFromBase64', () => {
        it('cria <a> e dispara click (jsdom)', () => {
            const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
            downloadPdfFromBase64('JVBERi0=', 'teste.pdf');
            expect(click).toHaveBeenCalledTimes(1);
            click.mockRestore();
        });

        it('NAO QUEBRA com base64 vazio (no-op silencioso)', () => {
            const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
            downloadPdfFromBase64('', 'x.pdf');
            expect(click).not.toHaveBeenCalled();
            click.mockRestore();
        });
    });
});
