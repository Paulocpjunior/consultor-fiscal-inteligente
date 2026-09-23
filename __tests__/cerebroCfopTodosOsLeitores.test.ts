/**
 * 🧠 O CÉREBRO DO CFOP CHEGA A TODOS OS LEITORES — e a lista de leitores se MEDE.
 *
 * O cérebro (`cfop_parametros`, 18/08) é a decisão humana numa nota virando
 * parâmetro do FORNECEDOR para as competências seguintes. A régua que o aplica
 * é ÚNICA (`cfopDoLancamento`: NF > cérebro > override da empresa > régua), e o
 * teste de 18/08 prova a régua. O que ninguém tinha medido é QUEM ENTREGA os
 * parâmetros à régua — e a varredura de 07/09 achou que era UM lugar: a aba
 * ✏️ CFOP por nota. O SPED (C170/C190/E510, nas duas famílias), o Exportar SAGE
 * (.FML e preflight), a conferência de correlação, o Livro de Entradas, o
 * Resumo por CFOP e o Por produto montavam o contexto SEM `parametrosCfop`.
 *
 * O sintoma não era erro nenhum: a pessoa ensinava o fornecedor, via o
 * parâmetro na aba ✏️ — e o Livro ao lado, o .FML e o arquivo do SPED saíam
 * pela régua automática. É a "flag que ninguém lê" (04/09) no CFOP, e a
 * "conferência que promete número diferente do arquivo" (12/08) na tela onde a
 * pessoa CONFIRMA a decisão.
 *
 * Trava em três camadas:
 *   1. VARREDURA: todo contexto de CFOP (literal com `cfopOverrides:`) carrega
 *      `parametrosCfop`. Exceção só com motivo escrito.
 *   2. LIGAÇÃO: os dois orquestradores LEEM a coleção e o bloco C a RECEBE.
 *   3. COMPORTAMENTO: o wrapper do SPED, a régua do SAGE e a conferência
 *      devolvem o CFOP do cérebro quando o parâmetro existe — provado
 *      chamando as funções, nunca lendo o fonte.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { conferirCorrelacaoCfop } from '../services/cfopConferencia';
import { cfopParaEscriturar } from '../services/iobSageExportService';
// @ts-expect-error — módulo backend .js sem .d.ts (o mesmo import de centralDocumentosDirecao)
import { convertCfopParaEntrada } from '../sefaz-backend/sped-fiscal-blocoC.js';
import {
    lerParametrosCfopDaEmpresa, parametrosAtivos, avisoParametrosCfop,
} from '../sefaz-backend/cfop-parametros-store.js';
import type { DocumentoFiscal } from '../types';

const RAIZ = join(__dirname, '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

// ─── fixtures (CNPJ fictício — dado de cliente nunca entra no repo) ─────────
const FORN = '11222333000181';
const PARAM = {
    cnpjFornecedor: FORN, cfopOrigem: '5102', cfopDestino: '1556',
    vigenciaInicio: '2026-07', ativo: true, criadoPor: 'colab@sp.com.br', criadoEm: '2026-07-10',
};
const nota = (over: Record<string, unknown> = {}) => ({
    id: 'd', direcao: 'entrada', chave: '3'.repeat(44), numero: '1', serie: '1',
    cnpjEmit: FORN, competencia: '2026-08',
    itens: [{ cProd: 'P0', cfop: '5102', vProd: 100 }],
    ...over,
}) as unknown as DocumentoFiscal;

// ═══ 1. VARREDURA — todo contexto de CFOP carrega o cérebro ══════════════════
const PASTAS = ['components', 'services', 'sefaz-backend'];
/** Literais com `cfopOverrides:` que NÃO são contexto de régua — com o motivo. */
const NAO_SAO_CONTEXTO: Record<string, string> = {
    'services/xmlFiscalService.ts': 'projeção do CADASTRO (getDadosFiscaisEmpresa) — quem monta o contexto é quem a consome',
    'components/CfopCorrelacaoModal.tsx': 'payload de GRAVAÇÃO do cadastro (handleSalvar) — não alimenta régua nenhuma',
};

function arquivos(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) {
            if (nome === 'node_modules' || nome === '__tests__') continue;
            arquivos(p, out);
        } else if (/\.(ts|tsx|js)$/.test(nome) && !/\.d\.ts$/.test(nome) && !/\.test\./.test(nome)) {
            out.push(p);
        }
    }
    return out;
}

/** Só comentário de LINHA e linhas de bloco iniciadas com `*` — nunca regex de bloco (lição de 26/08). */
const semComentario = (src: string) => src.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

/** O literal `{ … }` que contém a posição `i` (parênteses e chaves balanceados, ignorando strings). */
function literalEmVolta(src: string, i: number): string | null {
    let prof = 0;
    let ini = -1;
    for (let k = i; k >= 0; k--) {
        const c = src[k];
        if (c === '}') prof++;
        else if (c === '{') {
            if (prof === 0) { ini = k; break; }
            prof--;
        }
    }
    if (ini < 0) return null;
    prof = 0;
    for (let k = ini; k < src.length; k++) {
        const c = src[k];
        if (c === '{') prof++;
        else if (c === '}') { prof--; if (prof === 0) return src.slice(ini, k + 1); }
    }
    return null;
}

function contextosSemCerebro(): string[] {
    const faltando: string[] = [];
    const donos = new Set(['sefaz-backend/cfop-correlacao.js', 'sefaz-backend/cfop-cerebro.js', 'sefaz-backend/cfop-parametros-store.js']);
    for (const pasta of PASTAS) {
        for (const abs of arquivos(join(RAIZ, pasta))) {
            const rel = relative(RAIZ, abs).replace(/\\/g, '/');
            if (donos.has(rel) || NAO_SAO_CONTEXTO[rel]) continue;
            const src = semComentario(readFileSync(abs, 'utf8'));
            const re = /cfopOverrides\s*:/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(src))) {
                const lit = literalEmVolta(src, m.index);
                if (!lit) { faltando.push(`${rel} (literal ilegível)`); continue; }
                if (!/parametrosCfop/.test(lit)) {
                    const linha = src.slice(0, m.index).split('\n').length;
                    faltando.push(`${rel}:${linha}`);
                }
            }
        }
    }
    return faltando;
}

describe('🧠 varredura — todo contexto de CFOP entrega o cérebro à régua', () => {
    it('nenhum literal com `cfopOverrides:` fica sem `parametrosCfop` (fora das exceções declaradas)', () => {
        expect(contextosSemCerebro()).toEqual([]);
    });

    it('toda exceção declarada existe no repo e tem motivo escrito', () => {
        for (const [rel, motivo] of Object.entries(NAO_SAO_CONTEXTO)) {
            expect(statSync(join(RAIZ, rel)).isFile()).toBe(true);
            expect(motivo.length).toBeGreaterThan(20);
            // Exceção órfã envelhece dizendo que cobre algo que já não existe.
            expect(semComentario(ler(rel))).toMatch(/cfopOverrides\s*:/);
        }
    });

    it('a varredura lê arquivos de verdade (guarda contra o silêncio falso)', () => {
        const total = PASTAS.reduce((n, p) => n + arquivos(join(RAIZ, p)).length, 0);
        expect(total).toBeGreaterThan(50);
        // E ela PEGA: o literal antigo do SAGE, sem o cérebro, é acusado.
        const src = "setCfopCtx({ naturezaAtividade: nat.natureza, cfopOverrides: df?.cfopOverrides });";
        const lit = literalEmVolta(src, src.indexOf('cfopOverrides'));
        expect(lit).not.toMatch(/parametrosCfop/);
    });
});

// ═══ 2. LIGAÇÃO — quem lê a coleção e quem recebe ════════════════════════════
describe('🔌 os dois orquestradores LEEM o cérebro e o bloco C o RECEBE', () => {
    it.each([
        'sefaz-backend/sped-fiscal-orchestrator.js',
        'sefaz-backend/sped-contrib-orchestrator.js',
    ])('%s lê `cfop_parametros` pela store, avisa na falha e devolve `parametrosCfop`', (rel) => {
        const f = semComentario(ler(rel));
        expect(f).toMatch(/lerParametrosCfopDaEmpresa\(db, empresaId\)/);
        // Falha de leitura vira AVISO — nunca "não há parâmetro" em silêncio.
        expect(f).toMatch(/warnings\.push\(avisoParametrosCfop\(/);
        // O campo sai no objeto `dados` que os blocos recebem.
        expect(f).toMatch(/^\s*parametrosCfop,\s*$/m);
    });

    it('o wrapper do bloco C passa `dados.parametrosCfop` à régua', () => {
        expect(semComentario(ler('sefaz-backend/sped-fiscal-blocoC.js')))
            .toMatch(/parametrosCfop:\s*dados\?\.parametrosCfop/);
    });

    it('o Exportar SAGE carrega os parâmetros JUNTO do cadastro (um contexto para .FML, preflight e conferência)', () => {
        const f = semComentario(ler('components/xml/XmlExportarIobSage.tsx'));
        expect(f).toMatch(/lerParametrosCfop\(empresaSelecionada\.id\)/);
        expect(f).toMatch(/setCfopCtx\(\{[\s\S]{0,300}parametrosCfop:/);
    });

    it('a conferência de correlação passa o DOCUMENTO à régua (senão NF e cérebro são ignorados)', () => {
        const f = semComentario(ler('services/cfopConferencia.ts'));
        expect(f).toMatch(/cfopParaEscriturar\(origem, 'entrada', ctx, d, it\)/);
        expect(f).not.toMatch(/cfopParaEscriturar\(origem, 'entrada', ctx\)/);
    });

    it('em Relatórios o pai carrega uma vez e as quatro abas recebem por prop', () => {
        const f = semComentario(ler('components/Relatorios/index.tsx'));
        expect(f).toMatch(/lerParametrosCfop\(alvo\.id\)/);
        for (const aba of ['AbaLivro', 'AbaCfop', 'AbaCfopPorNota', 'AbaProduto']) {
            // `[^>]*`: os props podem quebrar linha — o que não pode é fechar a tag antes.
            expect(f).toMatch(new RegExp(`<${aba} [^>]*parametrosCfop=\\{parametrosCfop\\}`));
        }
        // A ✏️ grava — e o que ela grava sobe para o pai.
        expect(f).toMatch(/onParametrosMudou=\{setParametrosCfop\}/);
    });
});

// ═══ 3. COMPORTAMENTO — provado chamando, nunca lendo ════════════════════════
describe('🧠 o CFOP do cérebro sai em cada leitor', () => {
    const empresa = { dadosFiscais: { naturezaAtividade: 'comercio' } };

    it('SPED: `convertCfopParaEntrada` honra o parâmetro quando `dados.parametrosCfop` chega', () => {
        const comCerebro = convertCfopParaEntrada('5102', 'entrada', { empresa, parametrosCfop: [PARAM] }, nota());
        const semCerebro = convertCfopParaEntrada('5102', 'entrada', { empresa }, nota());
        expect(comCerebro).toBe('1556');
        expect(semCerebro).toBe('1102');   // a régua automática continua valendo sem ele
    });

    it('SPED: parâmetro DESLIGADO não decide (desligar não apaga, mas não escritura)', () => {
        const dados = { empresa, parametrosCfop: [{ ...PARAM, ativo: false }] };
        expect(convertCfopParaEntrada('5102', 'entrada', dados, nota())).toBe('1102');
    });

    it('SPED: a vigência NÃO retroage — competência anterior ao parâmetro fica com a régua', () => {
        const dados = { empresa, parametrosCfop: [PARAM] };
        expect(convertCfopParaEntrada('5102', 'entrada', dados, nota({ competencia: '2026-06' }))).toBe('1102');
    });

    it('SAGE (.FML/preflight): `cfopParaEscriturar` honra o cérebro pelo contexto', () => {
        const ctx = { naturezaAtividade: 'comercio', parametrosCfop: [PARAM] };
        expect(cfopParaEscriturar('5102', 'entrada', ctx, nota(), null)).toBe('1556');
        expect(cfopParaEscriturar('5102', 'entrada', { naturezaAtividade: 'comercio' }, nota(), null)).toBe('1102');
    });

    it('conferência: NF informada vence tudo e sai NOMEADA como decisão da nota', () => {
        const r = conferirCorrelacaoCfop([nota({ cfopEscriturado: '1551', cfopEscrituradoPor: 'colab@sp.com.br' })], {
            naturezaAtividade: 'comercio', parametrosCfop: [PARAM],
        });
        expect(r.linhas).toHaveLength(1);
        expect(r.linhas[0].destino).toBe('1551');
        expect(r.linhas[0].motivo).toBe('nota');
        expect(r.linhas[0].conferir).toBe(false);
        expect(r.linhas[0].explicacao).toMatch(/informado nesta NF/);
        expect(r.linhas[0].explicacao).toMatch(/colab@sp\.com\.br/);
    });

    it('conferência: o cérebro decide e sai NOMEADO com o rótulo do parâmetro', () => {
        const r = conferirCorrelacaoCfop([nota()], { naturezaAtividade: 'comercio', parametrosCfop: [PARAM] });
        expect(r.linhas[0].destino).toBe('1556');
        expect(r.linhas[0].motivo).toBe('cerebro');
        expect(r.linhas[0].conferir).toBe(false);
        expect(r.linhas[0].explicacao).toMatch(/🧠/);
    });

    it('conferência: sem NF e sem cérebro, nada muda (régua automática, motivo de sempre)', () => {
        const r = conferirCorrelacaoCfop([nota()], { naturezaAtividade: 'comercio' });
        expect(r.linhas[0].destino).toBe('1102');
        expect(r.linhas[0].motivo).toBe('natureza');
    });

    it('conferência: fornecedor DIFERENTE do parâmetro não é tocado', () => {
        const r = conferirCorrelacaoCfop([nota({ cnpjEmit: '99888777000166' })], {
            naturezaAtividade: 'comercio', parametrosCfop: [PARAM],
        });
        expect(r.linhas[0].destino).toBe('1102');
        expect(r.linhas[0].motivo).toBe('natureza');
    });
});

// ═══ 4. A STORE — leitura pelo admin SDK, falha DITA ═════════════════════════
describe('📦 cfop-parametros-store', () => {
    const fakeDb = (docs: Array<Record<string, unknown>>, falha?: Error) => ({
        collection: (nome: string) => ({
            where: (campo: string, op: string, valor: string) => ({
                get: async () => {
                    if (falha) throw falha;
                    expect(nome).toBe('cfop_parametros');
                    expect([campo, op]).toEqual(['empresaId', '==']);
                    return { docs: docs.filter((d) => d.empresaId === valor).map((d) => ({ id: String(d.id), data: () => d })) };
                },
            }),
        }),
    });

    it('devolve só os ATIVOS da empresa pedida', async () => {
        const db = fakeDb([
            { id: 'a', empresaId: 'E1', ...PARAM },
            { id: 'b', empresaId: 'E1', ...PARAM, ativo: false },
            { id: 'c', empresaId: 'E2', ...PARAM },
        ]);
        const r = await lerParametrosCfopDaEmpresa(db, 'E1');
        expect(r.erro).toBeNull();
        expect(r.parametros.map((p: any) => p.id)).toEqual(['a']);
    });

    it('falha de leitura vira ERRO NOMEADO com lista vazia — nunca "não há parâmetro" calado', async () => {
        const r = await lerParametrosCfopDaEmpresa(fakeDb([], new Error('PERMISSION_DENIED')), 'E1');
        expect(r.parametros).toEqual([]);
        expect(r.erro).toMatch(/PERMISSION_DENIED/);
        const aviso = avisoParametrosCfop(r.erro);
        expect(aviso).toMatch(/PERMISSION_DENIED/);
        expect(aviso).toMatch(/régua automática/);
        expect(aviso).toMatch(/Gere de novo/);
    });

    it('sem empresa não consulta nada e não é erro', async () => {
        expect(await lerParametrosCfopDaEmpresa(fakeDb([]), '')).toEqual({ parametros: [], erro: null });
        expect(avisoParametrosCfop(null)).toBeNull();
    });

    it('`parametrosAtivos` ignora lixo e desligados', () => {
        expect(parametrosAtivos([PARAM, null, { ...PARAM, ativo: false }, 'x'] as any)).toEqual([PARAM]);
    });
});
