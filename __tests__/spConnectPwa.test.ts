// ============================================================================
// PWA do SP Connect — a Ultra Fox também é app de celular/tablet, então o
// Connect precisa ser INSTALÁVEL. As travas aqui existem porque cada uma
// delas quebra em silêncio: manifest no index.html faria o CFI se instalar
// como "SP Connect"; ícone faltando derruba o convite de instalação sem
// dizer nada; e manifest cacheado 1 ano prende start_url velho no celular
// de quem já instalou.
// ============================================================================
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(raiz, 'public/connect.webmanifest'), 'utf8'));

describe('manifest do SP Connect', () => {
    it('a casa do PWA é /connect — start_url e scope não podem apontar pro CFI', () => {
        expect(manifest.start_url).toBe('/connect');
        expect(manifest.scope).toBe('/connect');
        expect(manifest.display).toBe('standalone');
        expect(manifest.name).toContain('SP Connect');
    });

    it('identidade é da CASA (azul SP), nunca da ferramenta', () => {
        expect(manifest.theme_color.toLowerCase()).toBe('#0e3bfa');
        expect(JSON.stringify(manifest).toLowerCase()).not.toContain('claude');
    });

    it('todo ícone declarado EXISTE no disco (ícone faltando derruba a instalação em silêncio)', () => {
        const srcs: string[] = manifest.icons.map((i: { src: string }) => i.src);
        expect(srcs.length).toBeGreaterThanOrEqual(2);
        for (const src of srcs) {
            expect(existsSync(join(raiz, 'public', src.replace(/^\//, '')))).toBe(true);
        }
        // maskable é o que evita o ícone recortado no Android
        expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    });
});

describe('injeção do manifest e cache', () => {
    it('o index.html NÃO declara o manifest — senão o CFI se instalaria como SP Connect', () => {
        const html = readFileSync(join(raiz, 'index.html'), 'utf8');
        expect(html).not.toContain('connect.webmanifest');
    });

    it('o App injeta manifest e apple-touch-icon SÓ no modo /connect', () => {
        const app = readFileSync(join(raiz, 'App.tsx'), 'utf8');
        const trecho = app.slice(app.indexOf('MODO_SP_CONNECT || typeof document'), app.indexOf('MODO_SP_CONNECT || typeof document') + 1200);
        expect(trecho).toContain("por('manifest', '/connect.webmanifest')");
        expect(trecho).toContain('apple-touch-icon');
    });

    it('.webmanifest NÃO cacheia como immutable — manifest velho preso no celular não se conserta sozinho', () => {
        const server = readFileSync(join(raiz, 'server.js'), 'utf8');
        // A pergunta é "`.webmanifest` está na CONDIÇÃO do ramo no-store?",
        // não "a palavra aparece por perto" — a 1ª versão deste teste passava
        // com a regra revertida, porque casava o `.webmanifest` da linha de
        // Content-Type logo abaixo. Sentinela tem que responder a pergunta
        // certa (mesma lição do backfill de participantes, 13/08).
        const linhas = server.split('\n');
        const i = linhas.findIndex((l) => /^\s*if\s*\(.*filePath\.endsWith\('\.html'\)/.test(l));
        expect(i).toBeGreaterThan(-1);
        // .webmanifest tem que estar na CONDIÇÃO (mesma linha do if)…
        expect(linhas[i]).toContain(".webmanifest");
        // …e o ramo tem que ser mesmo o do no-store.
        expect(linhas.slice(i + 1, i + 3).join('\n')).toContain('no-store');
        // 🚨 .zip na MESMA condição (caso do Paulo, 24/08): o pacote do Teams
        // é atualizado com o MESMO nome a cada versão — sem hash no nome, o
        // "immutable 1 ano" entregava o zip 1.0.1 velho do cache do navegador
        // no dia em que o 1.1.0 precisava subir.
        expect(linhas[i]).toContain(".zip");
    });
});
