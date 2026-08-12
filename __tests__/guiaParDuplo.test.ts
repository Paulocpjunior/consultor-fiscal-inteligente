// ============================================================================
// MATA-BURRO: GUIA DO COLABORADOR TEM DUAS METADES, E ELAS ANDAM JUNTAS.
//
// Material para a equipe NUNCA vai como link do chat (link privado do dono — o
// colaborador recebe "link inválido"). O trilho é HTML estático em `public/`,
// servido pelo próprio app, com a FONTE em `docs/`.
//
// O CLAUDE.md manda "atualizar as DUAS juntas" desde 31/07 — em três guias
// diferentes, escrito três vezes. Nunca houve trava: dava para corrigir o HTML
// e deixar o `docs/` velho (ou o contrário), e a próxima pessoa a ler a fonte
// aprenderia o procedimento ERRADO. É o mesmo vício das réguas duplicadas
// (`reguaUnica.test.ts`), aplicado a texto de procedimento em vez de código.
//
// ═══ COMO O PAR É DECLARADO ═════════════════════════════════════════════════
//
// Os nomes dos arquivos NÃO casam (guia-dipam-produtor-rural.html ×
// guia-colaborador-dipam.md), então o par se declara por dentro:
//
//   HTML:  <meta name="guia-id" content="dipam">
//          <meta name="guia-revisao" content="AAAA-MM-DD">
//   MD:    <!-- guia-id: dipam · guia-revisao: AAAA-MM-DD -->
//
// Mexeu num, a revisão muda; se a outra metade não mudar junto, o build cai.
//
// ═══ REGRA PERMANENTE ═══════════════════════════════════════════════════════
//
// Guia novo nasce com as duas metades e os dois marcadores. Guia sem par não
// passa — nem o HTML órfão (fonte que ninguém acha para corrigir) nem o `.md`
// órfão (procedimento que a equipe nunca vê).
// ============================================================================
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');
const PUBLIC = join(RAIZ, 'public');
const DOCS = join(RAIZ, 'docs');

const REVISAO = /^\d{4}-\d{2}-\d{2}$/;

interface Metade {
    arquivo: string;
    id: string | null;
    revisao: string | null;
}

function lerHtml(nome: string): Metade {
    const s = readFileSync(join(PUBLIC, nome), 'utf8');
    const id = s.match(/<meta\s+name="guia-id"\s+content="([^"]+)"/i);
    const rev = s.match(/<meta\s+name="guia-revisao"\s+content="([^"]+)"/i);
    return { arquivo: `public/${nome}`, id: id?.[1] ?? null, revisao: rev?.[1] ?? null };
}

function lerMd(nome: string): Metade {
    const s = readFileSync(join(DOCS, nome), 'utf8');
    const m = s.match(/guia-id:\s*([a-z0-9-]+)\s*·\s*guia-revisao:\s*([0-9-]+)/i);
    return { arquivo: `docs/${nome}`, id: m?.[1] ?? null, revisao: m?.[2] ?? null };
}

const HTMLS = readdirSync(PUBLIC).filter((f) => /^guia-.*\.html$/.test(f)).map(lerHtml);
const MDS = readdirSync(DOCS).filter((f) => /^guia-colaborador-.*\.md$/.test(f)).map(lerMd);

describe('MATA-BURRO: guia do colaborador anda em par', () => {
    it('a varredura enxerga os guias (trava vazia é trava falsa)', () => {
        expect(HTMLS.length).toBeGreaterThan(0);
        expect(MDS.length).toBeGreaterThan(0);
    });

    it.each(HTMLS.map((h) => [h.arquivo, h] as const))('%s declara id e revisão', (_a, h) => {
        expect(h.id).toBeTruthy();
        expect(h.revisao).toMatch(REVISAO);
    });

    it.each(MDS.map((m) => [m.arquivo, m] as const))('%s declara id e revisão', (_a, m) => {
        expect(m.id).toBeTruthy();
        expect(m.revisao).toMatch(REVISAO);
    });

    it('todo HTML tem a fonte em docs/, e todo docs/ tem a página servida', () => {
        const idsHtml = HTMLS.map((h) => h.id);
        const idsMd = MDS.map((m) => m.id);

        const htmlOrfao = HTMLS.filter((h) => !idsMd.includes(h.id));
        const mdOrfao = MDS.filter((m) => !idsHtml.includes(m.id));

        const erros: string[] = [];
        for (const h of htmlOrfao) {
            erros.push(`${h.arquivo} (id "${h.id}") não tem fonte em docs/ — ninguém acha o texto pra corrigir.`);
        }
        for (const m of mdOrfao) {
            erros.push(`${m.arquivo} (id "${m.id}") não tem página em public/ — a equipe nunca vê este procedimento.`);
        }
        if (erros.length) {
            throw new Error(
                '\n\n🚧 GUIA SEM PAR\n\n' + erros.map((e) => `  · ${e}`).join('\n')
                + '\n\nMaterial da equipe tem DUAS metades: a página servida pelo app (public/) e a\n'
                + 'fonte que se edita (docs/). Uma sem a outra é procedimento que ninguém lê ou\n'
                + 'texto que ninguém acha.\n',
            );
        }
        expect(erros).toEqual([]);
    });

    it('as duas metades do mesmo guia estão na MESMA revisão', () => {
        const porId = new Map<string, Metade[]>();
        for (const m of [...HTMLS, ...MDS]) {
            if (!m.id) continue;
            porId.set(m.id, [...(porId.get(m.id) || []), m]);
        }

        const divergentes: string[] = [];
        for (const [id, metades] of porId) {
            const revs = [...new Set(metades.map((m) => m.revisao))];
            if (revs.length > 1) {
                divergentes.push(
                    `"${id}": ${metades.map((m) => `${m.arquivo} = ${m.revisao}`).join('  ×  ')}`,
                );
            }
        }
        if (divergentes.length) {
            throw new Error(
                '\n\n🚧 AS DUAS METADES DO GUIA DIVERGIRAM\n\n'
                + divergentes.map((d) => `  · ${d}`).join('\n')
                + '\n\nQuem editou uma metade não editou a outra. Atualize as DUAS e suba a mesma\n'
                + '`guia-revisao` nas duas — senão a equipe lê uma versão do procedimento e quem\n'
                + 'mantém lê outra, e a divergência só aparece quando alguém segue o texto errado.\n',
            );
        }
        expect(divergentes).toEqual([]);
    });

    it('cada id aparece exatamente DUAS vezes — nem par duplicado, nem metade sobrando', () => {
        const contagem = new Map<string, number>();
        for (const m of [...HTMLS, ...MDS]) {
            if (m.id) contagem.set(m.id, (contagem.get(m.id) || 0) + 1);
        }
        for (const [id, n] of contagem) {
            expect(`${id}=${n}`).toBe(`${id}=2`);
        }
    });
});
