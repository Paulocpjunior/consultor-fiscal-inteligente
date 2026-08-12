/**
 * MODO ESCURO — trava de layout do card DCTFWeb.
 *
 * Paulo, 12/08/2026: o Painel DCTFWeb no tema escuro saía com o título, os
 * rótulos dos filtros e a tabela inteira em texto escuro sobre fundo escuro —
 * ilegível. A causa é sempre a mesma e não aparece em teste de comportamento:
 * classe de cor CLARA escrita sem o par `dark:`. O componente foi construído
 * olhando o tema claro, e no escuro ele some.
 *
 * Este teste é MATA-BURRO, não aviso: quem escrever `bg-white` sem
 * `dark:bg-…` numa tela do DCTFWeb não passa. Nenhum treinamento substitui a
 * barreira — e o custo do erro é uma tela que a equipe não consegue ler.
 *
 * A régua é por CLASSE e respeita o VARIANTE: `hover:bg-slate-50` pede
 * `dark:hover:bg-…`, não `dark:bg-…`. Cor clara com o par certo passa.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = join(__dirname, '..', 'components', 'DCTFWeb');

/** Utilitário de cor clara → propriedade que precisa do par escuro. */
const CLARAS: Array<[RegExp, string]> = [
    [/^bg-white$/, 'bg-'],
    [/^bg-(?:slate|gray)-(?:50|100)$/, 'bg-'],
    [/^text-(?:slate|gray)-(?:400|500|600|700|800|900)$/, 'text-'],
    [/^border-(?:slate|gray)-(?:200|300)$/, 'border-'],
];

/**
 * O token vem com variantes na frente (`hover:`, `md:`…). O par escuro tem que
 * carregar as MESMAS variantes — senão a classe "corrigida" nunca se aplica.
 */
function paresFaltando(className: string): string[] {
    const toks = className.split(/\s+/).filter(Boolean);
    const faltas: string[] = [];
    for (const tok of toks) {
        if (tok.startsWith('dark:')) continue;
        const partes = tok.split(':');
        const util = partes.pop() as string;
        const variantes = partes.join(':');
        for (const [claro, prop] of CLARAS) {
            if (!claro.test(util)) continue;
            const esperado = `dark:${variantes ? `${variantes}:` : ''}${prop}`;
            if (!toks.some((t) => t.startsWith(esperado))) faltas.push(tok);
            break;
        }
    }
    return faltas;
}

/** Cada className="..." do arquivo (o caso de uma linha, que é o padrão aqui). */
function classNames(fonte: string): string[] {
    return Array.from(fonte.matchAll(/className="([^"{}]*)"/g)).map((m) => m[1]);
}

const arquivos = readdirSync(DIR).filter((f) => f.endsWith('.tsx'));

describe('modo escuro no card DCTFWeb', () => {
    it('existe componente pra conferir (senão o teste passa por vazio)', () => {
        expect(arquivos.length).toBeGreaterThan(0);
    });

    it.each(arquivos)('%s: nenhuma cor clara sem o par dark:', (arquivo) => {
        const fonte = readFileSync(join(DIR, arquivo), 'utf8');
        const faltando = classNames(fonte).flatMap(paresFaltando);
        expect(Array.from(new Set(faltando))).toEqual([]);
    });

    it('a régua enxerga o variante — hover claro pede hover escuro', () => {
        expect(paresFaltando('hover:bg-slate-50 dark:bg-slate-800')).toEqual(['hover:bg-slate-50']);
        expect(paresFaltando('hover:bg-slate-50 dark:hover:bg-slate-700/40')).toEqual([]);
        expect(paresFaltando('bg-white')).toEqual(['bg-white']);
    });

    it('campo de formulário leva cor própria — herdar deixa texto escuro no escuro', () => {
        // Um <select> só com `border rounded` fica ilegível: no tema escuro o
        // fundo do campo acompanha o sistema e o texto, não.
        const fonte = readFileSync(join(DIR, 'index.tsx'), 'utf8');
        const campos: string[] = [];
        for (const m of fonte.matchAll(/<(?:select|input)\b/g)) {
            const resto = fonte.slice(m.index as number);
            const cn = resto.match(/className="([^"]*)"/);
            // Só conta se a className é DO PRÓPRIO campo (nenhuma outra tag
            // abriu antes dela) — senão o teste leria a classe do vizinho.
            if (cn && !resto.slice(1, cn.index as number).includes('<')) campos.push(cn[1]);
        }
        expect(campos.length).toBeGreaterThan(0);
        for (const c of campos) {
            expect(c).toMatch(/dark:bg-/);
            expect(c).toMatch(/dark:text-/);
        }
    });
});
