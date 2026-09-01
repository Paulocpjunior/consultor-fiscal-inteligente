// ============================================================================
// 🚨 CAMINHO NOVO NO STORAGE NASCE COM A REGRA — no MESMO PR.
//
// 31/08, Paulo, importando uma NFS-e em PDF da Prefeitura de Santo André:
//
//   "Firebase Storage: User does not have permission to access
//    'nfse_pdfs/6f115ef0-…/…_206.pdf'. (storage/unauthorized)"
//
// A tela `NfsePdfImportacao` gravava em `nfse_pdfs/{empresaId}/{arquivo}` e o
// `storage.rules` só conhecia `/xmls/{empresaId}/{file}` — o caminho caía no
// **default deny**, então NENHUM PDF de NFS-e jamais foi gravado. O código
// estava certo; faltava a permissão, e ela só falha no CLIQUE.
//
// 📌 É a mesma classe do catálogo de coleções (`catalogoBanco.test.ts`, 26/08)
// e da "rota sem botão" (13/08): a entrega parece pronta, e o que falta é a
// linha que ninguém lembra de escrever. Lá foi o Firestore; aqui, o Storage.
//
// ⚠️ E é por VARREDURA, nunca por lista: lista envelhece no primeiro caminho
// novo — e envelhece em SILÊNCIO, que é exatamente como este viveu.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';

const RAIZ = resolve(__dirname, '..');
const PASTAS = ['components', 'services'];

/** Lê os `match /caminho/...` de primeiro nível declarados nas rules. */
function prefixosComRegra(): string[] {
    const rules = readFileSync(join(RAIZ, 'storage.rules'), 'utf8');
    const out: string[] = [];
    for (const m of rules.matchAll(/match\s+\/([A-Za-z0-9_-]+)\//g)) out.push(m[1]);
    return out;
}

function arquivos(dir: string, acc: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        const p = join(dir, nome);
        const st = statSync(p);
        if (st.isDirectory()) { if (nome !== 'node_modules') arquivos(p, acc); continue; }
        if (/\.(ts|tsx)$/.test(nome) && !/\.test\./.test(nome)) acc.push(p);
    }
    return acc;
}

/**
 * Os prefixos de caminho que o CÓDIGO usa.
 *
 * ⚠️ A assinatura é ESTREITA de propósito: só template literal cujo primeiro
 * pedaço é um prefixo seguido de `/`. Casar qualquer string com barra acusaria
 * rota HTTP, caminho de arquivo local e `application/json` — e alarme sobre
 * código certo é o que faz a equipe desligar a trava (a lição de 29/08).
 */
function prefixosUsados(): Array<{ prefixo: string; arquivo: string }> {
    const achados: Array<{ prefixo: string; arquivo: string }> = [];
    for (const pasta of PASTAS) {
        const dir = join(RAIZ, pasta);
        for (const arq of arquivos(dir)) {
            const src = readFileSync(arq, 'utf8');
            // Só arquivos que de fato falam com o Storage.
            if (!/firebase\/storage/.test(src)) continue;
            for (const m of src.matchAll(/(?:storageRef|ref)\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*`([A-Za-z0-9_-]+)\//g)) {
                achados.push({ prefixo: m[1], arquivo: relative(RAIZ, arq) });
            }
            // A forma com variável intermediária: `const path = \`nfse_pdfs/...\``
            for (const m of src.matchAll(/=\s*`([A-Za-z0-9_-]+)\/\$\{/g)) {
                achados.push({ prefixo: m[1], arquivo: relative(RAIZ, arq) });
            }
        }
    }
    return achados;
}

describe('🚨 todo caminho do Storage tem regra', () => {
    it('a varredura enxerga alguma coisa — silêncio falso é pior que trava nenhuma', () => {
        // 🚨 Sem esta guarda, um glob quebrado faria o teste passar VERDE sem
        // ler nada — o defeito que esta casa persegue desde 22/08.
        expect(prefixosUsados().length).toBeGreaterThan(0);
        expect(prefixosComRegra().length).toBeGreaterThan(0);
    });

    it('nenhum caminho usado cai no default deny', () => {
        const comRegra = new Set(prefixosComRegra());
        const fora = prefixosUsados()
            .filter((u) => !comRegra.has(u.prefixo))
            .map((u) => `  · ${u.prefixo}/  (${u.arquivo})`);
        if (fora.length) {
            throw new Error(
                '\n\n🚧 CAMINHO DO STORAGE SEM REGRA\n\n'
                + [...new Set(fora)].join('\n')
                + '\n\nO `storage.rules` termina com um DEFAULT DENY: caminho sem `match` é\n'
                + 'barrado com `storage/unauthorized`, e a falha só aparece no clique do\n'
                + 'colaborador — foi assim que a importação de NFS-e em PDF nunca gravou\n'
                + 'um arquivo (31/08, Santo André).\n\n'
                + 'Escreva o `match` no MESMO PR que cria o caminho.\n',
            );
        }
        expect(fora).toEqual([]);
    });

    // ⚠️ Os dois caminhos de HOJE, nomeados — se um sumir, é porque alguém
    // apagou a regra, e o teste acima só pega o contrário.
    it('os caminhos conhecidos continuam cobertos', () => {
        const comRegra = prefixosComRegra();
        expect(comRegra).toContain('xmls');
        expect(comRegra).toContain('nfse_pdfs');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 REGRA ESCRITA NÃO É REGRA IMPLANTADA — a metade que faltava.
//
// 31/08 a regra do `nfse_pdfs/` foi escrita e o teste acima passou VERDE.
// 01/09 o colaborador levou EXATAMENTE o mesmo `storage/unauthorized`: o
// `firebase.json` declarava `"storage": {"rules": "storage.rules"}` e
// **nenhum workflow publicava o arquivo** — o `deploy-firestore.yml` sobe
// `--only firestore:rules,firestore:indexes` e nem escutava `storage.rules`
// no `paths:`.
//
// 📌 É a mesma classe da trava das Novidades, no mesmo dia: a trava existe,
// roda, passa — e cobre a metade errada. Provar que o CAMINHO tem regra não
// prova nada se a regra não sai daqui.
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 a regra do Storage é IMPLANTADA, não só escrita', () => {
    const workflow = () => readFileSync(join(RAIZ, '.github/workflows/deploy-firestore.yml'), 'utf8');

    it('o firebase.json aponta o arquivo de regras do Storage', () => {
        const cfg = JSON.parse(readFileSync(join(RAIZ, 'firebase.json'), 'utf8'));
        expect(cfg?.storage?.rules).toBe('storage.rules');
    });

    it('o deploy publica as regras do Storage', () => {
        const yml = workflow();
        const cmd = yml.match(/--only[\s\\]+([a-zA-Z:,]+)/)?.[1] || '';
        if (!/(^|,)storage(:rules)?(,|$)/.test(cmd)) {
            throw new Error(
                '\n\n🚧 REGRA DO STORAGE NÃO É PUBLICADA\n\n'
                + `  · o deploy roda com --only ${cmd || '(não encontrado)'}\n\n`
                + 'Sem `storage` nessa lista, o `storage.rules` fica no repositório e a\n'
                + 'produção continua no DEFAULT DENY — foi assim que a importação de NFS-e\n'
                + 'em PDF levou o mesmo `storage/unauthorized` no dia seguinte à correção.\n',
            );
        }
    });

    it('mudar o storage.rules dispara o deploy', () => {
        // Sem isto, a regra só sairia quando alguém tocasse um arquivo do
        // Firestore por acaso — publicação por coincidência não é publicação.
        expect(workflow()).toMatch(/paths:[\s\S]*?- storage\.rules/);
    });
});
