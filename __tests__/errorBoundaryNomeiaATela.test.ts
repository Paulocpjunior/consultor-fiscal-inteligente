// ============================================================================
// 🚨 O PRINT DO CRASH TEM DE NOMEAR A TELA — e 26 fronteiras diziam "App"
//
// (10/09, Paulo, com o print: *"Erro ao carregar **App** · Cannot read
// properties of undefined (reading 'toLocaleString')"* — abrindo uma nota de
// saída na Central de Documentos Fiscais.)
//
// A regra existe desde 07/08 e está escrita no próprio `ErrorBoundary`: sem o
// nome, *"descobrir QUAL módulo quebrou vira adivinhação (aconteceu em 07/08:
// um `reading 'slice'` sem dono, com 261 candidatos no código)"*. A prop foi
// criada — e preenchida com a string **"App"** em 26 lugares, que entrega
// exatamente a mesma adivinhação que ela veio impedir. É o vício de 13/08:
// **regra escrita não é regra travada**.
//
// ⚠️ A varredura barra só o que NÃO NOMEIA (ausente ou genérico). Nome técnico
// (`DasHub`) passa: ele é único e leva ao lugar. Alarme sobre código certo é o
// jeito conhecido de a equipe desligar a trava.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const RAIZ = resolve(__dirname, '..');
const IGNORAR = new Set(['node_modules', 'dist', '__tests__', '.git', 'coverage']);

/** Nome que não leva a lugar nenhum — é como não ter nome. */
const GENERICOS = new Set(['app', 'modulo', 'módulo', 'tela', 'componente', 'root', '.', '-', '—', '']);

function varrerTsx(dir: string, achados: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (IGNORAR.has(nome)) continue;
        const p = join(dir, nome);
        const st = statSync(p);
        if (st.isDirectory()) varrerTsx(p, achados);
        else if (nome.endsWith('.tsx')) achados.push(p);
    }
    return achados;
}

describe('toda fronteira de erro nomeia a tela que ela protege', () => {
    const arquivos = varrerTsx(RAIZ);

    it('a varredura tem arquivo para ler (senão ela passa verde sem ler nada)', () => {
        // A guarda contra o silêncio falso: glob quebrado passaria verde.
        expect(arquivos.length).toBeGreaterThan(50);
    });

    it('nenhum <ErrorBoundary> sem `modulo`, nenhum com nome genérico', () => {
        const problemas: string[] = [];
        let fronteiras = 0;
        for (const arq of arquivos) {
            const linhas = readFileSync(arq, 'utf-8').split('\n');
            linhas.forEach((linha, i) => {
                if (!linha.includes('<ErrorBoundary')) return;
                fronteiras += 1;
                const rel = `${relative(RAIZ, arq)}:${i + 1}`;
                const m = linha.match(/<ErrorBoundary[^>]*\bmodulo=["']([^"']*)["']/);
                if (!m) {
                    problemas.push(`${rel} — sem \`modulo\`: o print vai dizer "Erro ao carregar modulo".`);
                    return;
                }
                if (GENERICOS.has(m[1].trim().toLowerCase())) {
                    problemas.push(`${rel} — modulo="${m[1]}" não nomeia nada. Use o nome da TELA.`);
                }
            });
        }
        expect(fronteiras).toBeGreaterThan(10);
        expect(problemas).toEqual([]);
    });
});
