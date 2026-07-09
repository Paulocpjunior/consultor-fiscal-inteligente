/**
 * Escopo de carteira no resumo do dashboard DCTFWeb.
 * Varredura 09/07/2026: getResumoGlobal contava a base inteira para qualquer
 * colaborador. Agora filtra pelos CNPJs da carteira (null = admin vê tudo).
 */
const DOCS = [
    { empresaCnpj: '11111111000111', situacao: 'ATIVA' },
    { empresaCnpj: '11111111000111', situacao: 'EM_ANDAMENTO' },
    { empresaCnpj: '22222222000122', situacao: 'ATIVA' },
    { empresaCnpj: '22222222000122', situacao: 'EM_ANDAMENTO' },
];

jest.mock('firebase-admin', () => ({
    __esModule: true,
    default: {
        apps: [{}], initializeApp: jest.fn(),
        credential: { applicationDefault: jest.fn() },
        firestore: () => ({ collection: () => ({}) }),
    },
}));
jest.mock('../sefaz-backend/firestore-paginate.js', () => ({
    fetchAllDocs: async () => DOCS.map(d => ({ data: () => d })),
    commitUpdatesInChunks: jest.fn(),
}));
jest.mock('../sefaz-backend/serpro-client.js', () => ({ invokeIntegraContador: jest.fn() }));

// @ts-expect-error — modulo .js puro
import { getResumoGlobal } from '../sefaz-backend/dctfweb-orchestrator.js';

describe('getResumoGlobal — escopo de carteira', () => {
    it('colaborador vê só a própria carteira', async () => {
        const r = await getResumoGlobal(new Set(['11111111000111']));
        expect(r.totalDeclaracoes).toBe(2);
        expect(r.transmitidas).toBe(1);
        expect(r.pendentes).toBe(1);
        expect(r.empresasComPendente).toBe(1);
    });

    it('admin (null) vê a base inteira', async () => {
        const r = await getResumoGlobal(null);
        expect(r.totalDeclaracoes).toBe(4);
        expect(r.empresasComPendente).toBe(2);
    });
});
