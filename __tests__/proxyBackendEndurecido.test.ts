/**
 * proxy-backend: três correções de 03/09 num serviço `--allow-unauthenticated`.
 *
 * 1. `express.json({limit:'50mb'})` GLOBAL vinha antes da autenticação —
 *    qualquer um na internet fazia o proxy alocar 50 MB por requisição sem
 *    token. O teto alto vale SÓ no /upload, depois do `requireProxyAuth`;
 *    o resto fica em 100 kb. E o parser pequeno PULA a rota de upload, senão
 *    devolveria 413 antes de o parser de 50 MB rodar.
 * 2. `token === PROXY_SHARED_TOKEN` para no primeiro byte diferente — vaza,
 *    pelo tempo, quanto do prefixo o atacante já acertou. `timingSafeEqual`.
 * 3. `engines.node >= 20` no package.json do proxy, casando com a imagem e
 *    com o `setup-node@v4` do workflow.
 *
 * O `/api/sharepoint/health` devolvendo o corpo do Azure AD (`tokenErro`)
 * FICA de propósito: o card do SharePoint classifica a credencial pela
 * mensagem da Microsoft (ID×Valor, tenant, expirado — 01-02/09).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..', 'proxy-backend');
const server = readFileSync(join(raiz, 'server.js'), 'utf8');
// Só CÓDIGO: o `/** */` de `tokenConfere` cita a forma antiga para explicar
// por que ela saiu — varredura que lê prosa acusa a explicação da correção.
const semComentario = server.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');

describe('proxy-backend/server.js', () => {
    it('o corpo JSON global é PEQUENO e pula a rota de upload', () => {
        expect(semComentario).toMatch(/const jsonPequeno = express\.json\(\{ limit: '100kb' \}\)/);
        expect(semComentario).toMatch(/req\.path === ROTA_UPLOAD \? next\(\) : jsonPequeno\(req, res, next\)/);
        expect(semComentario).not.toMatch(/app\.use\(express\.json\(\{ limit: '50mb' \}\)\)/);
    });

    it('o 50mb vive SÓ na rota de upload, montada depois da autenticação', () => {
        const ocorrencias = semComentario.match(/limit: '50mb'/g) || [];
        expect(ocorrencias).toHaveLength(1);
        const iAuth = semComentario.indexOf("app.use('/api/sharepoint', requireProxyAuth)");
        const iUpload = semComentario.indexOf("app.post(ROTA_UPLOAD, express.json({ limit: '50mb' })");
        expect(iAuth).toBeGreaterThan(-1);
        expect(iUpload).toBeGreaterThan(iAuth);
    });

    it('o token compartilhado é comparado em tempo constante', () => {
        expect(semComentario).toMatch(/import \{ timingSafeEqual \} from 'node:crypto'/);
        expect(semComentario).toMatch(/tokenConfere\(token, PROXY_SHARED_TOKEN\)/);
        expect(semComentario).not.toMatch(/token === PROXY_SHARED_TOKEN/);
        // tamanho diferente devolve false ANTES do timingSafeEqual (que lança).
        expect(semComentario).toMatch(/if \(a\.length !== b\.length\) return false;\s*\n\s*return timingSafeEqual\(a, b\)/);
    });

    it('o /health do SharePoint continua devolvendo o erro do Azure inteiro', () => {
        expect(server).toMatch(/app\.get\('\/api\/sharepoint\/health'[\s\S]*?\.\.\.status,/);
    });
});

describe('proxy-backend/package.json', () => {
    it('declara engines.node >= 20 (a imagem é node:20 e o workflow pina 20)', () => {
        const pkg = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));
        expect(pkg.engines?.node).toBe('>=20');
        const wf = readFileSync(join(__dirname, '..', '.github/workflows/deploy-proxy.yml'), 'utf8');
        expect(wf).toMatch(/actions\/setup-node@v4[\s\S]*?node-version:\s*20/);
    });
});
