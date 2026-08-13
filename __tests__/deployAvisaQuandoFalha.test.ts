/**
 * MATA-BURRO: DEPLOY QUE FALHA NÃO PODE PASSAR BATIDO.
 *
 * Em 12/08/2026 dois deploys do app irmão falharam seguidos e ninguém viu. O
 * trabalho ficou mesclado na main e FORA DO AR, e a descoberta veio de um print
 * de tela desatualizada — depois de tempo gasto procurando um defeito que já
 * estava corrigido.
 *
 * A causa não é "esquecemos de olhar": é que **run vermelho num painel que
 * ninguém abre não é aviso**. Issue é.
 *
 * Este teste guarda a trava do lado do CFI. Ele NÃO consegue provar que o
 * GitHub abre a issue — isso só o próximo deploy quebrado prova. O que ele
 * impede é a trava ser removida ou esvaziada em silêncio num refactor de
 * workflow, que é como travas de CI costumam morrer.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const WORKFLOW = join(__dirname, '..', '.github', 'workflows', 'deploy-app.yml');
const yml = readFileSync(WORKFLOW, 'utf8');

describe('o workflow de deploy avisa quando falha', () => {
    it('tem permissão de abrir issue — sem isso o passo falha calado', () => {
        expect(yml).toMatch(/permissions:/);
        expect(yml).toMatch(/issues:\s*write/);
    });

    it('o aviso roda em QUALQUER falha, não só na do deploy', () => {
        // `if: failure()` cobre build, testes, auditoria, health check e
        // roteamento. Onde quebrou não importa: importa que a main não está
        // no ar.
        expect(yml).toMatch(/if:\s*failure\(\)/);
        expect(yml).toMatch(/Deploy falhou — abrir\/atualizar issue/);
    });

    it('a issue diz o que a pessoa precisa saber para agir', () => {
        expect(yml).toMatch(/NÃO está publicado/);
        expect(yml).toMatch(/github\.sha/);           // qual commit
        expect(yml).toMatch(/actions\/runs\/\$\{\{ github\.run_id \}\}/); // e onde olhar
        expect(yml).toMatch(/O que fazer/);
    });

    it('e ensina a lição que originou a trava: print sem versão engana', () => {
        expect(yml).toMatch(/não confie em print de tela/);
        expect(yml).toMatch(/guia-conferencia-entregas/);
    });

    it('falhar de novo COMENTA — uma issue por incidente', () => {
        // Enxurrada de issues iguais vira ruído que se ignora, que é o efeito
        // oposto ao que a trava existe pra produzir.
        expect(yml).toMatch(/gh issue comment/);
        expect(yml).toMatch(/gh issue create/);
        expect(yml).toMatch(/state open/);
    });

    it('o passo de aviso é o ÚLTIMO — precisa enxergar os anteriores', () => {
        const posAviso = yml.indexOf('Deploy falhou — abrir/atualizar issue');
        const posHealth = yml.indexOf('Health check final');
        expect(posHealth).toBeGreaterThan(-1);
        expect(posAviso).toBeGreaterThan(posHealth);
    });
});

// ============================================================================
// MATA-BURRO: TEXTO DE COMMIT NÃO PODE VIRAR CÓDIGO NO WORKFLOW.
//
// 13/08, deploy 470: o `Push image` caiu (infraestrutura) e ESTA trava — a que
// existe para transformar a queda em issue — CAIU JUNTO. A mensagem do commit
// era interpolada com `${{ }}` dentro do heredoc, e a mensagem daquele squash
// tinha crases e parênteses (`ehDocumentoDeServico`, `useState(...)`). O bash
// leu tudo como substituição de comando: dezenas de "command not found" e
// exit 1.
//
// Resultado: **o deploy falhou e ninguém foi avisado** — exatamente o cenário
// de 12/08 que originou a trava (trabalho mesclado, fora do ar, descoberto por
// print de tela desatualizada).
//
// `${{ }}` é substituído pelo Actions ANTES de o bash existir: qualquer texto
// de terceiro vira CÓDIGO. Por `env:` o valor chega como variável de ambiente
// de verdade e nunca é parseado — por isso isto também era vetor de injeção, e
// não só um bug de aspas.
// ============================================================================
describe('MATA-BURRO: dado de fora entra por env, nunca por ${{ }} no script', () => {
    const wf = readFileSync(join(__dirname, '..', '.github/workflows/deploy-app.yml'), 'utf8');

    /** As linhas de `run:` — é só dentro delas que a interpolação vira código. */
    const dentroDeRun = wf
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'))
        .join('\n');

    it('a mensagem do commit NÃO é interpolada no corpo do script', () => {
        // Ela pode aparecer em `env:` (e é assim que deve ser) — o que não pode
        // é `${{ github.event.head_commit.message }}` no meio do shell.
        const emEnv = /COMMIT_MSG:\s*\$\{\{\s*github\.event\.head_commit\.message\s*\}\}/.test(wf);
        expect(emEnv).toBe(true);

        const usos = dentroDeRun.match(/\$\{\{\s*github\.event\.head_commit\.message\s*\}\}/g) || [];
        // Exatamente UM: o do `env:`. Qualquer outro está dentro do `run:`.
        expect(usos).toHaveLength(1);
    });

    it('o corpo da issue vai por ARQUIVO — texto grande não vira argumento', () => {
        expect(wf).toMatch(/--body-file/);
        expect(wf).not.toMatch(/gh issue create[^\n]*--body "\$CORPO"/);
    });

    it('só a PRIMEIRA linha da mensagem entra — squash é um muro de texto', () => {
        expect(wf).toMatch(/head -n 1/);
    });
});
