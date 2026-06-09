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
