// @ts-nocheck
/**
 * 🔁 VARREDURA DA CARTEIRA — retenção do ISS das NFS-e nacionais (05/10).
 *
 * Paulo: "faz a varredura da carteira inteira". Fatos cobrados: a rota relê
 * o XML de TODA nota de serviço não conferida (em lotes, com cursor), corrige
 * a invertida, devolve o antes × depois com empresa e competência, pula a
 * nota excluída; e o relatório diz o que mudou no imposto e quais guias de
 * ISS já saíram para o cliente.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const XML_5725 = readFileSync(join(__dirname, 'fixtures', 'progress-retencoes', '5725.xml'), 'utf8');

const updates: any[] = [];
let docsDaColecao: any[] = [];
let envios: any[] = [];
const fazDoc = (id: string, data: any) => ({ id, data: () => data, ref: { update: async (p: any) => { updates.push({ id, p }); } } });

function consulta(nome: string) {
    const q: any = {
        _limite: Infinity, _cursor: null,
        where() { return q; }, orderBy() { return q; }, select() { return q; },
        limit(n: number) { q._limite = n; return q; },
        startAfter(c: string) { q._cursor = c; return q; },
        async get() {
            if (nome === 'impostos_enviados') return { docs: envios.map((e, i) => fazDoc(`e${i}`, e)) };
            let lista = docsDaColecao;
            if (q._cursor) lista = lista.filter((d) => d.id > q._cursor);
            return { docs: lista.slice(0, q._limite) };
        },
    };
    return q;
}

jest.mock('firebase-admin', () => {
    const firestore: any = () => ({ collection: (n: string) => consulta(n) });
    firestore.FieldPath = { documentId: () => '__name__' };
    return {
        __esModule: true,
        default: {
            apps: [{}], firestore,
            storage: () => ({ bucket: () => ({ file: () => ({ download: async () => [Buffer.from(XML_5725)] }) }) }),
        },
    };
});
jest.mock('../sefaz-backend/require-admin.js', () => ({
    requireAuth: (_q: any, _s: any, n: any) => n(),
    requireAdmin: (_q: any, _s: any, n: any) => n(),
}));
jest.mock('../sefaz-backend/carteira-auth.js', () => ({ podeAcessarEmpresaId: async () => ({ ok: true }) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const router = require('../sefaz-backend/nfse-iss-retido-routes.js').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { agruparCorrecoes, impactoDaCorrecao, ehEnvioDeIss } = require('../sefaz-backend/nfse-iss-retido-releitura.js');

async function chamar(caminho: string, body: any) {
    const layer = router.stack.find((l: any) => l.route?.path === caminho);
    expect(layer).toBeDefined();
    const req: any = { body, user: { role: 'admin', email: 'paulo@x' }, headers: {} };
    const res: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json(d: any) { this.body = d; return this; } };
    for (const h of layer.route.stack.map((s: any) => s.handle)) {
        let seguiu = false;
        await h(req, res, () => { seguiu = true; });
        if (!seguiu) break;
    }
    return res;
}

const nota = (id: string, over: any = {}) => fazDoc(id, {
    tipo: 'NFSe', storagePath: `x/${id}.xml`, empresaId: 'emp1', empresaNome: 'REALITY', empresaCnpj: '00935141000104',
    competencia: '2026-09', numero: id, direcao: 'entrada', valores: { issRetido: true }, ...over,
});

describe('/varrer — a carteira inteira', () => {
    beforeEach(() => { updates.length = 0; envios = []; });

    it('relê a nota invertida, corrige e devolve antes × depois com empresa e competência', async () => {
        docsDaColecao = [nota('a1'), nota('a2', { valores: { issRetidoRelidoEm: 'já' } }), nota('a3', { _deleted: true })];
        const r = await chamar('/varrer', {});
        expect(r.body.ok).toBe(true);
        expect(r.body.examinadas).toBe(3);
        // Só a a1: a a2 já foi conferida e a a3 está excluída (lápide).
        expect(updates.map((u) => u.id)).toEqual(['a1']);
        expect(updates[0].p['valores.issRetido']).toBe(false);
        expect(updates[0].p['valores.tpRetISSQN']).toBe('1');
        expect(r.body.corrigidas).toEqual([expect.objectContaining({
            id: 'a1', empresaNome: 'REALITY', competencia: '2026-09', direcao: 'entrada', antes: true, depois: false,
        })]);
        expect(r.body.proximoCursor).toBeNull();
    });

    it('lote cheio devolve o cursor, e a próxima chamada continua depois dele', async () => {
        docsDaColecao = Array.from({ length: 401 }, (_, i) => nota(`n${String(i).padStart(4, '0')}`, { valores: { issRetidoRelidoEm: 'já' } }));
        const r1 = await chamar('/varrer', {});
        expect(r1.body.examinadas).toBe(400);
        expect(r1.body.proximoCursor).toBe('n0399');
        const r2 = await chamar('/varrer', { cursor: r1.body.proximoCursor });
        expect(r2.body.examinadas).toBe(1);
        expect(r2.body.proximoCursor).toBeNull();
    });
});

describe('/envios-iss — as guias que já saíram', () => {
    it('só os envios de ISS contam', async () => {
        envios = [
            { tipo: 'ISS RETIDO', valor: 1290.33, enviadoEm: { toDate: () => new Date('2026-10-03T12:00:00Z') } },
            { tipo: 'DAS', valor: 500 },
        ];
        const r = await chamar('/envios-iss', { pares: [{ empresaCnpj: '00.935.141/0001-04', competencia: '2026-09' }] });
        expect(r.body.resultado).toEqual([{
            empresaCnpj: '00935141000104', competencia: '2026-09',
            envios: [{ tipo: 'ISS RETIDO', valor: 1290.33, enviadoEm: '2026-10-03T12:00:00.000Z', para: null }],
        }]);
    });
});

describe('o relatório diz o que mudou no imposto', () => {
    it('saída que era "retida" sem ser: o A RECOLHER saiu menor', () => {
        expect(impactoDaCorrecao({ direcao: 'saida', antes: true, depois: false })).toMatch(/A RECOLHER saiu MENOR/);
        expect(impactoDaCorrecao({ direcao: 'saida', antes: false, depois: true })).toMatch(/A RECOLHER saiu MAIOR/);
        expect(impactoDaCorrecao({ direcao: 'entrada', antes: true, depois: false })).toMatch(/guia do retido saiu MAIOR/);
        expect(impactoDaCorrecao({ direcao: 'entrada', antes: false, depois: true })).toMatch(/FORA da guia/);
        expect(impactoDaCorrecao({ direcao: 'saida', antes: true, depois: true })).toBeNull();
    });

    it('agrupa por empresa × competência, com as contagens', () => {
        const g = agruparCorrecoes([
            { empresaId: 'e1', empresaNome: 'A', competencia: '2026-09', numero: '1', direcao: 'entrada', antes: true, depois: false },
            { empresaId: 'e1', empresaNome: 'A', competencia: '2026-09', numero: '2', direcao: 'entrada', antes: true, depois: false },
            { empresaId: 'e1', empresaNome: 'A', competencia: '2026-09', numero: '3', direcao: 'saida', antes: true, depois: false },
            { empresaId: 'e2', empresaNome: 'B', competencia: '2026-08', numero: '9', direcao: 'saida', antes: false, depois: true },
        ]);
        expect(g.map((x: any) => [x.empresaNome, x.competencia, x.saidas, x.entradas])).toEqual([['A', '2026-09', 1, 2], ['B', '2026-08', 1, 0]]);
        expect(g[0].impactos).toHaveLength(2);
    });

    it('envio de ISS é reconhecido pelo tipo; DAS/DARF não', () => {
        expect(ehEnvioDeIss({ tipo: 'ISS' })).toBe(true);
        expect(ehEnvioDeIss({ tipo: 'ISS RETIDO' })).toBe(true);
        expect(ehEnvioDeIss({ tipo: 'DAS' })).toBe(false);
        expect(ehEnvioDeIss({ tipo: 'DARF RETIDOS' })).toBe(false);
    });
});

describe('nota cancelada: o dado é corrigido, mas não entra no relatório', () => {
    it('cancelada não aparece em corrigidas', async () => {
        updates.length = 0;
        docsDaColecao = [nota('c1', { status: 'cancelado' })];
        const r = await chamar('/varrer', {});
        expect(updates.map((u) => u.id)).toEqual(['c1']);
        expect(r.body.corrigidas).toEqual([]);
    });
});
