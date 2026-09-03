/**
 * 🚨 MATA-BURRO: O ROBÔ DE SEGURANÇA NÃO PODE QUEBRAR EM SILÊNCIO.
 *
 * O caso (17/08, achado num print do Paulo da lista de runs): o robô diário
 * de auditoria **falhou em 14, 15 e 17/08** — três runs vermelhos seguidos — e
 * **nenhuma issue foi aberta**. Ninguém soube.
 *
 * A cadeia era esta: o `git push` da branch `chore/audit-deps` era rejeitado
 * (a branch remota, parada de um run anterior, tinha divergido); o step morria
 * com `exit 1` por causa do `bash -e`; e o passo que abre issue **estava
 * depois**, com uma condição que só cobria "não houve correção". Resultado: o
 * robô que existe para PROTEGER as entregas ficou três dias sem proteger nada,
 * e o único aviso era um ✕ vermelho num painel que ninguém abre.
 *
 * É literalmente a lição que o próprio projeto escreveu em 13/08 para o
 * deploy — *"run vermelho num painel que ninguém abre não é aviso; issue é"* —
 * e que não tinha sido aplicada AQUI.
 *
 * Este teste NÃO prova que o GitHub abre a issue (só o próximo run quebrado
 * prova). O que ele impede é a rede de segurança sumir num refactor, e o push
 * voltar a ser feito sem buscar a ref remota.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const yml = readFileSync(join(__dirname, '..', '.github/workflows/audit-deps.yml'), 'utf8');

// ────────────────────────────────────────────────────────────────────────────
// 🚨 03/09: O AVISO ERA UM PASSO DENTRO DO MESMO JOB — o modo de falha que ele
// denuncia. Se o job morre antes de qualquer passo rodar ("Prepare all
// required actions", o deploy 566 de 17/08) ou é CANCELADO pela cota, o
// `if: failure()` de um passo nem executa. Job próprio com `needs`, sem
// `uses:` — o mesmo desenho que o deploy-app.yml ganhou em 17/08.
// ────────────────────────────────────────────────────────────────────────────
describe('🚨 o aviso vive num JOB SEPARADO do robô', () => {
    const doc = (require('js-yaml') as any).load(yml);

    it('existe o job avisar-falha com `needs: auditar`', () => {
        expect(doc.jobs['avisar-falha']).toBeTruthy();
        expect(doc.jobs['avisar-falha'].needs).toBe('auditar');
    });

    it('dispara em falha E em cancelamento', () => {
        const cond = String(doc.jobs['avisar-falha'].if);
        expect(cond).toMatch(/failure\(\)/);
        expect(cond).toMatch(/cancelled\(\)/);
    });

    it('NÃO usa action nenhuma, e tem a própria permissão de issue', () => {
        const job = doc.jobs['avisar-falha'];
        expect((job.steps || []).length).toBeGreaterThan(0);
        for (const s of job.steps) expect(s.uses).toBeUndefined();
        expect(job.permissions?.issues).toBe('write');
    });

    it('o job do robô não tem mais o passo de aviso dentro dele', () => {
        const passos: any[] = doc.jobs.auditar.steps;
        expect(passos.some((s) => /outro motivo/.test(String(s.name || '')))).toBe(false);
        expect(passos.some((s) => /failure\(\)/.test(String(s.if || '')))).toBe(false);
    });

    it('sem checkout, o gh leva --repo explícito', () => {
        const trecho = yml.slice(yml.indexOf('avisar-falha:'));
        expect(trecho).toMatch(/gh issue list --repo "\$REPO"/);
        expect(trecho).toMatch(/gh issue create --repo "\$REPO"/);
    });
});

describe('🚨 o robô avisa quando ELE MESMO falha', () => {
    it('tem permissão de abrir issue — sem isso o aviso falha calado', () => {
        expect(yml).toMatch(/issues:\s*write/);
    });

    it('existe um passo com `if: failure()` — a rede que faltava', () => {
        // Sem ele, qualquer falha NÃO PREVISTA (git, rede, cota do runner)
        // deixa o run vermelho e nenhum registro durável.
        expect(yml).toMatch(/if:\s*failure\(\)/);
    });

    it('esse passo abre OU comenta issue (não empilha uma por dia)', () => {
        const trecho = yml.slice(yml.indexOf('if: failure()'));
        expect(trecho).toMatch(/gh issue create/);
        expect(trecho).toMatch(/gh issue comment/);
        expect(trecho).toMatch(/--state open/);
    });

    it('a issue leva o link do run — "falhou" sem onde olhar não é acionável', () => {
        const trecho = yml.slice(yml.indexOf('if: failure()'));
        expect(trecho).toMatch(/GITHUB_RUN_ID/);
    });

    it('a issue DIZ que, enquanto estiver aberta, o robô não protege nada', () => {
        // Sem essa frase, alguém lê a issue como aviso de rotina.
        const trecho = yml.slice(yml.indexOf('if: failure()'));
        expect(trecho).toMatch(/não está protegendo|nao esta protegendo/i);
    });
});

describe('🚨 o push da branch do robô busca a ref antes de forçar', () => {
    it('faz `git fetch` da branch antes do push', () => {
        // `--force-with-lease` SEM a remote-tracking ref recusa com "stale
        // info", e o fallback simples recusa com "fetch first". Os dois
        // caminhos falhavam — foi o que travou o robô por três dias.
        expect(yml).toMatch(/git fetch origin "\+refs\/heads\/\$BRANCH:refs\/remotes\/origin\/\$BRANCH"/);
    });

    it('o fetch vem ANTES do push (ordem importa, não só existir)', () => {
        const iFetch = yml.indexOf('git fetch origin "+refs/heads/$BRANCH');
        const iPush = yml.indexOf('git push --force-with-lease');
        expect(iFetch).toBeGreaterThan(-1);
        expect(iPush).toBeGreaterThan(iFetch);
    });

    it('segue usando force-with-lease, não force cego', () => {
        // A branch é exclusiva do robô, mas `--force` puro sobrescreveria
        // trabalho de quem tivesse mexido nela à mão.
        expect(yml).toMatch(/--force-with-lease/);
        expect(yml).not.toMatch(/git push\s+--force\s+origin/);
    });
});
