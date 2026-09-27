// ============================================================================
// __tests__/sharepointListarPastasPaginacao.test.ts — a listagem de pastas do
// SharePoint lê TODAS as páginas do Graph.
//
// 22/09/2026, Paulo, card Conexão SharePoint: "Conectado, mas a última rodada
// teve erros — 264 empresa(s) cuja pasta não foi encontrado no SharePoint —
// EDMILSON VERCOSA FELIX PNEUS: Nenhuma pasta com o código 0807 em Empresas".
// A credencial estava certa (medida no mesmo dia). O proxy pedia `$top=200` e
// lia SÓ a primeira página: com ~430 subpastas em `Empresas`, as pastas depois
// da 200ª não existiam para o app, e ele mandava criar no SharePoint pastas
// que estão lá — a ação mais cara (duplicaria a pasta do cliente).
// ============================================================================
import { listarPastas } from '../proxy-backend/sharepoint-sync.js';

const resposta = (body: unknown, ok = true, status = 200) => ({
    ok, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
});

describe('🚨 listarPastas segue o @odata.nextLink até o fim', () => {
    const fetchOriginal = global.fetch;
    afterEach(() => { global.fetch = fetchOriginal; });

    it('duas páginas de 200 viram 400 pastas — e o resultado diz quantas páginas leu', async () => {
        const pagina = (ini: number, fim: number, next?: string) => ({
            value: Array.from({ length: fim - ini }, (_, i) => ({
                id: `f${ini + i}`, name: `${String(ini + i).padStart(4, '0')} - EMPRESA ${ini + i}`, folder: { childCount: 3 },
            })),
            ...(next ? { '@odata.nextLink': next } : {}),
        });
        const chamadas: string[] = [];
        global.fetch = (async (url: string) => {
            chamadas.push(String(url));
            if (/\/sites\/[^/]+:\/sites/.test(String(url))) return resposta({ id: 'site-1' });
            if (String(url).includes('skiptoken=p2')) return resposta(pagina(200, 400));
            return resposta(pagina(0, 200, 'https://graph.microsoft.com/v1.0/next?skiptoken=p2'));
        }) as any;

        const r = await listarPastas('tok', 'Empresas');
        expect(r.pastas).toHaveLength(400);
        expect(r.paginas).toBe(2);
        // A pasta 0807 (depois da 200ª) EXISTE para o app.
        expect(r.pastas.some((p: any) => p.nome.startsWith('0807'))).toBe(false); // 0807 > 0399: fora deste fixture
        expect(r.pastas.some((p: any) => p.nome.startsWith('0399'))).toBe(true);
        // Site resolvido uma vez, duas páginas de dados.
        expect(chamadas.filter((u) => u.includes('/children') || u.includes('skiptoken')).length).toBe(2);
    });

    it('uma página só continua funcionando (sem nextLink)', async () => {
        global.fetch = (async (url: string) => {
            if (/\/sites\/[^/]+:\/sites/.test(String(url))) return resposta({ id: 'site-1' });
            return resposta({ value: [{ id: 'a', name: '0001 - X', folder: { childCount: 0 } }, { id: 'b', name: 'nota.xml', file: {} }] });
        }) as any;
        const r = await listarPastas('tok', 'Empresas');
        expect(r.pastas.map((p: any) => p.nome)).toEqual(['0001 - X']);
        expect(r.arquivos).toBe(1);
        expect(r.paginas).toBe(1);
    });

    it('erro numa página do meio NÃO vira lista parcial em silêncio', async () => {
        let n = 0;
        global.fetch = (async (url: string) => {
            if (/\/sites\/[^/]+:\/sites/.test(String(url))) return resposta({ id: 'site-1' });
            n++;
            if (n === 1) return resposta({ value: [{ id: 'a', name: '0001 - X', folder: {} }], '@odata.nextLink': 'https://g/next?skiptoken=p2' });
            return resposta({ error: 'throttled' }, false, 429);
        }) as any;
        await expect(listarPastas('tok', 'Empresas')).rejects.toThrow(/Failed to list folder \(429\)/);
    });
});
