/**
 * diffDiasBrt: dias até o vencimento, robusto a fuso.
 * Varredura 09/07/2026: new Date('YYYY-MM-DD') é UTC → num servidor em BRT
 * o vencimento virava o dia anterior e alertava "vence hoje" adiantado.
 * Agora a string é parseada por componentes locais.
 */
jest.mock('firebase-admin', () => ({
    __esModule: true,
    default: { apps: [{}], initializeApp: jest.fn(), credential: { applicationDefault: jest.fn() }, firestore: () => ({}) },
}));
jest.mock('../sefaz-backend/graph-provider.js', () => ({ enviarEmail: jest.fn(), isGraphConfigured: () => false }));
jest.mock('../sefaz-backend/firestore-paginate.js', () => ({ fetchAllDocs: jest.fn(), commitUpdatesInChunks: jest.fn() }));

// @ts-expect-error — modulo .js puro
import { diffDiasBrt } from '../sefaz-backend/vencimentos-orchestrator.js';

describe('diffDiasBrt', () => {
    // "hoje" fixo (local): 05/06/2026
    const hoje = new Date(2026, 5, 5); hoje.setHours(0, 0, 0, 0);

    it('string YYYY-MM-DD do mesmo dia = 0 (não vira dia anterior por fuso)', () => {
        expect(diffDiasBrt('2026-06-05', hoje)).toBe(0);
    });
    it('conta dias positivos e negativos corretamente', () => {
        expect(diffDiasBrt('2026-06-10', hoje)).toBe(5);
        expect(diffDiasBrt('2026-06-01', hoje)).toBe(-4);
    });
    it('aceita Date e Timestamp-like (toDate)', () => {
        expect(diffDiasBrt(new Date(2026, 5, 7), hoje)).toBe(2);
        expect(diffDiasBrt({ toDate: () => new Date(2026, 5, 6) } as any, hoje)).toBe(1);
    });
});
