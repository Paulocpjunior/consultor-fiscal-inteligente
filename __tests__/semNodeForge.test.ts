import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo .js puro (sem tipos)
import { avaliarAuditoria, ghsaDaUrl } from '../scripts/audit-aceitos.js';

/**
 * 🔐 O NODE-FORGE SAIU DO CFI (03/10) — e esta trava impede a volta.
 *
 * 02/10: o node-forge ganhou o advisory high GHSA-86w9-cpqp-85rv, SEM versão
 * corrigida, e o deploy travou. Paulo liberou com prazo e, em 03/10, pediu a
 * troca definitiva ("resolva de forma definitiva"). O PFX passou a ser lido
 * por `sefaz-backend/pkcs12.js`, sobre o crypto nativo.
 *
 * Fatos cobrados: nenhum código (produção, scripts ou teste) importa o
 * node-forge; o package.json não o declara; e a lista de aceites não guarda
 * um aceite para um pacote que não existe mais.
 *
 * A régua dos aceites (`avaliarAuditoria`) continua — é dela o próximo
 * advisory sem correção — e segue travada aqui.
 */
const RAIZ = join(__dirname, '..');
const PASTAS = ['sefaz-backend', 'services', 'components', 'proxy-backend', 'scripts', '__tests__'];
const IGNORAR = new Set(['node_modules', 'dist', '.git', 'fixtures']);

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

// Esta própria trava cita as formas de import para provar o regex.
const todas = [...PASTAS.flatMap((d) => fontes(join(RAIZ, d))), join(RAIZ, 'server.js')]
    .filter((p) => existsSync(p) && p !== __filename)
    .map((p) => ({ p: p.slice(RAIZ.length + 1), src: readFileSync(p, 'utf8') }));

/** Import/require do pacote — citação em comentário ou dado não conta. */
const IMPORTA_FORGE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]node-forge(?:\/[^'"]*)?['"]/;

describe('o node-forge não volta ao CFI', () => {
    it('a varredura enxerga o código (senão não mede nada)', () => {
        expect(todas.length).toBeGreaterThan(200);
        expect(todas.some(({ p }) => p.endsWith(join('sefaz-backend', 'pkcs12.js')))).toBe(true);
    });

    it('nenhum arquivo importa o node-forge', () => {
        const importam = todas.filter(({ src }) => IMPORTA_FORGE.test(src)).map(({ p }) => p);
        expect(importam).toEqual([]);
    });

    it('a detecção pega as formas de import (o regex não é decorativo)', () => {
        expect(IMPORTA_FORGE.test("import forge from 'node-forge';")).toBe(true);
        expect(IMPORTA_FORGE.test('import * as f from "node-forge"')).toBe(true);
        expect(IMPORTA_FORGE.test("const f = require('node-forge')")).toBe(true);
        expect(IMPORTA_FORGE.test("await import('node-forge/lib/pki')")).toBe(true);
        expect(IMPORTA_FORGE.test('// o node-forge saiu do projeto')).toBe(false);
    });

    it('nenhum package.json declara o node-forge', () => {
        for (const arq of ['package.json', join('proxy-backend', 'package.json')]) {
            const caminho = join(RAIZ, arq);
            if (!existsSync(caminho)) continue;
            const pkg = JSON.parse(readFileSync(caminho, 'utf8'));
            const declarados = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });
            expect({ arq, forge: declarados.includes('node-forge') }).toEqual({ arq, forge: false });
        }
    });

    it('a lista de aceites não guarda aceite do node-forge', () => {
        const lista = JSON.parse(readFileSync(join(RAIZ, 'scripts', 'audit-aceitos.json'), 'utf8'));
        expect(lista.filter((a: any) => a.pacote === 'node-forge')).toEqual([]);
    });
});

describe('avaliarAuditoria — o aceite é estreito e vence', () => {
    const ACEITO = {
        advisory: 'GHSA-86w9-cpqp-85rv', pacote: 'pacote-x', ate: '2026-11-02',
        aprovadoPor: 'Paulo', motivo: 'sem fix; uso restrito', trava: '__tests__/x.test.ts',
    };
    const relatorio = (via: any[]) => ({ vulnerabilities: { 'pacote-x': { via } } });
    const advisory = (over: any = {}) => ({
        name: 'pacote-x', severity: 'high', title: 'RSA PKCS#1',
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
