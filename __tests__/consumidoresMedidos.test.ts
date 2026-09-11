/**
 * 🚨 MATA-BURRO GENÉRICO: RÉGUA NOVA NASCE COM TODOS OS CONSUMIDORES MEDIDOS.
 *
 * A classe que este projeto mais paga tem um nome desde 19/08 — o
 * `saldoCredorIpiAnterior`: o gerador lia um campo que NENHUM orquestrador
 * passava. Nada quebra. A função responde sobre o caso VAZIO, todo dia, com
 * toda confiança, e o sintoma chega meses depois como "o app não gravou".
 *
 * Em 04/09 eu a repeti TRÊS vezes no mesmo dia:
 *   · `linhasRetencoes(docs, direcao, ajustes)` ganhou o 3º argumento de manhã
 *     e a tela de Relatórios chamava `linhasRetencoes(docs, direcao)` — quem
 *     informava a retenção continuava vendo o zero do documento (FRONTINI);
 *   · `coletarRetencoesF600(notas, warnings, ajustes)` — a varredura cobriu
 *     as três chamadas do F600 e deixou o relatório de fora;
 *   · a régua de espécie do R-4020 ficou copiada em dois lugares e divergiu.
 *
 * As três viraram varreduras ESPECÍFICAS. Esta é a GENÉRICA: um registro de
 * réguas cujo argumento é OBRIGATÓRIO para todo consumidor, e a varredura
 * acha cada chamada no código de produção e conta os argumentos. Régua nova
 * com parâmetro que "todo mundo tem que passar" entra AQUI, no mesmo PR.
 *
 * ⚠️ É OPT-IN de propósito. Varrer TODO parâmetro opcional do repo acusaria
 * default legítimo em centenas de funções — alarme sobre código certo é o
 * jeito conhecido de a equipe desligar a trava. O que se registra é a régua
 * em que passar a MENOS não é "usar o default": é ler o caso vazio como se
 * fosse a resposta.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

interface ReguaVigiada {
    /** Nome exato da função. */
    fn: string;
    /** Quantos argumentos TODO consumidor tem de passar. */
    minArgs: number;
    /** O que é o argumento que faltava — para a mensagem de falha ensinar. */
    argumento: string;
    /** O caso real que custou. */
    motivo: string;
}

const REGUAS: ReguaVigiada[] = [
    {
        fn: 'linhasRetencoes',
        minArgs: 3,
        argumento: 'ajustes (as retenções informadas à mão)',
        motivo: '04/09 FRONTINI — a tela chamava com 2 argumentos e a retenção informada nunca chegava ao relatório',
    },
    {
        fn: 'coletarRetencoesF600',
        minArgs: 3,
        argumento: 'ajustes (o mapa de reinf_retencoes_ajustadas)',
        motivo: '04/09 — o F600 lia o mapa que nenhum orquestrador passava; o M200/M600 saía sem o abatimento',
    },
    {
        fn: 'selecionarNotasBlocoC',
        minArgs: 2,
        argumento: 'empresaCnpj (quem ESCRITURA — separa a nota própria NOSSA da entrada do FORNECEDOR)',
        motivo: '09/09 MV LIDER — sem o CNPJ a régua não afirma, e a nota de entrada de terceiro volta ao bloco C em silêncio',
    },
    {
        fn: 'escrituraveisNoLivroDeEntradas',
        minArgs: 4,
        argumento: 'empresaCnpj (quem ESCRITURA)',
        motivo: '09/09 MV LIDER — sem ele o Livro de Entradas volta a escriturar a devolução recebida pelo fornecedor',
    },
    {
        fn: 'cfopParaEscriturar',
        minArgs: 5,
        argumento: 'doc (o DOCUMENTO) e item (o ITEM — é dele que sai o CFOP informado por item, 11/09)',
        motivo: '07/09 — a conferência chamava com 3 argumentos e prometia a régua automática numa nota já decidida; '
            + '11/09 — sem o item, a nota mista da Sandra (1407 + 1556) sairia com um CFOP só no .FML',
    },
    {
        fn: 'cfopDoLancamento',
        minArgs: 5,
        argumento: 'item (o ITEM — `escrituracaoItens[nItem]` vence o CFOP da nota; CT-e sem item passa null DITO)',
        motivo: '11/09 Sandra — "preciso lançar 2 CFOPs nessa nota": leitor que passa só o CFOP responde "nenhum item informado" com toda confiança',
    },
    {
        fn: 'convertCfopParaEntrada',
        minArgs: 5,
        argumento: 'item (o ITEM) — C170, C190 e E510 das duas famílias',
        motivo: '11/09 — o SPED do Paulo continuava com uso/consumo "puxando com ICMS" porque o item de ST e o de consumo saíam com o CFOP da nota',
    },
];

const RAIZ = join(__dirname, '..');
const PASTAS = ['components', 'services', 'sefaz-backend'];

function arquivosDeProducao(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        const p = join(dir, nome);
        const st = statSync(p);
        if (st.isDirectory()) {
            if (nome === 'node_modules' || nome === '__tests__') continue;
            arquivosDeProducao(p, out);
        } else if (/\.(ts|tsx|js)$/.test(nome) && !/\.d\.ts$/.test(nome) && !/\.test\.(ts|tsx|js)$/.test(nome)) {
            out.push(p);
        }
    }
    return out;
}

/** Tira comentário de LINHA e linhas de bloco iniciadas com `*` — nunca regex
 *  de bloco atravessando o arquivo (a lição de 26/08). */
const semComentarios = (src: string) => src
    .split('\n')
    .map(l => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l))
    .join('\n');

/**
 * Conta os argumentos de nível zero a partir do `(` de abertura, respeitando
 * parênteses/colchetes/chaves aninhados e literais de string.
 */
function contarArgumentos(src: string, abre: number): { n: number; fecha: number } {
    let depth = 0;
    let n = 0;
    let temConteudo = false;
    let str: string | null = null;
    for (let i = abre; i < src.length; i++) {
        const c = src[i];
        if (str) {
            if (c === '\\') { i++; continue; }
            if (c === str) str = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { str = c; temConteudo = true; continue; }
        if (c === '(' || c === '[' || c === '{') { depth++; if (depth > 1) temConteudo = true; continue; }
        if (c === ')' || c === ']' || c === '}') {
            depth--;
            if (depth === 0) return { n: temConteudo ? n + 1 : n, fecha: i };
            continue;
        }
        if (depth === 1 && c === ',') { n++; temConteudo = false; continue; }
        if (depth === 1 && !/\s/.test(c)) temConteudo = true;
    }
    return { n, fecha: src.length };
}

interface Chamada { arquivo: string; linha: number; args: number }

function chamadasDe(fn: string): Chamada[] {
    const out: Chamada[] = [];
    const re = new RegExp(`(^|[^\\w$.])${fn}\\s*\\(`, 'g');
    for (const pasta of PASTAS) {
        for (const arq of arquivosDeProducao(join(RAIZ, pasta))) {
            const bruto = readFileSync(arq, 'utf8');
            const src = semComentarios(bruto);
            let m: RegExpExecArray | null;
            while ((m = re.exec(src))) {
                const ini = m.index + m[1].length;
                const antes = src.slice(Math.max(0, ini - 40), ini);
                // A DECLARAÇÃO não é chamada — e acusá-la foi o vício da 1ª
                // versão da varredura do F600 (04/09).
                if (/(function|const|let|var)\s+$/.test(antes)) continue;
                if (/\bimport\b[^;]*$/.test(src.slice(Math.max(0, ini - 200), ini))) continue;
                const abre = src.indexOf('(', ini);
                const { n } = contarArgumentos(src, abre);
                const linha = src.slice(0, ini).split('\n').length;
                out.push({ arquivo: relative(RAIZ, arq), linha, args: n });
            }
        }
    }
    return out;
}

describe('🔬 toda chamada de régua vigiada passa o argumento obrigatório', () => {
    for (const r of REGUAS) {
        describe(r.fn, () => {
            const chamadas = chamadasDe(r.fn);

            it('tem pelo menos um consumidor em produção — régua sem consumidor é a flag que ninguém lê', () => {
                expect(chamadas.length).toBeGreaterThan(0);
            });

            it(`todos passam ≥ ${r.minArgs} argumentos (${r.argumento})`, () => {
                const curtas = chamadas.filter(c => c.args < r.minArgs);
                const lista = curtas.map(c => `  ${c.arquivo}:${c.linha} — ${c.args} argumento(s)`).join('\n');
                expect({
                    faltando: curtas.length,
                    onde: lista,
                    porque: r.motivo,
                }).toEqual({ faltando: 0, onde: '', porque: r.motivo });
            });
        });
    }
});

describe('🔬 a própria varredura enxerga', () => {
    it('conta argumentos com aninhamento e string', () => {
        const src = 'f(a, {b: g(1, 2)}, "x,y", [3, 4])';
        expect(contarArgumentos(src, src.indexOf('(')).n).toBe(4);
    });

    it('chamada vazia conta zero', () => {
        expect(contarArgumentos('f()', 1).n).toBe(0);
    });

    it('vírgula final não vira argumento fantasma', () => {
        const src = 'f(a,\n  b,\n)';
        expect(contarArgumentos(src, 1).n).toBe(2);
    });

    it('lê ao menos 50 arquivos — senão o glob quebrou e o verde não mede nada', () => {
        const total = PASTAS.reduce((s, p) => s + arquivosDeProducao(join(RAIZ, p)).length, 0);
        expect(total).toBeGreaterThan(50);
    });
});
