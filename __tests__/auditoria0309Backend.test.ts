/**
 * 🔒 Auditoria de 03/09 — travas das correções do BACKEND (rotas e servidor).
 *
 * São varreduras de FONTE: o server.js e os routers puxam express/firebase e
 * não carregam no jest, então o que se prova aqui é que cada correção continua
 * escrita onde ela vale. Cada bloco nomeia o defeito que ela fecha.
 */
import * as fs from 'fs';
import * as path from 'path';

const RAIZ = path.join(__dirname, '..');
const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const semComentario = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const BACKEND = path.join(RAIZ, 'sefaz-backend');
const routers = () => fs.readdirSync(BACKEND).filter((n) => n.endsWith('-routes.js'));

describe('rotas /status e /nbs não ficam sem guarda', () => {
    it('todo `router.get(\'/status\'` do backend carrega um middleware antes do handler', () => {
        const acusados: string[] = [];
        for (const f of routers()) {
            const src = semComentario(ler(path.join('sefaz-backend', f)));
            for (const m of src.matchAll(/router\.get\('\/status',\s*([^)]*?)=>/g)) {
                const entre = m[1];
                // guarda = um identificador antes de `(req` / `(_req` / `async (`
                if (!/\b(requireAuth|requireAdmin|requireEmissao|requireBridgeToken|autorizar\w*|requireCrossProjectAuth|requireCronAuth)\b/.test(entre)) {
                    acusados.push(`${f}: GET /status sem guarda`);
                }
            }
        }
        expect(acusados).toEqual([]);
    });
    it('a tabela NBS (2000 leituras por chamada) exige login', () => {
        expect(semComentario(ler('sefaz-backend/nfse-nacional-routes.js'))).toMatch(/router\.get\('\/nbs',\s*requireAuth,/);
    });
});

describe('segredo do bridge do plano de contas', () => {
    it('é comparado em tempo constante e o /status também exige o token', () => {
        const src = semComentario(ler('sefaz-backend/plano-contas-bridge-routes.js'));
        expect(src).toMatch(/secretsMatch\(tokenDaRequisicao\(req\), BRIDGE_TOKEN\)/);
        expect(src).not.toMatch(/tokenDaRequisicao\(req\) !== BRIDGE_TOKEN/);
        expect(src).toMatch(/router\.get\('\/status',\s*requireBridgeToken,/);
    });
});

describe('server.js', () => {
    const src = semComentario(ler('server.js'));
    it('o /ready público passa a falha pelo sanitizador (a mensagem crua do firebase-admin carrega caminho de secret)', () => {
        expect(src).toMatch(/out\.motivo = sanitizeError\(e\)\.error;/);
        expect(src).not.toMatch(/out\.motivo = String\(e && e\.message \|\| e\)/);
    });
    it('há um teto por IP ANTES do balde por token (a chave por Authorization era controlada por quem chama)', () => {
        const iTeto = src.indexOf("app.use('/api/', ipCeilingLimiter);");
        const iApi = src.indexOf("app.use('/api/', apiLimiter);");
        expect(iTeto).toBeGreaterThan(-1);
        expect(iApi).toBeGreaterThan(iTeto);
    });
    it('o limiter anti-enumeração do CNPJ entra NA ROTA, depois do requireAuth (montado antes, `req.user` não existia)', () => {
        expect(src).toMatch(/app\.get\('\/api\/admin\/cnpj-lookup\/:cnpj',\s*requireAuth,\s*cnpjLookupLimiter,/);
        expect(src).not.toMatch(/app\.use\('\/api\/admin\/cnpj-lookup', cnpjLookupLimiter\)/);
    });
    it('promise rejeitada fora de handler não derruba o processo (rede declarada)', () => {
        expect(src).toMatch(/process\.on\('unhandledRejection'/);
    });
});

describe('dp-integration entrega dado SERPRO só de CLIENTE cadastrado', () => {
    it('validarCnpj consulta o cadastro e cada rota o aguarda', () => {
        const src = semComentario(ler('sefaz-backend/dp-integration-routes.js'));
        expect(src).toMatch(/acharEmpresaCadastrada\(getDb\(\), cnpj\)/);
        expect(src).not.toMatch(/const cnpj = validarCnpj\(req, res\);/);
        expect((src.match(/const cnpj = await validarCnpj\(req, res\);/g) || []).length).toBeGreaterThanOrEqual(5);
    });
});

describe('fim de mês: reabrir é de ADMIN — e a guarda lê o campo que existe', () => {
    it('`req.user.role`, não `req.user.admin` (que o requireAuth nunca preenche)', () => {
        const src = semComentario(ler('sefaz-backend/fim-de-mes-routes.js'));
        expect(src).toMatch(/ehAdmin: req\.user\?\.role === 'admin'/);
        expect(src).not.toMatch(/req\.user\?\.admin === true/);
    });
});

describe('trabalho em background não derruba o processo', () => {
    it('os dois backfills de cadastro embrulham o laço inteiro', () => {
        const src = semComentario(ler('sefaz-backend/empresa-status-routes.js'));
        expect((src.match(/setImmediate\(async \(\) => \{ try \{/g) || []).length).toBe(2);
        expect(src).toMatch(/falhou em background/);
    });
    it('o laço do bot e o da mídia do webhook têm try/catch por mensagem', () => {
        const src = semComentario(ler('sefaz-backend/whatsapp-webhook-routes.js'));
        expect(src).toMatch(/try \{ await baixarMidiaRecebida\(db, m\); \}/);
        expect(src).toMatch(/const foiNota = await capturarAvaliacao\(db, msg\);/);
        const i = src.indexOf('const foiNota = await capturarAvaliacao(db, msg);');
        expect(src.slice(i - 60, i)).toMatch(/try \{/);
    });
});

describe('auditoria do gateway Reinf carimba o projeto certo', () => {
    it('lê `projectId` (o campo que o crossProjectAuth grava), não `projeto`', () => {
        const src = semComentario(ler('sefaz-backend/reinf-gateway-routes.js'));
        expect(src).toMatch(/projetoOrigem: req\.user\?\.projectId \|\| 'cfi'/);
    });
});
