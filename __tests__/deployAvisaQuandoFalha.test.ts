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
