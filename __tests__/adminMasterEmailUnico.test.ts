// ============================================================================
// 🔒 O e-mail do admin MASTER tem UM dono — `services/adminMaster.ts`.
//
// O literal vivia inline em SEIS arquivos (auth, Simples, Lucro, XML, SPED e
// o dashboard do Simples) mais a dica do login. Seis cópias do mesmo fato é a
// segunda cópia de sempre: trocar o e-mail um dia acertaria cinco e deixaria
// uma, e a que sobrou continuaria dando poder de admin a uma caixa que já não
// é a do dono. Varredura, não lista: arquivo novo com o literal quebra a build.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { EMAIL_ADMIN_MASTER, ehAdminMaster } from '../services/adminMaster';

const RAIZ = join(__dirname, '..');
const DONO = 'services/adminMaster.ts';

function fontes(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (['node_modules', 'dist', '.git'].includes(nome) || nome.startsWith('.')) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) fontes(p, out);
        else if (/\.(ts|tsx)$/.test(nome)) out.push(p);
    }
    return out;
}

describe('🔒 o e-mail do admin master mora num lugar só', () => {
    it('nenhum arquivo de components/, services/, hooks/ ou o App carrega o literal', () => {
        const alvos = [
            ...fontes(join(RAIZ, 'components')),
            ...fontes(join(RAIZ, 'services')),
            ...fontes(join(RAIZ, 'hooks')),
            join(RAIZ, 'App.tsx'),
        ];
        // Varredura vazia é trava falsa: hoje são ~430 arquivos, o piso é folga.
        expect(alvos.length).toBeGreaterThan(200);
        const infratores = alvos
            .filter((p) => relative(RAIZ, p).replace(/\\/g, '/') !== DONO)
            .filter((p) => readFileSync(p, 'utf8').includes(EMAIL_ADMIN_MASTER))
            .map((p) => relative(RAIZ, p).replace(/\\/g, '/'));
        expect(infratores).toEqual([]);
    });

    it('os seis leitores importam do dono', () => {
        for (const f of [
            'services/authService.ts', 'services/simplesNacionalService.ts', 'services/lucroPresumidoService.ts',
            'services/xmlFiscalService.ts', 'services/spedFiscalStorageService.ts', 'components/SimplesNacionalDashboard.tsx',
        ]) {
            expect(readFileSync(join(RAIZ, f), 'utf8')).toMatch(/from '\.\.?\/(?:services\/)?adminMaster'/);
        }
    });

    // Sem `import.meta.env` de propósito: a trava `viteEnvChegaNoBuild` obrigaria
    // a variável a existir no workflow e no Dockerfile por um valor que não muda.
    it('o dono é constante plana, não env do Vite', () => {
        const codigo = readFileSync(join(RAIZ, DONO), 'utf8').replace(/^\s*\*.*$/gm, '').replace(/^\s*\/\/.*$/gm, '');
        expect(codigo).not.toMatch(/import\.meta/);
    });

    it('a comparação ignora caixa e espaço — o e-mail chega digitado', () => {
        expect(ehAdminMaster(' Junior@SPassessoriaContabil.com.br ')).toBe(true);
        expect(ehAdminMaster('outro@spassessoriacontabil.com.br')).toBe(false);
        expect(ehAdminMaster(null)).toBe(false);
    });
});
