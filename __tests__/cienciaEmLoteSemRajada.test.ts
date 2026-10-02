/**
 * 🚨 CIÊNCIA EM LOTE NÃO PODE REBAIXAR NA HORA (02/10).
 *
 * O "📨 Manifestar ciência de todas" do Guia do Mês (#1345) chamava a rota
 * `/manifest-one` chave a chave, e cada ciência aceita disparava o consChNFe
 * no NFeDistribuicaoDFe. Rajada = cStat 656 (Consumo Indevido) na raiz por
 * ~1h — e em 01/10 a captura NF-e das 18h e o cron da ciência das 20h15
 * terminaram em FALHA (e-mail "2 cron(s) com problema"). É a MESMA classe do
 * caso VINATEX que o `skipRedownload` do cron já fechava.
 *
 * Fatos cobrados: a rota repassa o lote ao orquestrador como skipRedownload;
 * a chamada avulsa continua rebaixando; e quem chama a ciência DENTRO DE UM
 * LAÇO na tela declara o lote.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const manifestarUmaMock = jest.fn(async () => ({ desfecho: { registraEvento: true, situacao: 'aceita' } }));

jest.mock('firebase-admin', () => ({
    __esModule: true,
    default: { apps: [{}], initializeApp: jest.fn(), credential: { applicationDefault: jest.fn() }, firestore: () => ({}) },
}));
jest.mock('../sefaz-backend/manifesto-orchestrator.js', () => ({
    manifestarUma: (...a: any[]) => (manifestarUmaMock as any)(...a),
    manifestarPendentes: jest.fn(), listarElegiveis: jest.fn(),
    resetarFalhasInfraManifestacao: jest.fn(), diagnosticarPendencias: jest.fn(), liberarPoisonManifestacao: jest.fn(),
}));
jest.mock('../sefaz-backend/require-admin.js', () => ({
    requireAuth: (_req: any, _res: any, next: any) => next(),
    requireAdmin: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../sefaz-backend/carteira-auth.js', () => ({
    getEmpresaIdsDaCarteira: jest.fn(), podeAcessarEmpresaId: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../sefaz-backend/cron-secret.js', () => ({ secretsMatch: jest.fn() }));
jest.mock('../sefaz-backend/cron-heartbeat.js', () => ({ withCronHeartbeat: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const router = require('../sefaz-backend/manifesto-routes.js').default;

async function chamarManifestOne(body: any) {
    const layer = router.stack.find((l: any) => l.route?.path === '/manifest-one');
    expect(layer).toBeDefined();
    const req: any = { body, user: { role: 'admin', email: 'a@b' }, headers: {} };
    const res: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json(d: any) { this.body = d; return this; } };
    for (const h of layer.route.stack.map((s: any) => s.handle)) {
        let seguiu = false;
        await h(req, res, () => { seguiu = true; });
        if (!seguiu) break;
    }
    return res;
}

const CHAVE = '35260603442526000110550010001581987000000001';

describe('/manifest-one — lote não rebaixa na hora', () => {
    beforeEach(() => manifestarUmaMock.mockClear());

    it('com emLote: o orquestrador recebe skipRedownload = true', async () => {
        await chamarManifestOne({ chNFe: CHAVE, cnpjDestinatario: '32602701000197', tipo: 'ciencia', emLote: true });
        expect(manifestarUmaMock).toHaveBeenCalledTimes(1);
        expect((manifestarUmaMock.mock.calls[0] as any)[0].skipRedownload).toBe(true);
    });

    it('chamada avulsa (um clique, uma nota) continua rebaixando a completa na hora', async () => {
        await chamarManifestOne({ chNFe: CHAVE, cnpjDestinatario: '32602701000197', tipo: 'ciencia' });
        expect((manifestarUmaMock.mock.calls[0] as any)[0].skipRedownload).toBe(false);
    });
});

describe('varredura: ciência chamada dentro de um laço declara o lote', () => {
    const RAIZ = join(__dirname, '..', 'components');
    const arquivos: string[] = [];
    const andar = (d: string) => {
        for (const n of readdirSync(d)) {
            const p = join(d, n);
            if (statSync(p).isDirectory()) andar(p);
            else if (/\.tsx?$/.test(n)) arquivos.push(p);
        }
    };
    andar(RAIZ);

    /** Corpo dos laços (for/while/forEach/map) que chamam manifestarUmaChave. */
    const chamadasEmLaco = (src: string) => {
        const achadas: string[] = [];
        const re = /(for\s*\(|while\s*\(|\.forEach\(|\.map\()/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
            // Corpo do laço: do início até o fechamento da chave correspondente.
            const ini = src.indexOf('{', m.index);
            if (ini < 0) continue;
            let prof = 0; let fim = ini;
            for (let i = ini; i < src.length; i++) {
                if (src[i] === '{') prof++;
                else if (src[i] === '}') { prof--; if (prof === 0) { fim = i; break; } }
            }
            const corpo = src.slice(ini, fim);
            const chamadas = corpo.match(/manifestarUmaChave\(\{[^}]*\}/g) || [];
            achadas.push(...chamadas);
        }
        return achadas;
    };

    it('o Guia do Mês está entre os que chamam em laço (senão a varredura não mede nada)', () => {
        const guia = arquivos.find((p) => p.endsWith(join('Carteira', 'GuiaDoMes.tsx')))!;
        expect(chamadasEmLaco(readFileSync(guia, 'utf8')).length).toBeGreaterThan(0);
    });

    it('toda chamada em laço passa emLote: true', () => {
        for (const p of arquivos) {
            for (const c of chamadasEmLaco(readFileSync(p, 'utf8'))) {
                expect({ arquivo: p.slice(RAIZ.length + 1), declaraLote: /emLote:\s*true/.test(c) })
                    .toEqual({ arquivo: p.slice(RAIZ.length + 1), declaraLote: true });
            }
        }
    });
});
