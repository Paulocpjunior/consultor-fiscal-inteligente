// ============================================================================
// 🚨 A CLASSE QUE A CASA DECLAROU FECHADA — E NÃO ESTAVA
//
// `empresa-por-cnpj.js` nasceu em 07/08 porque o cadastro guarda o CNPJ em
// DUAS formas (`51227692000146` e `51.227.692/0001-46`), e o comentário dele
// AFIRMA: "Nenhuma outra rota do CFI consulta por igualdade".
//
// A varredura de 22/08 achou OITO pontos consultando por igualdade, seis deles
// SEM fallback nenhum — e cada um com um jeito próprio de errar em silêncio:
//
//  · `xml-importer` → documento fica SEM DONO, invisível em qualquer filtro
//    por cliente (é o caso GUARANI, 27/07);
//  · os quatro `toggle` (captura SEFAZ e NFS-e Nacional) → **404 "Empresa não
//    encontrada"** para empresa que ESTÁ cadastrada, mandando a pessoa
//    consertar um cadastro que está certo. É literalmente o defeito que fez o
//    módulo pure nascer, ressuscitado em outros quatro arquivos;
//  · a captura dirigida → cliente reportado em `naoEncontrados`.
//
// ⚠️ E o `where('cnpj','in',[…])` é o MESMO defeito em roupa de lote: filtra
// ANTES de normalizar, então o replace que vem depois só vê o que já passou.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
    acharEmpresaCadastrada, acharEmpresasCadastradas, limparCacheCadastro,
// @ts-expect-error — módulo backend .js sem .d.ts
} from '../sefaz-backend/empresa-cadastro-lookup.js';

const RAIZ = join(__dirname, '..');

/** Firestore de mentira: conta leituras para provar o cache. */
function fakeDb(docsPorColecao: Record<string, Array<{ id: string; cnpj?: string; _deleted?: boolean; _merged_into?: string }>>) {
    const contas = { igualdade: 0, varredura: 0 };
    const db = {
        collection(col: string) {
            const docs = docsPorColecao[col] || [];
            const asSnap = (lista: typeof docs) => ({
                empty: lista.length === 0,
                docs: lista.map(d => ({ id: d.id, data: () => ({ ...d }) })),
                forEach(fn: (d: any) => void) { this.docs.forEach(fn); },
            });
            return {
                where(_campo: string, _op: string, valor: string) {
                    return {
                        limit() {
                            return {
                                async get() {
                                    contas.igualdade++;
                                    return asSnap(docs.filter(d => d.cnpj === valor).slice(0, 1));
                                },
                            };
                        },
                    };
                },
                select() {
                    return {
                        async get() { contas.varredura++; return asSnap(docs); },
                    };
                },
            };
        },
    };
    return { db, contas };
}

const CADASTRO = {
    simples_empresas: [
        { id: 'sim1', cnpj: '31947349000169' },                 // dígitos
        { id: 'sim2', cnpj: '51.227.692/0001-46' },              // MASCARADO
        { id: 'sim3', cnpj: '11.111.111/1111-11', _deleted: true },
    ],
    lucro_empresas: [
        { id: 'luc1', cnpj: '44388152000189' },
        { id: 'luc2', cnpj: '22.222.222/2222-22', _merged_into: 'luc1' },
    ],
};

describe('🚨 achar empresa no cadastro — as DUAS formas', () => {
    beforeEach(() => limparCacheCadastro());

    it('acha pelo caminho rápido quando o CNPJ está em dígitos', async () => {
        const { db, contas } = fakeDb(CADASTRO);
        expect(await acharEmpresaCadastrada(db, '31.947.349/0001-69'))
            .toEqual({ empresaId: 'sim1', colecao: 'simples_empresas', cnpj: '31947349000169' });
        // Não precisou varrer nada.
        expect(contas.varredura).toBe(0);
    });

    // 🔴 É ESTE o caso que a igualdade sozinha perdia — e o efeito nunca era
    // um erro: era "não encontrada", indistinguível de "não é cliente".
    it('acha o CNPJ MASCARADO, que a igualdade nunca enxergava', async () => {
        const { db } = fakeDb(CADASTRO);
        expect(await acharEmpresaCadastrada(db, '51227692000146'))
            .toEqual({ empresaId: 'sim2', colecao: 'simples_empresas', cnpj: '51227692000146' });
    });

    it('acha na segunda coleção também', async () => {
        const { db } = fakeDb(CADASTRO);
        const r = await acharEmpresaCadastrada(db, '44.388.152/0001-89');
        expect(r.colecao).toBe('lucro_empresas');
    });

    // Regra do soft-delete (#290): empresa excluída não é "encontrada", e a
    // fundida responde pela outra. Duas varreduras antigas ignoravam isso.
    it('LÁPIDE fica de fora — excluída e fundida não respondem', async () => {
        const { db } = fakeDb(CADASTRO);
        expect(await acharEmpresaCadastrada(db, '11111111111111')).toBeNull();
        expect(await acharEmpresaCadastrada(db, '22222222222222')).toBeNull();
    });

    it('CNPJ que não é de cliente devolve null — e o negativo fica em cache', async () => {
        const { db, contas } = fakeDb(CADASTRO);
        expect(await acharEmpresaCadastrada(db, '99999999999999')).toBeNull();
        const varredurasPrimeira = contas.varredura;
        expect(varredurasPrimeira).toBeGreaterThan(0);
        expect(await acharEmpresaCadastrada(db, '99999999999999')).toBeNull();
        // Sem cache do negativo, cada CNPJ de terceiro custaria uma varredura
        // POR DOCUMENTO numa paginação de captura.
        expect(contas.varredura).toBe(varredurasPrimeira);
    });

    it('CNPJ fora de 14 dígitos nem consulta', async () => {
        const { db, contas } = fakeDb(CADASTRO);
        expect(await acharEmpresaCadastrada(db, '123')).toBeNull();
        expect(contas.igualdade + contas.varredura).toBe(0);
    });

    it('em LOTE, o mascarado entra — o where(in) filtrava antes de normalizar', async () => {
        const { db } = fakeDb(CADASTRO);
        const mapa = await acharEmpresasCadastradas(db, [
            '31947349000169', '51227692000146', '99999999999999',
        ]);
        expect([...mapa.keys()].sort()).toEqual(['31947349000169', '51227692000146']);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// A trava: consulta ao cadastro por igualdade de CNPJ quebra a build.
// A regra estava escrita desde 07/08 e nunca teve varredura — foi por isso
// que ela reapareceu em seis arquivos.
// ═══════════════════════════════════════════════════════════════════════════
const PERMITIDO: Record<string, string> = {
    'sefaz-backend/empresa-cadastro-lookup.js': 'é o DONO — o caminho rápido mora aqui',
};

function varrer(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (['node_modules', 'dist', '.git'].includes(nome) || nome.startsWith('.')) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) varrer(p, out);
        else if (nome.endsWith('.js')) out.push(p);
    }
    return out;
}

describe('🚨 ninguém volta a consultar o cadastro por igualdade de CNPJ', () => {
    it('nenhum where(cnpj, ==|in) fora do dono', () => {
        const infratores: string[] = [];
        const arquivos = [...varrer(join(RAIZ, 'sefaz-backend')), join(RAIZ, 'server.js')];
        for (const arquivo of arquivos) {
            const rel = relative(RAIZ, arquivo).replace(/\\/g, '/');
            if (PERMITIDO[rel]) continue;
            readFileSync(arquivo, 'utf8').split('\n').forEach((linha, i) => {
                const semComentario = linha.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
                if (/\.where\(\s*['"]cnpj['"]\s*,\s*['"](==|in)['"]/.test(semComentario)) {
                    infratores.push(`${rel}:${i + 1}  ${linha.trim().slice(0, 90)}`);
                }
            });
        }
        if (infratores.length) {
            throw new Error(
                '\n\n🚧 CONSULTA AO CADASTRO POR IGUALDADE DE CNPJ\n\n'
                + infratores.map((x) => `  · ${x}`).join('\n')
                + '\n\nO cadastro guarda o CNPJ em DUAS formas (51227692000146 e\n'
                + '51.227.692/0001-46). Igualdade casa com uma e ignora a outra — e o\n'
                + 'resultado nunca é um erro: é "não encontrada", que manda a pessoa\n'
                + 'consertar um cadastro que está certo (07/08, caso do R-4020).\n\n'
                + 'Use `acharEmpresaCadastrada(db, cnpj)` (ou a versão em lote) de\n'
                + '`sefaz-backend/empresa-cadastro-lookup.js`.\n',
            );
        }
    });

    // O comentário de `empresa-por-cnpj.js` afirmava que a classe estava
    // fechada. Agora ela é fechada por TRAVA, e o texto diz onde.
    it('e o módulo puro aponta para a casca que fala com o Firestore', () => {
        const fonte = readFileSync(join(RAIZ, 'sefaz-backend', 'empresa-por-cnpj.js'), 'utf8');
        expect(fonte).toContain('empresa-cadastro-lookup');
    });
});
