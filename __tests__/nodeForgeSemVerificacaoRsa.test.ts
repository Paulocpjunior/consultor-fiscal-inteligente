import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo .js puro (sem tipos)
import { avaliarAuditoria, ghsaDaUrl } from '../scripts/audit-aceitos.js';

/**
 * 02/10 — node-forge ganhou o advisory high GHSA-86w9-cpqp-85rv (verificação
 * de assinatura RSA PKCS#1 v1.5), SEM versão corrigida, e a auditoria travou o
 * deploy. Paulo aceitou o risco com prazo ("sim, libera"), porque o CFI só usa
 * o node-forge para ABRIR o PFX e exportar PEM.
 *
 * Esta trava mantém esse motivo verdadeiro: se alguém passar a VERIFICAR
 * assinatura com o node-forge, o aceite deixa de valer e o build fica vermelho.
 */
const RAIZ = join(__dirname, '..');
const PASTAS = ['sefaz-backend', 'services', 'components', 'proxy-backend', 'scripts'];
const IGNORAR = new Set(['node_modules', 'dist', '.git']);

function fontes(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const nome of readdirSync(dir)) {
        if (IGNORAR.has(nome)) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) fontes(p, out);
        else if (/\.(m?js|cjs|ts|tsx)$/.test(nome) && !nome.endsWith('.d.ts')) out.push(p);
    }
    return out;
}

const todas = [...PASTAS.flatMap((d) => fontes(join(RAIZ, d))), join(RAIZ, 'server.js')]
    .filter((p) => existsSync(p))
    .map((p) => ({ p: p.slice(RAIZ.length + 1), src: readFileSync(p, 'utf8') }));
const usamForge = todas.filter(({ src }) => /['"]node-forge['"]/.test(src));

describe('o CFI não verifica assinatura com o node-forge', () => {
    it('a varredura acha quem usa o node-forge (senão não mede nada)', () => {
        expect(usamForge.length).toBeGreaterThan(3);
    });

    it('nenhum arquivo que importa o node-forge chama .verify(', () => {
        for (const { p, src } of usamForge) {
            expect({ p, verifica: /\.verify\s*\(/.test(src) }).toEqual({ p, verifica: false });
        }
    });
});

describe('avaliarAuditoria — o aceite é estreito e vence', () => {
    const ACEITO = {
        advisory: 'GHSA-86w9-cpqp-85rv', pacote: 'node-forge', ate: '2026-11-02',
        aprovadoPor: 'Paulo', motivo: 'sem fix; só PFX', trava: '__tests__/x.test.ts',
    };
    const relatorio = (via: any[]) => ({ vulnerabilities: { 'node-forge': { via } } });
    const advisory = (over: any = {}) => ({
        name: 'node-forge', severity: 'high', title: 'RSA PKCS#1',
        url: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv', source: 1, ...over,
    });

    it('aceito, dentro do prazo: libera', () => {
        const r = avaliarAuditoria(relatorio([advisory()]), [ACEITO], '2026-10-02');
        expect(r.bloqueia).toEqual([]);
        expect(r.aceitos).toHaveLength(1);
    });

    it('prazo vencido: volta a bloquear', () => {
        const r = avaliarAuditoria(relatorio([advisory()]), [ACEITO], '2026-11-03');
        expect(r.bloqueia).toHaveLength(1);
        expect(r.bloqueia[0].motivo).toMatch(/vencido/);
    });

    it('advisory NOVO no mesmo pacote bloqueia', () => {
        const r = avaliarAuditoria(relatorio([advisory({ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' })]), [ACEITO], '2026-10-02');
        expect(r.bloqueia).toHaveLength(1);
    });

    it('o mesmo GHSA em outro pacote não é aceito', () => {
        const r = avaliarAuditoria({ vulnerabilities: { outro: { via: [advisory({ name: 'outro' })] } } }, [ACEITO], '2026-10-02');
        expect(r.bloqueia).toHaveLength(1);
    });

    it('aceite sem trava, motivo ou quem aprovou não vale', () => {
        const r = avaliarAuditoria(relatorio([advisory()]), [{ ...ACEITO, trava: '' }], '2026-10-02');
        expect(r.bloqueia).toHaveLength(1);
    });

    it('moderate não bloqueia (a régua é high/critical); via em texto é avaliada na origem', () => {
        const r = avaliarAuditoria({
            vulnerabilities: {
                a: { via: [advisory({ name: 'a', severity: 'moderate', url: 'https://github.com/advisories/GHSA-1111-2222-3333' })] },
                b: { via: ['a'] },
            },
        }, [], '2026-10-02');
        expect(r.bloqueia).toEqual([]);
    });

    it('ghsaDaUrl lê o identificador', () => {
        expect(ghsaDaUrl('https://github.com/advisories/GHSA-86w9-cpqp-85rv')).toBe('GHSA-86W9-CPQP-85RV');
        expect(ghsaDaUrl('')).toBe('');
    });
});

describe('audit-aceitos.json — todo aceite tem dono, motivo, prazo e trava real', () => {
    const lista = JSON.parse(readFileSync(join(RAIZ, 'scripts', 'audit-aceitos.json'), 'utf8'));
    it('cada entrada está completa e a trava existe', () => {
        expect(Array.isArray(lista)).toBe(true);
        for (const a of lista) {
            expect(a.advisory).toMatch(/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/i);
            expect(a.pacote).toBeTruthy();
            expect(a.aprovadoPor).toBeTruthy();
            expect(a.motivo).toBeTruthy();
            expect(a.ate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(existsSync(join(RAIZ, a.trava))).toBe(true);
        }
    });
});
