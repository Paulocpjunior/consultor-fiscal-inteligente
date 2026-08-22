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
});
