/**
 * 🚨 MATA-BURRO: env VITE_* consumida no código TEM que chegar no build.
 *
 * O caso que criou esta trava (17/08): o push do celular passou a ler
 * `VITE_FIREBASE_VAPID_KEY`, e ela **não estava no workflow nem no
 * Dockerfile**. O efeito seria o pior tipo de falha — a que culpa quem fez
 * tudo certo: o Paulo geraria a chave no Firebase, criaria o secret no
 * GitHub, e o push **continuaria dizendo que está pendente**. Ele teria toda
 * razão de achar que errou o passo.
 *
 * É a mesma família da whitelist do #382 (campo novo no modal que o backend
 * descartava em silêncio) e do "cadastro que apaga um alerta tem que
 * ENTREGAR o que o alerta cobrava".
 *
 * A trava é por COMPORTAMENTO: varre quem CONSOME (`import.meta.env.VITE_*`
 * no código do app) e exige que cada uma apareça nos três elos da corrente —
 * workflow (env + build-arg) e Dockerfile (ARG + ENV). Lista escrita à mão
 * aqui envelheceria na primeira env nova, e envelheceria calada.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..');

/** Arquivos do app que o Vite compila (o build só embute o que está neles). */
function fontes(dir: string, acc: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (['node_modules', 'dist', '.git', '__tests__', 'sefaz-backend', 'coverage'].includes(nome)) continue;
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) fontes(caminho, acc);
        else if (/\.(ts|tsx|js|jsx)$/.test(nome)) acc.push(caminho);
    }
    return acc;
}

/**
 * Exceções DECLARADAS, com o motivo escrito — nunca apagando a varredura
 * (mesmo padrão do `permitido` do reguaUnica). Env que fica de fora precisa
 * de uma razão que sobreviva a três meses.
 */
const FORA_DO_BUILD: Record<string, string> = {
    // 🔒 Estas DEVEM ficar de fora: são o modo local de desenvolvimento, e
    // levá-las ao build de produção colocaria uma SENHA MESTRA no bundle que
    // qualquer um lê no DevTools. Em produção o Firebase está configurado e
    // esse caminho nem executa.
    VITE_AUTH_LOCAL_MODE: 'modo local de dev — em produção o caminho não executa e a senha não pode ir no bundle',
    VITE_AUTH_LOCAL_MASTER_PASSWORD: 'senha do modo local de dev — jamais no bundle de produção',
    // Tem padrão no próprio código (o CNPJ do escritório), então a ausência
    // não deixa nada vazio; a env só existe pra sobrescrever em teste.
    VITE_CNPJ_ESCRITORIO: 'tem valor padrão no código (CNPJ do escritório) — ausência não quebra nada',
};

const consumidas = new Set<string>();
for (const arquivo of fontes(raiz)) {
    const src = readFileSync(arquivo, 'utf8');
    // Pega `import.meta.env.VITE_X` e `(import.meta as any).env?.VITE_X`
    for (const m of src.matchAll(/import\s*\.\s*meta[^;\n]{0,40}?env\??\.\s*(VITE_[A-Z0-9_]+)/g)) {
        consumidas.add(m[1]);
    }
}

const workflow = readFileSync(join(raiz, '.github/workflows/deploy-app.yml'), 'utf8');
const dockerfile = readFileSync(join(raiz, 'Dockerfile'), 'utf8');

describe('🚨 toda VITE_* que o código lê chega no build', () => {
    it('a varredura enxerga as envs (trava vazia é trava falsa)', () => {
        expect(consumidas.size).toBeGreaterThan(3);
        expect([...consumidas]).toContain('VITE_FIREBASE_VAPID_KEY');
    });

    it('as exceções declaradas ainda são lidas pelo código (exceção órfã vira lixo)', () => {
        for (const env of Object.keys(FORA_DO_BUILD)) {
            expect(`${env} consumida=${consumidas.has(env)}`).toBe(`${env} consumida=true`);
        }
    });

    it.each([...consumidas].filter((v) => !FORA_DO_BUILD[v]).map((v) => [v]))('%s está nos QUATRO elos da corrente', (env) => {
        const faltas: string[] = [];
        // 1) o workflow lê o secret…
        if (!new RegExp(`${env}:\\s*\\$\\{\\{\\s*secrets\\.${env}\\s*\\}\\}`).test(workflow)) {
            faltas.push('workflow: env do passo "Resolver config do frontend"');
        }
        // 2) …e passa como build-arg pro docker build…
        if (!new RegExp(`--build-arg\\s+${env}=`).test(workflow)) {
            faltas.push('workflow: --build-arg do "Build app Docker image"');
        }
        // 3) …o Dockerfile declara o ARG…
        if (!new RegExp(`^ARG\\s+${env}\\s*$`, 'm').test(dockerfile)) faltas.push('Dockerfile: ARG');
        // 4) …e o converte em ENV, que é o que o Vite enxerga no build.
        if (!new RegExp(`^ENV\\s+${env}=`, 'm').test(dockerfile)) faltas.push('Dockerfile: ENV');

        if (faltas.length) {
            throw new Error(
                `\n\n🚧 ${env} É LIDA NO CÓDIGO E NÃO CHEGA NO BUILD\n\n`
                + faltas.map((f) => `  · falta em ${f}`).join('\n')
                + '\n\nSem os quatro elos, a env vem VAZIA em produção — e a falha é do pior\n'
                + 'tipo: quem cadastrar o secret no GitHub vai ver o app dizer que continua\n'
                + 'faltando, e concluir que errou o passo.\n',
            );
        }
        expect(faltas).toEqual([]);
    });
});
