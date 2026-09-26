// ============================================================================
// 🚨 TODA LEITURA `fetchAllDocs(...)` EM services/ DECLARA O PRÓPRIO TETO
//
// O `fetchAllDocs` tem `maxDocs` default (20000) — e default é teto MUDO: quem
// lê `users`, `contadores` ou `simples_empresas` sem dizer o teto não pensou
// no tamanho da coleção, e a tela que mostra a lista não tem como saber que
// ela foi cortada. Auditoria de 26/09: 24 chamadas em 12 arquivos, só 5
// passavam `maxDocs`.
//
// A régua: cada chamada passa `maxDocs` explícito (o valor é do caller, por
// coleção); e quem alimenta uma TELA expõe o truncamento (`meta`/`truncado`)
// — farol honesto: lista cortada diz "mostrando X de N", nunca some calada.
//
// Fecha a classe por VARREDURA (services/**/*.ts), não por lista de arquivos.
// Trava de FONTE porque os serviços puxam `firebaseConfig` (`import.meta.env`)
// e não carregam no jest.
// ============================================================================
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

const RAIZ = join(__dirname, '..');

function varrer(dir: string): string[] {
    const out: string[] = [];
    for (const nome of readdirSync(dir)) {
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) out.push(...varrer(p));
        else if (/\.ts$/.test(nome) && !/\.d\.ts$/.test(nome)) out.push(p);
    }
    return out;
}

interface Chamada {
    arquivo: string;
    linha: number;
    trecho: string;
    temMaxDocs: boolean;
}

/**
 * Toda CHAMADA `fetchAllDocs(...)` do arquivo (a declaração da função em
 * firestorePaginate.ts não é chamada). Lê pelo AST: o trecho é a expressão
 * inteira, mesmo quando quebra em várias linhas.
 *
 * `maxDocs` conta quando está no objeto de opções (3º argumento) — literal
 * `{ maxDocs: ... }` ou variável cujo inicializador o carrega.
 */
function chamadasFetchAllDocs(arquivo: string): Chamada[] {
    const fonte = readFileSync(arquivo, 'utf8');
    const sf = ts.createSourceFile(arquivo, fonte, ts.ScriptTarget.Latest, true);
    const variaveis = new Map<string, ts.Expression>();
    function coletar(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            variaveis.set(node.name.text, node.initializer);
        }
        ts.forEachChild(node, coletar);
    }
    coletar(sf);
    function carregaMaxDocs(arg: ts.Expression | undefined): boolean {
        if (!arg) return false;
        if (ts.isObjectLiteralExpression(arg)) {
            return arg.properties.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === 'maxDocs');
        }
        if (ts.isIdentifier(arg) && variaveis.has(arg.text)) return carregaMaxDocs(variaveis.get(arg.text));
        return false;
    }
    const achados: Chamada[] = [];
    function visitar(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(sf) === 'fetchAllDocs') {
            achados.push({
                arquivo: arquivo.replace(RAIZ + '/', ''),
                linha: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
                trecho: node.getText(sf),
                temMaxDocs: carregaMaxDocs(node.arguments[2]),
            });
        }
        ts.forEachChild(node, visitar);
    }
    visitar(sf);
    return achados;
}

const arquivos = varrer(join(RAIZ, 'services'));
const chamadas = arquivos.flatMap(chamadasFetchAllDocs);

describe('a varredura enxerga o que deve enxergar', () => {
    it('acha as chamadas de fetchAllDocs em services/ — senão não prova nada', () => {
        // Guarda da própria trava: varredura que não casa com nada passa em
        // silêncio para sempre.
        expect(chamadas.length).toBeGreaterThanOrEqual(20);
        expect(new Set(chamadas.map((c) => c.arquivo)).size).toBeGreaterThanOrEqual(10);
    });
});

describe('🚨 toda chamada de fetchAllDocs declara o próprio teto (maxDocs)', () => {
    it('nenhuma chamada em services/ fica no teto mudo (default)', () => {
        const semTeto = chamadas.filter((c) => !c.temMaxDocs);
        if (semTeto.length) {
            // Nomeia os culpados: trava vermelha sem dizer ONDE só custa tempo.
            console.error('fetchAllDocs SEM maxDocs:\n' + semTeto
                .map((c) => `  ${c.arquivo}:${c.linha}\n    ${c.trecho.replace(/\s+/g, ' ')}`)
                .join('\n'));
        }
        expect(semTeto.map((c) => `${c.arquivo}:${c.linha}`)).toEqual([]);
    });
});

describe('quem alimenta TELA expõe o truncamento', () => {
    const fonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

    it('listarTarefas aceita out-param `meta` e o preenche com o truncamento da leitura', () => {
        const src = fonte('services/tarefasService.ts');
        const corpo = src.slice(src.indexOf('export async function listarTarefas'));
        const fn = corpo.slice(0, corpo.indexOf('\nexport '));
        expect(fn).toMatch(/meta\?: \{ truncado\?: boolean \}/);
        expect(fn).toMatch(/meta\.truncado = /);
    });

    it('a tela de Tarefas LÊ o truncamento (passa `meta` ao listarTarefas) e avisa quando o teto cortou', () => {
        const src = fonte('components/Tarefas.tsx');
        // Fato 1: a chamada da tela passa um segundo argumento (o out-param).
        const chamadas = [...src.matchAll(/await listarTarefas\(([^)]*)\)/g)].map((m) => m[1]);
        expect(chamadas.length).toBeGreaterThan(0);
        for (const args of chamadas) expect(args.split(',').length).toBeGreaterThanOrEqual(2);
        // Fato 2: o truncamento vira estado da tela e o teto aparece no aviso.
        expect(src).toMatch(/\.truncado === true/);
        expect(src).toMatch(/TETO_TAREFAS/);
    });

    it('getNotasDaEmpresa aceita out-param `meta` e o preenche com o truncamento da leitura', () => {
        const src = fonte('services/simplesNacionalService.ts');
        const corpo = src.slice(src.indexOf('export const getNotasDaEmpresa'));
        const fn = corpo.slice(0, corpo.indexOf('\n};') + 3);
        expect(fn).toMatch(/meta\?: \{ truncado\?: boolean \}/);
        expect(fn).toMatch(/meta\.truncado = /);
    });

    it('a estatística client-side de NFS-e (resumoNfseSpCapturadas) devolve `truncado` e `limite`', () => {
        const src = fonte('services/nfseSpCapturadasService.ts');
        const corpo = src.slice(src.indexOf('export async function resumoNfseSpCapturadas'));
        const fn = corpo.slice(0, corpo.indexOf('\n}\n') + 3);
        // Tipo de retorno carrega os dois campos...
        expect(fn).toMatch(/truncado: boolean;/);
        expect(fn).toMatch(/limite: number;/);
        // ...e TODO retorno os preenche (sem Firebase, leitura feita, catch).
        const retornos = fn.match(/return \{[\s\S]*?\};/g) || [];
        expect(retornos.length).toBeGreaterThanOrEqual(3);
        for (const r of retornos) {
            expect(r).toMatch(/truncado:/);
            expect(r).toMatch(/limite:/);
        }
    });
});

// ============================================================================
// POLLING RESPEITA A ABA: aba escondida não bate no servidor a cada N segundos;
// ao voltar para a aba, renova na hora. Padrão de `CronCapturaBanner.tsx`.
//
// Trava de FONTE: o efeito com `setInterval` não é observável barato num
// render test (fake timers + mock de fetch + estado de visibilidade do jsdom
// por componente). O que se cobra é o FATO: dentro de CADA `useEffect` que
// arma `setInterval`, há a checagem de `visibilityState` e a escuta de
// `visibilitychange`.
// ============================================================================
describe('polling só com a aba visível', () => {
    const COMPONENTES = [
        'components/SpConnect/index.tsx',
        'components/CapturaDiagnosticoPanel.tsx',
        'components/VencimentosBanner.tsx',
        'components/CronCapturaBanner.tsx',
    ];

    function efeitosComIntervalo(rel: string): string[] {
        const fonte = readFileSync(join(RAIZ, rel), 'utf8');
        const sf = ts.createSourceFile(rel, fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const efeitos: string[] = [];
        function visitar(node: ts.Node) {
            if (ts.isCallExpression(node) && node.expression.getText(sf) === 'useEffect') {
                const texto = node.getText(sf);
                if (/setInterval\(/.test(texto)) efeitos.push(texto);
            }
            ts.forEachChild(node, visitar);
        }
        visitar(sf);
        return efeitos;
    }

    it.each(COMPONENTES)('%s: todo useEffect com setInterval checa a aba e escuta visibilitychange', (rel) => {
        const efeitos = efeitosComIntervalo(rel);
        // Fixture tem de ALCANÇAR o ramo: sem efeito com intervalo, não há o que provar.
        expect(efeitos.length).toBeGreaterThan(0);
        for (const efeito of efeitos) {
            expect(efeito).toMatch(/visibilityState/);
            expect(efeito).toMatch(/addEventListener\('visibilitychange'/);
            expect(efeito).toMatch(/removeEventListener\('visibilitychange'/);
        }
    });
});
