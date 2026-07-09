/**
 * Escopo de carteira (multi-tenancy) na emissão/consulta de DARF.
 * Achado da varredura 09/07/2026: darf-routes/orchestrator emitiam, listavam,
 * resumiam e marcavam pago DARFs de QUALQUER carteira (IDOR entre clientes).
 * Trava aqui a filtragem por CNPJ da carteira do colaborador.
 */

// Firestore fake: coleção com docs em memória; suporta where/limit/get e
// doc().get()/update(). fetchAllDocs é mockado para devolver todos os docs.
const DOCS = [
    { id: 'a', empresaCnpj: '11111111000111', empresaId: 'E1', valor: 100, tributo: 'IRPJ', statusPagamento: 'pendente', vencimento: '2099-01-01' },
    { id: 'b', empresaCnpj: '22222222000122', empresaId: 'E2', valor: 200, tributo: 'PIS', statusPagamento: 'pendente', vencimento: '2099-01-01' },
];
const updateSpy = jest.fn();

function makeSnapDoc(d: any) {
    return { id: d.id, data: () => d, exists: true };
}

jest.mock('firebase-admin', () => {
    const collection = () => ({
        where() { return this; },
        limit() { return this; },
        get: async () => ({ docs: DOCS.map(makeSnapDoc) }),
        doc: (id: string) => {
            const found = DOCS.find(x => x.id === id);
            return {
                get: async () => (found ? makeSnapDoc(found) : { exists: false }),
                update: async (patch: any) => { updateSpy(id, patch); return {}; },
            };
        },
    });
    return {
        __esModule: true,
        default: {
            apps: [{}],
            initializeApp: jest.fn(),
            credential: { applicationDefault: jest.fn() },
            firestore: () => ({ collection }),
        },
    };
});

jest.mock('../sefaz-backend/firestore-paginate.js', () => ({
    fetchAllDocs: async () => DOCS.map(makeSnapDoc),
    commitUpdatesInChunks: jest.fn(),
}));

// serpro-client puxa undici (não carrega no jest) — mock só p/ quebrar a cadeia.
jest.mock('../sefaz-backend/serpro-client.js', () => ({ invokeIntegraContador: jest.fn() }));

// @ts-expect-error — modulo .js puro
import { listarDarfs, getResumoDarf, marcarPago } from '../sefaz-backend/darf-orchestrator.js';

describe('DARF — escopo de carteira', () => {
    beforeEach(() => updateSpy.mockReset());
    const soEmpresa1 = new Set(['11111111000111']);

    it('listarDarfs: colaborador só vê DARFs da sua carteira', async () => {
        const r = await listarDarfs({}, soEmpresa1);
        expect(r.map((d: any) => d.id)).toEqual(['a']);
    });

    it('listarDarfs: admin (null) vê tudo', async () => {
        const r = await listarDarfs({}, null);
        expect(r.map((d: any) => d.id).sort()).toEqual(['a', 'b']);
    });

    it('getResumoDarf: agrega só a carteira (não vaza valores de outros)', async () => {
        const r = await getResumoDarf(soEmpresa1);
        expect(r.totalDarfs).toBe(1);
        expect(r.valorPendente).toBe(100); // não soma os 200 da empresa 2
    });

    it('getResumoDarf: admin agrega tudo', async () => {
        const r = await getResumoDarf(null);
        expect(r.totalDarfs).toBe(2);
    });

    it('marcarPago: bloqueia DARF fora da carteira (403), não faz update', async () => {
        await expect(marcarPago('b', '2026-07-09', soEmpresa1)).rejects.toMatchObject({ httpStatus: 403 });
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('marcarPago: permite DARF da carteira', async () => {
        const r = await marcarPago('a', '2026-07-09', soEmpresa1);
        expect(r.ok).toBe(true);
        expect(updateSpy).toHaveBeenCalledWith('a', expect.objectContaining({ statusPagamento: 'pago' }));
    });

    it('marcarPago: 404 quando o DARF não existe', async () => {
        await expect(marcarPago('inexistente', null, null)).rejects.toMatchObject({ httpStatus: 404 });
    });

    it('marcarPago: admin (null) pode marcar qualquer um', async () => {
        const r = await marcarPago('b', '2026-07-09', null);
        expect(r.ok).toBe(true);
    });
});
