// ============================================================================
// 🚨 `.d.ts` ESCRITO À MÃO É A ARMADILHA DAS DUAS FORMAS COM OUTRA ROUPA
//
// A regra é de 20/08 (deploy 634): o tipo e a implementação são DUAS
// declarações do MESMO fato, e divergem em silêncio — o `.js` não reclama.
//
// ⚠️ MAS AS DUAS DIREÇÕES NÃO CUSTAM IGUAL, e por isso esta trava vigia UMA:
//
//  · **`.js` exporta e o `.d.ts` não declara** → quem importar do TypeScript
//    leva **erro de compilação**. É ruim, mas é ALTO: o gate pega.
//  · **`.d.ts` declara e o `.js` não exporta mais** → o TypeScript compila
//    feliz, e o import estoura **em produção**, no primeiro clique. É este o
//    silencioso, e é este que a trava fecha.
//
// A varredura de 22/08 encontrou ZERO fantasmas — a trava nasce VERDE, que é
// como trava deve nascer. Ela existe para o dia em que alguém apagar uma
// função e esquecer o tipo ao lado.
// ============================================================================
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const RAIZ = join(__dirname, '..');

function varrer(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (['node_modules', 'dist'].includes(nome) || nome.startsWith('.')) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) varrer(p, out);
        else if (nome.endsWith('.d.ts')) out.push(p);
    }
    return out;
}

/**
 * Nomes EXPORTADOS por um arquivo — serve tanto para o `.d.ts` (o que ele
 * promete) quanto para o `.js` (o que ele entrega).
 *
 * 🐛 A 1ª versão desta trava só perguntava se o nome APARECIA no `.js`, e por
 * isso não pegou o caso que ela existe para pegar: tirar o `export` de uma
 * função que continua declarada no arquivo. Trava que não grita quando devia é
 * pior que trava nenhuma — ela dá a sensação de cobertura.
 */
function exportados(src: string): string[] {
    const nomes = new Set<string>();
    const re = /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm;
    for (const m of src.matchAll(re)) nomes.add(m[1]);
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const parte of m[1].split(',')) {
            const n = parte.trim().split(' as ').pop()?.trim();
            if (n && n !== 'default') nomes.add(n);
        }
    }
    return [...nomes];
}

describe('🚨 `.d.ts` não promete o que o `.js` não entrega', () => {
    it('nenhum tipo declara função que a implementação não tem', () => {
        const fantasmas: string[] = [];
        for (const dts of varrer(join(RAIZ, 'sefaz-backend'))) {
            const js = dts.replace(/\.d\.ts$/, '.js');
            if (!existsSync(js)) continue;
            const entregues = new Set(exportados(readFileSync(js, 'utf8')));
            for (const nome of exportados(readFileSync(dts, 'utf8'))) {
                if (!entregues.has(nome)) {
                    fantasmas.push(`${relative(RAIZ, dts)}  promete "${nome}"`);
                }
            }
        }
        if (fantasmas.length) {
            throw new Error(
                '\n\n🚧 TIPO PROMETENDO O QUE A IMPLEMENTAÇÃO NÃO TEM\n\n'
                + fantasmas.map((x) => `  · ${x}`).join('\n')
                + '\n\nO TypeScript compila feliz e o import estoura EM PRODUÇÃO, no primeiro\n'
                + 'clique. O tipo e a implementação são duas declarações do MESMO fato\n'
                + '(20/08, deploy 634): mexeu no `.js`, o `.d.ts` vizinho vai no MESMO PR.\n',
            );
        }
    });

    // As duas constantes de projeção nasceram hoje e o `.d.ts` do módulo já
    // existia — foi a própria regra do 20/08 que eu quase repeti.
    it('as constantes de projeção estão declaradas nos dois lados', () => {
        const dts = readFileSync(join(RAIZ, 'sefaz-backend/xml-metadata-helper.d.ts'), 'utf8');
        for (const nome of ['CAMPOS_PARA_DOC_CANCELADO', 'CAMPOS_PARA_VALOR_DO_DOCUMENTO']) {
            expect({ nome, declarado: dts.includes(nome) }).toEqual({ nome, declarado: true });
        }
    });

    // ========================================================================
    // 🚨 E A TERCEIRA DIREÇÃO APARECEU EM PRODUÇÃO (26/08, deploys 799 → 800):
    // o `.d.ts` da presença ficou de fora do PR, o `tsc` gritou — que é o
    // comportamento CERTO, a direção ALTA lá de cima — e o deploy seguinte
    // ficou verde porque alguém **silenciou o grito** com `@ts-ignore`, em vez
    // de escrever o tipo que faltava.
    //
    // Isso é pior que a divergência que a trava já vigia: aquela ao menos
    // ACONTECE em silêncio. Aqui o gate avisou, o aviso foi tapado, e o módulo
    // passou a viver sem tipo NENHUM com um `.d.ts` intacto do lado — os dois
    // podem divergir à vontade que ninguém mais reclama.
    //
    // ⚠️ MAS A ASSINATURA É ESTREITA, e o motivo é decisão da casa: em 22/08
    // ficou escrito que os ~25 nomes que o `.js` exporta e o `.d.ts` não
    // declara **não seriam corrigidos em massa** — corrigir em bloco é
    // trabalho sem consequência, e a régua é triagem por RISCO. Onde o tipo
    // REALMENTE não declara o nome importado, o `@ts-ignore` é como se convive
    // com aquela decisão; acusá-lo seria alarme sobre código que está do jeito
    // combinado.
    //
    // O que esta trava barra é o silêncio que **não esconde nada**: o `.d.ts`
    // declara TUDO o que a linha importa, o `tsc` passaria limpo, e mesmo
    // assim alguém mandou ele calar a boca. Foram 17 assim — medidos, não
    // deduzidos: removidos, o `tsc` passa e os tipos voltam a valer.
    // ========================================================================
    it('🚨 ninguém cala o `tsc` sobre nome que o `.d.ts` JÁ declara', () => {
        const arquivos: string[] = [];
        const varrerTs = (dir: string) => {
            if (!existsSync(dir)) return;
            for (const nome of readdirSync(dir)) {
                if (['node_modules', 'dist'].includes(nome) || nome.startsWith('.')) continue;
                const p = join(dir, nome);
                if (statSync(p).isDirectory()) varrerTs(p);
                else if (/\.tsx?$/.test(nome) && !nome.endsWith('.d.ts')) arquivos.push(p);
            }
        };
        for (const pasta of ['__tests__', 'services', 'components']) varrerTs(join(RAIZ, pasta));

        const cache = new Map<string, Set<string> | null>();
        const tiposDo = (modulo: string): Set<string> | null => {
            if (!cache.has(modulo)) {
                const dts = join(RAIZ, 'sefaz-backend', `${modulo}.d.ts`);
                cache.set(modulo, existsSync(dts) ? new Set(exportados(readFileSync(dts, 'utf8'))) : null);
            }
            return cache.get(modulo) ?? null;
        };

        const inuteis: string[] = [];
        for (const arq of arquivos) {
            const src = readFileSync(arq, 'utf8');
            const linhas = src.split('\n');

            // 🚨 A ATRIBUIÇÃO É O PULO DO GATO, e a 1ª versão errou nela: eu
            // procurava o import numa JANELA em volta, e o `@ts-ignore` vale
            // para a linha SEGUINTE — então ele acabava creditado a um import
            // TIPADO logo acima enquanto guardava, de verdade, o módulo SEM
            // tipos da linha de baixo. Removê-lo quebrava o `tsc`: a trava
            // mandaria apagar o silêncio que era necessário.
            const imports: { ini: number; fim: number; nomes: string; caminho: string }[] = [];
            for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
                const ate = (p: number) => src.slice(0, p).split('\n').length - 1;
                imports.push({ ini: ate(m.index ?? 0), fim: ate((m.index ?? 0) + m[0].length), nomes: m[1], caminho: m[2] });
            }

            linhas.forEach((linha, i) => {
                if (!/@ts-(ignore|expect-error)/.test(linha)) return;
                // Dentro das chaves de um import multilinha (foi a forma do da
                // presença) ou logo acima do import que ele guarda.
                let alvo = imports.find((imp) => imp.ini <= i && i <= imp.fim);
                if (!alvo) {
                    const prox = linhas.findIndex((l, j) => j > i && l.trim() !== '');
                    alvo = imports.find((imp) => imp.ini === prox);
                }
                if (!alvo) return;
                const mod = alvo.caminho.match(/sefaz-backend\/([\w-]+)(?:\.js)?$/);
                if (!mod) return;
                const tipos = tiposDo(mod[1]);
                if (!tipos) return;   // módulo sem `.d.ts`: o silêncio é a verdade
                const nomes = alvo.nomes.replace(/\/\/[^\n]*/g, '').split(',')
                    .map((n) => n.replace(/^\s*type\s+/, '').split(' as ')[0].trim())
                    .filter(Boolean);
                if (nomes.length && nomes.every((n) => tipos.has(n))) {
                    inuteis.push(`${relative(RAIZ, arq)}:${i + 1}  cala o tsc sobre "${mod[1]}", que já declara ${nomes.join(', ')}`);
                }
            });
        }

        if (inuteis.length) {
            throw new Error(
                '\n\n🚧 `@ts-ignore` TAPANDO UM AVISO QUE NEM EXISTE\n\n'
                + inuteis.map((x) => `  · ${x}`).join('\n')
                + '\n\nO `.d.ts` declara tudo o que essa linha importa: sem o silêncio o\n'
                + '`tsc` passa limpo E confere os tipos. Com ele, o módulo volta a ser\n'
                + '`any` — e o `.d.ts` do lado para de valer para quem importa.\n\n'
                + 'Foi assim que a presença derrubou o deploy 799 e "consertou" no 800\n'
                + '(26/08): o tipo faltava, o gate gritou certo, e o grito foi tapado.\n'
                + 'Apague o `@ts-ignore`. Se depois disso o `tsc` reclamar de um nome,\n'
                + 'é porque o tipo falta MESMO — aí escreva a linha no `.d.ts`.\n',
            );
        }
    });
});
