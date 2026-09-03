// ============================================================================
// 🔒 TODA REGRA DO FIRESTORE APONTA PARA UMA COLEÇÃO QUE EXISTE — e coleção
// que só o backend lê NÃO fica aberta ao navegador.
//
// 04/09 (auditoria): `firestore.rules` tinha um bloco para `darf_emitidos`,
// coleção que NUNCA existiu (o orquestrador grava em `darfs_emitidos`), e
// oito coleções operacionais liberavam `get`/`list` a qualquer usuário logado
// sem que UM código de cliente as lesse pelo SDK web — quem lê é o backend, por
// rota, com o escopo da carteira conferido lá. Regra aberta sem leitor é
// superfície sem dono: ninguém a usa, ninguém a revisa, e ela envelhece com o
// dado exposto.
//
// Duas travas aqui:
//   1. todo `match /<col>/` das rules aponta para coleção do catálogo
//      (`catalogo-banco.js`) ou citada no código de cliente — o bloco morto
//      não volta;
//   2. as coleções que este PR fechou continuam fechadas, e a lista de
//      exceções (Legalização, que é APP PRÓPRIO com rules publicadas DAQUI)
//      carrega o motivo.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// @ts-expect-error — módulo .js puro sem .d.ts
import { CATALOGO_BANCO } from '../sefaz-backend/catalogo-banco.js';

const RAIZ = join(__dirname, '..');
const rules = readFileSync(join(RAIZ, 'firestore.rules'), 'utf8');

/**
 * Coleções com bloco nas rules que NÃO estão no catálogo do CFI nem no código
 * de cliente deste repo — cada uma com o motivo. Sem motivo não entra.
 */
const EXCECOES: Record<string, string> = {
    // 📋 Legalização é APP PRÓPRIO (repo `legaliza-o`, mesmo Firestore) e as
    // rules dele são publicadas DESTE repo (deploy-firestore.yml) — o código
    // que lê/grava mora lá. Apagar aqui derrubaria o app irmão.
    legalizacao_vencimentos: 'app Legalização (repo próprio, mesmo Firestore) — rules publicadas daqui',
    legalizacao_processos: 'app Legalização (repo próprio, mesmo Firestore) — rules publicadas daqui',
    legalizacao_alertas: 'app Legalização (repo próprio, mesmo Firestore) — rules publicadas daqui',
    legalizacao_cron_logs: 'app Legalização (repo próprio, mesmo Firestore) — rules publicadas daqui',
};

function varrer(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (['node_modules', 'dist'].includes(nome) || nome.startsWith('.')) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) varrer(p, out);
        else if (/\.(ts|tsx|js)$/.test(nome) && !nome.endsWith('.d.ts')) out.push(p);
    }
    return out;
}

/** Nomes de coleção (1º segmento) de todo `match /<col>/…` das rules. */
function colecoesNasRules(): string[] {
    const nomes = new Set<string>();
    for (const m of rules.matchAll(/match\s+\/([a-z][a-z0-9_]*)\//g)) nomes.add(m[1]);
    // `match /databases/{database}/documents` é o envelope das rules, não coleção.
    nomes.delete('databases');
    nomes.delete('documents');
    return [...nomes];
}

describe('🔒 firestore.rules só descreve coleção que existe', () => {
    const catalogo = new Set<string>(CATALOGO_BANCO.map((c: any) => c.colecao));
    const cliente = [
        ...varrer(join(RAIZ, 'components')),
        ...varrer(join(RAIZ, 'services')),
        ...varrer(join(RAIZ, 'hooks')),
        join(RAIZ, 'App.tsx'),
    ].map((p) => readFileSync(p, 'utf8')).join('\n');
    const nasRules = colecoesNasRules();

    it('a varredura enxerga as rules (trava vazia é trava falsa)', () => {
        expect(nasRules.length).toBeGreaterThan(40);
        expect(catalogo.size).toBeGreaterThan(50);
    });

    it('todo bloco das rules aponta para coleção do catálogo, do cliente, ou declarada com motivo', () => {
        const orfas = nasRules.filter((col) => {
            if (EXCECOES[col]) return false;
            if (catalogo.has(col)) return false;
            // Citada como string no código de cliente (subcoleção, coleção nova
            // ainda fora do catálogo — o catalogoBanco.test.ts cobra o resto).
            return !new RegExp(`['"\`]${col}['"\`]`).test(cliente);
        });
        if (orfas.length) {
            throw new Error(
                '\n\n🚧 REGRA PARA COLEÇÃO QUE NINGUÉM USA\n\n'
                + orfas.map((x) => `  · match /${x}/`).join('\n')
                + '\n\nOu a coleção existe e falta no catálogo (sefaz-backend/catalogo-banco.js), ou\n'
                + 'o bloco é morto (como o `darf_emitidos` de 04/09 — o real é `darfs_emitidos`).\n'
                + 'Bloco morto sai; exceção legítima entra em EXCECOES COM o motivo.\n',
            );
        }
        expect(orfas).toEqual([]);
    });

    it('o bloco morto de 04/09 não volta', () => {
        expect(rules).not.toMatch(/match\s+\/darf_emitidos\//);
    });

    it('toda exceção tem motivo escrito e continua existindo nas rules', () => {
        for (const [col, motivo] of Object.entries(EXCECOES)) {
            expect({ col, temMotivo: motivo.trim().length >= 8 }).toEqual({ col, temMotivo: true });
            expect({ col, nasRules: nasRules.includes(col) }).toEqual({ col, nasRules: true });
        }
    });
});

describe('🔒 coleção que só o backend lê fica FECHADA ao navegador', () => {
    /** Fechadas em 04/09 — nenhum `collection(db, …)`/`doc(db, …)` de cliente as lê. */
    const FECHADAS = [
        'caixa_postal_mensagens', 'das_emitidos', 'pgdas_sem_movimento', 'fechamentos_competencia',
        'nfse_nacional_emitidas', 'dctfweb_declaracoes', 'notificacoes', 'produtores_rurais',
    ];

    const bloco = (col: string): string => {
        const m = rules.match(new RegExp(`match\\s+/${col}/\\{[^}]*\\}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
        if (!m) throw new Error(`bloco de ${col} não encontrado nas rules`);
        return m[1];
    };

    it.each(FECHADAS)('%s: allow read: if false', (col) => {
        expect(bloco(col)).toMatch(/allow read:\s*if false;/);
        expect(bloco(col)).not.toMatch(/allow (get|list):/);
    });

    it('e continua sendo verdade que nenhum código de cliente as lê pelo SDK web', () => {
        const cliente = [
            ...varrer(join(RAIZ, 'components')),
            ...varrer(join(RAIZ, 'services')),
            ...varrer(join(RAIZ, 'hooks')),
            join(RAIZ, 'App.tsx'),
        ].map((p) => readFileSync(p, 'utf8')).join('\n');
        for (const col of FECHADAS) {
            // collection(db, 'x') · doc(db, 'x', …) · collectionGroup(db, 'x')
            const leitura = new RegExp(`(collection|doc|collectionGroup)\\(\\s*db\\s*,\\s*['"\`]${col}['"\`]`);
            expect({ col, lidaNoCliente: leitura.test(cliente) }).toEqual({ col, lidaNoCliente: false });
        }
    });
});
