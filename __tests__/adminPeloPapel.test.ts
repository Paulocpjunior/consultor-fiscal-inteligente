import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * 02/10 — Alexandre (admin) clicou "Confirmar reabertura" na KAWAI KODOMO e
 * recebeu "Só um administrador reabre competência fechada". A rota conferia
 * `req.user.admin === true`, e o `requireAuth`/`requireAdmin` montam o usuário
 * com `role`, nunca com `admin`: a guarda recusava TODO MUNDO desde 26/08.
 *
 * Fato cobrado, por varredura do backend: decisão de admin lê o campo que o
 * login monta (`role`); `user.admin` é campo fantasma.
 */
const RAIZ = join(__dirname, '..');

function fontes(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
        if (n === 'node_modules') continue;
        const p = join(dir, n);
        if (statSync(p).isDirectory()) fontes(p, out);
        else if (/\.(m?js|cjs)$/.test(n)) out.push(p);
    }
    return out;
}

describe('admin se decide pelo papel (role), nunca por campo que o login não monta', () => {
    const arquivos = [...fontes(join(RAIZ, 'sefaz-backend')), join(RAIZ, 'server.js')];

    it('o login monta req.user com role e sem admin (premissa da trava)', () => {
        const src = readFileSync(join(RAIZ, 'sefaz-backend', 'require-admin.js'), 'utf8');
        const montagens = src.match(/req\.user\s*=\s*\{[^}]*\}/g) || [];
        expect(montagens.length).toBeGreaterThan(0);
        for (const m of montagens) {
            expect(m).toMatch(/\brole\b/);
            expect(m).not.toMatch(/\badmin\s*:/);
        }
    });

    it('nenhum arquivo do backend lê user.admin', () => {
        for (const p of arquivos) {
            const codigo = readFileSync(p, 'utf8').split('\n')
                .filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
            expect({ arquivo: p.slice(RAIZ.length + 1), fantasma: /\buser\??\.admin\b/.test(codigo) })
                .toEqual({ arquivo: p.slice(RAIZ.length + 1), fantasma: false });
        }
    });

});
