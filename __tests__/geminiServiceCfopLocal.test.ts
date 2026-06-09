import { SearchType } from '../types';
import { fetchFiscalData } from '../services/geminiService';

jest.mock('../services/firebaseConfig', () => ({
    auth: { currentUser: { getIdToken: jest.fn() } },
}));

describe('fetchFiscalData — CFOP local', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('responde CFOP numerico sem chamar backend/IA', async () => {
        const fetchMock = jest.fn(() => Promise.reject(new Error('fetch nao deveria ser chamado')));
        globalThis.fetch = fetchMock as any;

        const result = await fetchFiscalData(SearchType.CFOP, '1924');

        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.text).toContain('CFOP 1924');
        expect(result.text).toContain('industrialização por conta e ordem');
        expect(result.text).toContain('Remessa / retorno');
    });
});

describe('fetchFiscalData — Serviço/ISS local', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('responde item LC 116 4.01 sem chamar backend/IA', async () => {
        const fetchMock = jest.fn(() => Promise.reject(new Error('fetch nao deveria ser chamado')));
        globalThis.fetch = fetchMock as any;

        const result = await fetchFiscalData(SearchType.SERVICO, '4.01', 'São Paulo', 'Empresa X', undefined, undefined, undefined, undefined, undefined, undefined, '2');

        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.query).toBe('4.01');
        expect(result.text).toContain('Serviço LC 116/ISS 4.01');
        expect(result.text).toContain('Medicina e biomedicina');
        expect(result.text).toContain('2% informada no contexto');
        expect(result.text).toContain('Município/prestação informado: São Paulo');
        expect(result.sources?.[0]?.web.uri).toContain('planalto.gov.br');
    });

    it('normaliza codigo de servico sem ponto antes da resposta local', async () => {
        const fetchMock = jest.fn(() => Promise.reject(new Error('fetch nao deveria ser chamado')));
        globalThis.fetch = fetchMock as any;

        const result = await fetchFiscalData(SearchType.SERVICO, '401');

        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.query).toBe('4.01');
        expect(result.text).toContain('Medicina e biomedicina');
    });
});
