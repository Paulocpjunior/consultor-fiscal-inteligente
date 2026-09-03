/**
 * 🚨 MATA-BURRO: LISTA SEM `limit` EM COLEÇÃO COM CAP NAS RULES É LISTA NEGADA.
 *
 * As `firestore.rules` exigem `request.query.limit <= N` em dezenas de
 * coleções. Uma query do web SDK SEM `limit()` NÃO satisfaz essa condição —
 * para as rules ela não tem limite nenhum — e a resposta é `permission-denied`
 * na LISTA INTEIRA, não "traz tudo".
 *
 * O caso (03/09): `listarContadores` fazia `getDocs(collection(db,'contadores'))`
 * e o catálogo de contadores respondia VAZIO em toda máquina; `lerParametrosCfop`
 * fazia o mesmo em `cfop_parametros` E engolia a recusa num `catch {}` — o
 * cérebro do CFOP nunca respondeu um parâmetro sequer, calado. É a ausência
 * PLAUSÍVEL de sempre: "ninguém cadastrou" e "não consegui ler" saindo iguais.
 *
 * A trava é por VARREDURA (a lição de 13/08): lê as coleções com cap DAS
 * PRÓPRIAS RULES e cruza com todo `getDocs(` de services/ e components/.
 * Lista escrita à mão aqui envelheceria na primeira coleção nova.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const RAIZ = resolve(__dirname, '..');
const PASTAS = ['services', 'components'];

/** Coleções cujas rules exigem `request.query.limit` na lista. */
function colecoesComCap(): Map<string, number> {
    const rules = readFileSync(join(RAIZ, 'firestore.rules'), 'utf8');
    const out = new Map<string, number>();
    for (const m of rules.matchAll(/match\s+\/([A-Za-z0-9_]+)\/\{[^}]+\}\s*\{([\s\S]*?)\n\s*\}/g)) {
        const cap = m[2].match(/request\.query\.limit\s*<=\s*(\d+)/);
        if (cap) out.set(m[1], Number(cap[1]));
    }
    return out;
}

function arquivos(dir: string, acc: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) { if (nome !== 'node_modules') arquivos(p, acc); continue; }
        if (/\.(ts|tsx)$/.test(nome) && !/\.test\./.test(nome)) acc.push(p);
    }
    return acc;
}

/**
 * Só CÓDIGO: linhas de comentário saem antes da varredura. O mata-burro do
 * contadoresService EXPLICA a forma antiga (`getDocs(collection(db, …))`) no
 * comentário, e varredura que lê prosa acusa a explicação da correção — a
 * mordida do ISS (22/08). Linhas em branco ficam no lugar para o número da
 * linha continuar certo.
 */
function semComentarios(src: string): string {
    return src.split('\n').map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l)).join('\n');
}

/** Corta a chamada `getDocs( … )` inteira, com parênteses balanceados. */
function chamadasGetDocs(src: string): Array<{ inicio: number; texto: string }> {
    const out: Array<{ inicio: number; texto: string }> = [];
    let idx = 0;
    while ((idx = src.indexOf('getDocs(', idx)) !== -1) {
        let i = idx + 8; let depth = 1;
        while (i < src.length && depth > 0) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; i++; }
        out.push({ inicio: idx, texto: src.slice(idx, i) });
        idx = i;
    }
    return out;
}

/** Resolve `collection(db, X)`: literal, `const COL = 'x'` ou `COLLECTIONS.X`. */
function nomeDaColecao(call: string, src: string): string | null {
    const m = call.match(/collection\s*\(\s*[A-Za-z_$][\w$!]*\s*,\s*(?:['"]([a-z0-9_]+)['"]|([A-Za-z_][\w.]*))/);
    if (!m) return null;
    if (m[1]) return m[1];
    const ident = m[2];
    const c = src.match(new RegExp(`const\\s+${ident.replace('.', '\\.')}\\s*=\\s*['"]([a-z0-9_]+)['"]`));
    if (c) return c[1];
    const p = ident.split('.').pop()!;
    const o = src.match(new RegExp(`\\b${p}\\s*:\\s*['"]([a-z0-9_]+)['"]`));
    return o ? o[1] : null;
}

const TEM_LIMITE = /\b(fbLimit|limit|limitToLast)\s*\(/;

/**
 * Tem limite na chamada, OU nas constraints montadas logo acima (`…constraints`
 * espalhado — a forma de listCapturas/listErros/spedFiscalStorageService).
 * A janela de 1500 caracteres para trás cobre a função onde o array nasce.
 */
function carregaLimite(call: string, src: string, inicio: number): boolean {
    if (TEM_LIMITE.test(call)) return true;
    if (!/\.\.\.\s*[A-Za-z_$][\w$]*/.test(call)) return false;
    const janela = src.slice(Math.max(0, inicio - 1500), inicio);
    return TEM_LIMITE.test(janela);
}

describe('🚨 toda lista do cliente em coleção com cap leva `limit`', () => {
    const caps = colecoesComCap();

    it('a varredura enxerga as rules (silêncio falso é pior que trava nenhuma)', () => {
        expect(caps.size).toBeGreaterThan(10);
        expect(caps.get('contadores')).toBe(500);
        expect(caps.get('cfop_parametros')).toBe(2000);
    });

    it('nenhum getDocs sem limit em coleção com cap', () => {
        const fora: string[] = [];
        let vistas = 0;
        for (const pasta of PASTAS) {
            for (const arq of arquivos(join(RAIZ, pasta))) {
                const src = semComentarios(readFileSync(arq, 'utf8'));
                if (!/getDocs\s*\(/.test(src)) continue;
                for (const { inicio, texto } of chamadasGetDocs(src)) {
                    const nome = nomeDaColecao(texto, src);
                    if (!nome || !caps.has(nome)) continue;
                    vistas++;
                    if (carregaLimite(texto, src, inicio)) continue;
                    const linha = src.slice(0, inicio).split('\n').length;
                    fora.push(`  · ${relative(RAIZ, arq)}:${linha}  →  ${nome} (cap ${caps.get(nome)})`);
                }
            }
        }
        expect(vistas).toBeGreaterThan(3);
        if (fora.length) {
            throw new Error(
                '\n\n🚧 LISTA SEM `limit` EM COLEÇÃO COM CAP NAS RULES\n\n'
                + fora.join('\n')
                + '\n\nAs rules exigem `request.query.limit <= N`; query sem `limit()` NÃO\n'
                + 'satisfaz a condição e a lista inteira volta permission-denied — e o\n'
                + 'catch de sempre transforma isso em "lista vazia" (contadores e o cérebro\n'
                + 'do CFOP, 03/09). Use `fetchAllDocs` (services/firestorePaginate.ts) para\n'
                + 'ler a coleção inteira, ou `fbLimit(≤ cap)` na query.\n',
            );
        }
        expect(fora).toEqual([]);
    });
});

describe('os dois casos de 03/09, nomeados', () => {
    it('contadores lê pelo dono da paginação (lote 500 = o cap)', () => {
        const src = readFileSync(join(RAIZ, 'services/contadoresService.ts'), 'utf8');
        expect(src).toMatch(/fetchAllDocs\(COLECAO\)/);
        expect(src).not.toMatch(/getDocs\(collection\(db, COLECAO\)\)/);
    });

    it('cfop_parametros leva fbLimit(2000) E não engole a recusa calado', () => {
        const src = readFileSync(join(RAIZ, 'services/cfopEscrituradoService.ts'), 'utf8');
        const fn = src.slice(src.indexOf('export async function lerParametrosCfop'));
        expect(fn).toMatch(/fbLimit\(TETO_LISTA_PARAMETROS\)/);
        expect(src).toMatch(/TETO_LISTA_PARAMETROS = 2000/);
        // `catch {}` vazio era o silêncio: a recusa tem que ficar NOMEADA.
        expect(fn).not.toMatch(/catch\s*\{\s*return \[\];\s*\}/);
        expect(fn).toMatch(/catch \(e: any\) \{[\s\S]*console\.warn\([\s\S]*e\?\.code/);
    });
});
