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

    // ⚠️ A asserção do trecho "recinto alfandegado" SAIU em 18/08, e é uma
    // escolha, não uma perda por descuido: o catálogo passou de 2 entradas
    // digitadas à mão para as 619 da tabela oficial (Ajuste SINIEF 03/24),
    // carregando a descrição CURTA de cada código. As notas explicativas
    // inteiras somariam ~250 KB no bundle do navegador, e o que vai na tela ao
    // lado do número é o título. Quem precisa da nota tem o link da fonte.
    it('responde CFOP 5.106 com descricao especifica do catalogo local', async () => {
        const fetchMock = jest.fn(() => Promise.reject(new Error('fetch nao deveria ser chamado')));
        globalThis.fetch = fetchMock as any;

        const result = await fetchFiscalData(SearchType.CFOP, '5.106');

        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.text).toContain('CFOP 5106');
        expect(result.text).toContain('Venda de mercadoria adquirida ou recebida de terceiros, que não deva por ele transitar');
        expect(result.text).not.toContain('Descrição específica não cadastrada');
        expect(result.sources?.[0]?.web.uri).toContain('confaz.fazenda.gov.br');
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
