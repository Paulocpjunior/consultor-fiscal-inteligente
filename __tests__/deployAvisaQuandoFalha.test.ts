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
// 🚨 O AVISADOR NÃO PODE COMPARTILHAR O MODO DE FALHA QUE ELE DENUNCIA.
//
// 17/08, deploy 566: caiu em **"Prepare all required actions"** — o GitHub
// devolveu 429 e depois 503 ao baixar `google-github-actions/auth`. NENHUM passo
// do job rodou, inclusive o que abre a issue, que morava dentro do mesmo job.
//
// Resultado: trabalho mesclado na main, FORA DO AR, e ninguém avisado. É o
// cenário de 12/08 pela TERCEIRA vez — e as duas correções anteriores (a issue
// em 13/08, o `env:` no mesmo dia) não alcançavam este caso, porque as duas
// viviam dentro do job que morre.
//
// A trava agora é estrutural: job PRÓPRIO, com `needs`, e ZERO `uses:`.
// ============================================================================
describe('🚨 o aviso vive num JOB SEPARADO, e não depende de baixar action', () => {
    const jobs = require('js-yaml') as any;

    const doc = (() => {
        try { return jobs.load(yml); } catch { return null; }
    })();

    it('existe um job de aviso com `needs` no job de deploy', () => {
        expect(doc).not.toBeNull();
        const aviso = doc.jobs['avisar-falha'];
        expect(aviso).toBeTruthy();
        expect(aviso.needs).toBe('deploy');
    });

    it('🚨 dispara em falha E em CANCELAMENTO — cota da conta cancela aos 15m', () => {
        // 06/08: três deploys cancelados aos 15m00s cravados, runner_id 0, zero
        // passos executados. Cancelamento por plataforma é tão invisível quanto
        // falha, e ficava sem aviso nenhum.
        const cond = String(doc.jobs['avisar-falha'].if);
        expect(cond).toMatch(/failure\(\)/);
        expect(cond).toMatch(/cancelled\(\)/);
    });

    it('🚨 NÃO usa nenhuma action — é exatamente esse download que falhou', () => {
        // `gh` já vem no runner. Qualquer `uses:` aqui devolveria o avisador ao
        // modo de falha que ele existe para denunciar.
        const steps = doc.jobs['avisar-falha'].steps || [];
        expect(steps.length).toBeGreaterThan(0);
        for (const s of steps) expect(s.uses).toBeUndefined();
    });

    it('o job de aviso tem a própria permissão de abrir issue', () => {
        expect(doc.jobs['avisar-falha'].permissions?.issues).toBe('write');
    });

    it('sem checkout, o gh precisa do --repo explícito', () => {
        // Sem `actions/checkout` não há contexto de repositório no diretório.
        expect(yml).toMatch(/gh issue list --repo "\$REPO"/);
        expect(yml).toMatch(/gh issue create --repo "\$REPO"/);
    });

    it('a issue diz em que estado o deploy terminou (falha × cancelado)', () => {
        expect(yml).toMatch(/RESULTADO: \$\{\{ needs\.deploy\.result \}\}/);
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

// ============================================================================
// 🚨 "TODA WORKFLOW QUE A CASA DEPENDE NASCE COM O `if: failure()` QUE VIRA
// ISSUE" (17/08) — e duas viviam sem ele até 03/09.
//
// `deploy-firestore.yml` publica as RULES e os ÍNDICES: falhou calado, e a
// regra escrita continua não implantada (o `storage/unauthorized` de 01/09
// foi exatamente isso). `deploy-proxy.yml` publica o proxy do SharePoint:
// falhou calado, e o auto-sync + a cópia da guia do rito ficam na revisão
// velha, com a carteira inteira levando o defeito que já foi corrigido.
//
// A régua é a MESMA do deploy-app.yml, e é conferida pela ESTRUTURA (js-yaml),
// não por texto: job próprio, `needs`, falha OU cancelamento, zero `uses:`,
// permissão própria, `--repo` explícito, dado de fora por `env:`, corpo por
// arquivo.
// ============================================================================
describe.each(['deploy-firestore.yml', 'deploy-proxy.yml'])('🚨 %s avisa quando falha — mesmo desenho do deploy-app', (arquivo) => {
    const wf = readFileSync(join(__dirname, '..', '.github/workflows', arquivo), 'utf8');
    const doc = (require('js-yaml') as any).load(wf);
    const aviso = doc.jobs['avisar-falha'];

    it('existe o job avisar-falha com `needs: deploy`', () => {
        expect(aviso).toBeTruthy();
        expect(aviso.needs).toBe('deploy');
    });

    it('dispara em falha E em cancelamento', () => {
        const cond = String(aviso.if);
        expect(cond).toMatch(/failure\(\)/);
        expect(cond).toMatch(/cancelled\(\)/);
    });

    it('NÃO usa nenhuma action — é esse download que falha', () => {
        const steps = aviso.steps || [];
        expect(steps.length).toBeGreaterThan(0);
        for (const s of steps) expect(s.uses).toBeUndefined();
    });

    it('tem a própria permissão de abrir issue, e o deploy só lê o repo', () => {
        expect(aviso.permissions?.issues).toBe('write');
        expect(doc.permissions?.issues).toBe('write');
        expect(doc.jobs.deploy.permissions?.contents).toBe('read');
        expect(doc.jobs.deploy.permissions?.issues).toBeUndefined();
    });

    it('gh com --repo explícito (sem checkout), uma issue por incidente, corpo por arquivo', () => {
        expect(wf).toMatch(/gh issue list --repo "\$REPO"/);
        expect(wf).toMatch(/gh issue comment "\$EXISTE" --repo "\$REPO" --body-file/);
        expect(wf).toMatch(/gh issue create --repo "\$REPO" --title "\$TITULO" --body-file/);
        expect(wf).toMatch(/--state open/);
    });

    it('a mensagem do commit entra por env: — UMA ocorrência, nunca dentro do run', () => {
        const semComentario = wf.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
        const usos = semComentario.match(/\$\{\{\s*github\.event\.head_commit\.message\s*\}\}/g) || [];
        expect(usos).toHaveLength(1);
        expect(wf).toMatch(/COMMIT_MSG:\s*\$\{\{\s*github\.event\.head_commit\.message\s*\}\}/);
        expect(wf).toMatch(/RESULTADO: \$\{\{ needs\.deploy\.result \}\}/);
        expect(wf).toMatch(/head -n 1/);
    });

    it('a issue diz o que NÃO está no ar e o que fazer', () => {
        expect(wf).toMatch(/NÃO est(á|ão)/);
        expect(wf).toMatch(/O que fazer/);
        expect(wf).toMatch(/actions\/runs\/\$\{\{ github\.run_id \}\}/);
    });
});

describe('deploy-proxy.yml — teto de tempo e Node pinado', () => {
    const doc = (require('js-yaml') as any).load(
        readFileSync(join(__dirname, '..', '.github/workflows/deploy-proxy.yml'), 'utf8'),
    );

    it('o job de deploy tem timeout — pendurado sem teto nunca "termina", e o aviso só dispara no fim', () => {
        expect(typeof doc.jobs.deploy['timeout-minutes']).toBe('number');
    });

    it('setup-node@v4 com Node 20 vem ANTES do npm ci', () => {
        const steps: any[] = doc.jobs.deploy.steps;
        const iNode = steps.findIndex((s) => String(s.uses || '').startsWith('actions/setup-node@v4'));
        const iCi = steps.findIndex((s) => /npm ci/.test(String(s.run || '')));
        expect(iNode).toBeGreaterThan(-1);
        expect(String(steps[iNode].with?.['node-version'])).toBe('20');
        expect(iCi).toBeGreaterThan(iNode);
    });
});
