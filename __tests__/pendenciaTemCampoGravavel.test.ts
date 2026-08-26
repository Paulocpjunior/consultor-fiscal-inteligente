// ============================================================================
// 🚨 PENDÊNCIA QUE EXIGE CAMPO QUE NINGUÉM GRAVA É ALARME IMPOSSÍVEL DE APAGAR
//
// 26/08, Paulo, com dois prints lado a lado: o cadastro da A CASTELLANO
// mostrando **"Regime Tributário: Lucro Presumido"** e o painel de Cadastros
// incompletos dizendo *"tipoTributacao — Tipo (Presumido/Real) não definido"*.
//
// A varredura fechou a questão: `tipoTributacao` aparecia em DOIS lugares no
// repo inteiro — no helper do diagnóstico, que o EXIGIA, e no teste dele, que
// descrevia a exigência. **Nenhuma tela grava, nenhum gerador lê, nenhum
// importador preenche.** Como ninguém o preenche, a pendência nascia em 100%
// das empresas do Lucro: eram **236 em ALTO** no painel.
//
// ═══ POR QUE ISSO É PIOR QUE UM ALARME ERRADO NUMA EMPRESA ══════════════════
//
// O custo não é a linha errada — é o painel INTEIRO perdendo crédito. Alarme
// que aparece em toda a carteira e que ninguém consegue resolver ensina a
// equipe a ignorar a lista, inclusive as pendências CRÍTICAS que estão certas.
// É a família da "rota sem botão" (13/08) e do aviso que aponta um lugar
// inexistente (21/08, achado 18): **quem procura, não acha, e conclui que o
// app está quebrado**.
//
// ═══ O QUE ESTA TRAVA VARRE ═════════════════════════════════════════════════
//
// Todo campo que o diagnóstico exige tem de ser GRAVÁVEL: o nome precisa
// aparecer em código de produção FORA do próprio helper. Campo que só existe
// no lugar que o cobra é fantasma por definição.
// ============================================================================
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');
const HELPER = 'sefaz-backend/diagnostico-cadastros-helper.js';
const PASTAS = ['components', 'services', 'sefaz-backend'];
const EXTENSOES = ['.ts', '.tsx', '.js'];

function arquivos(dir: string, acc: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (nome === 'node_modules' || nome === 'dist' || nome.startsWith('.')) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) arquivos(p, acc);
        else if (EXTENSOES.some(e => nome.endsWith(e))) acc.push(p);
    }
    return acc;
}

/** Os campos que o helper cobra, lidos da FONTE — lista à mão envelhece. */
function camposExigidos(): string[] {
    const src = readFileSync(join(RAIZ, HELPER), 'utf8');
    return [...src.matchAll(/add\(\s*'([^']+)'/g)].map(m => m[1]);
}

describe('🚨 todo campo que o diagnóstico exige tem de ser gravável', () => {
    // Lidos da fonte para a trava não envelhecer no primeiro campo novo — é a
    // régua da casa: varredura, nunca lista.
    const exigidos = camposExigidos();

    it('o helper cobra campos, e a lista sai da FONTE', () => {
        expect(exigidos.length).toBeGreaterThan(4);
        // O campo que gerou este teste NÃO pode voltar.
        expect(exigidos).not.toContain('tipoTributacao');
    });

    it('nenhum campo exigido é fantasma', () => {
        const producao = PASTAS
            .flatMap(p => arquivos(join(RAIZ, p)))
            .filter(f => !f.endsWith(HELPER.split('/').pop()!))
            // A rota só repassa o resultado do helper — citar o nome ali não
            // prova que alguém GRAVA o campo.
            .filter(f => !f.includes('diagnostico-cadastros-routes'));
        const fontes = producao.map(f => readFileSync(f, 'utf8')).join('\n');

        const fantasmas = exigidos.filter((campo) => {
            // `dadosFiscais.uf` → procura por `uf`, que é como o campo é
            // gravado (o prefixo é o caminho, não o nome da chave).
            const chave = campo.includes('.') ? campo.split('.').pop()! : campo;
            return !new RegExp(`\\b${chave}\\b`).test(fontes);
        });

        if (fantasmas.length) {
            throw new Error(
                '\n\n🚧 PENDÊNCIA QUE NINGUÉM CONSEGUE RESOLVER\n\n'
                + fantasmas.map(c => `  · ${c}`).join('\n')
                + '\n\nO diagnóstico de cadastros EXIGE estes campos e NENHUM lugar do app os\n'
                + 'grava. Como ninguém os preenche, a pendência nasce em toda empresa do\n'
                + 'regime — e alarme que a carteira inteira recebe sem poder apagar ensina\n'
                + 'a equipe a ignorar o painel, inclusive as pendências CRÍTICAS que estão\n'
                + 'certas.\n\n'
                + 'Foi assim que `tipoTributacao` classificou 236 empresas como ALTO (26/08,\n'
                + 'caso A CASTELLANO): ele existia só no helper que o cobrava. O campo que a\n'
                + 'tela de fato grava é `dadosFiscais.regimeTributario`.\n\n'
                + 'Ou o campo ganha uma tela que o grave, ou a pendência pergunta pelo campo\n'
                + 'que já existe — nunca fica cobrando um fantasma.\n',
            );
        }
        expect(fantasmas).toEqual([]);
    });

    // 📌 E a pendência de regime tem de APONTAR O LUGAR — a régua de 21/08
    // (achado 18): aviso que aponta um lugar tem de apontar um lugar que a
    // pessoa ACHA. "Tipo (Presumido/Real) não definido" não dizia onde.
    it('a pendência de regime diz ONDE resolver', () => {
        const src = readFileSync(join(RAIZ, HELPER), 'utf8');
        expect(src).toMatch(/Dados Fiscais/);
        // E quem responde é o DONO, não uma leitura crua de campo.
        expect(src).toMatch(/regimeDaEmpresa/);
    });
});
