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

describe('🚨 o robô avisa quando ELE MESMO falha', () => {
    // ÂNCORA NO PASSO, NÃO NO TEXTO DA CONDIÇÃO. A versão antiga recortava a
    // partir do literal `if: failure()` e caiu em 04/09 sobre código CERTO,
    // quando a condição ganhou as guardas do `avisado` e virou multilinha.
    // Teste que trava a FORMA impede a correção que a régua manda fazer —
    // a mesma troca já feita no IND_REG_CUM, no cfopPorNota e na trava da UF.
    const trecho = yml.slice(yml.indexOf('- name: Robô falhou por outro motivo'));

    it('tem permissão de abrir issue — sem isso o aviso falha calado', () => {
        expect(yml).toMatch(/issues:\s*write/);
    });

    it('existe a rede que dispara em falha — o que faltava em 14-17/08', () => {
        // Sem ela, qualquer falha NÃO PREVISTA (git, rede, cota do runner)
        // deixa o run vermelho e nenhum registro durável.
        expect(trecho).toMatch(/failure\(\)/);
    });

    it('esse passo abre OU comenta issue (não empilha uma por dia)', () => {
        expect(trecho).toMatch(/gh issue create/);
        expect(trecho).toMatch(/gh issue comment/);
        expect(trecho).toMatch(/--state open/);
    });

    it('a issue leva o link do run — "falhou" sem onde olhar não é acionável', () => {
        expect(trecho).toMatch(/GITHUB_RUN_ID/);
    });

    it('a issue DIZ que, enquanto estiver aberta, o robô não protege nada', () => {
        // Sem essa frase, alguém lê a issue como aviso de rotina.
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

/**
 * 🚨 MATA-BURRO: VERDE SEM ADVISORY NÃO PROVA QUE O ROBÔ ENTREGA.
 *
 * O caso (04/09): o robô passou 27 dias sem conseguir abrir PR. A caixa de
 * Settings foi marcada em 08/08 e o CLAUDE.md registrou como resolvido; a
 * recusa de 07/08 voltou IDÊNTICA nos runs de 03 e 04/09 — *"GitHub Actions is
 * not permitted to create or approve pull requests"*.
 *
 * E o que fez os 27 dias passarem NÃO foi falta de alarme: foi o VERDE. Sem
 * advisory, o robô sai limpo no primeiro step e nunca chega ao `gh pr create`,
 * então o verde diário dizia "auditei" e nunca "eu conseguiria entregar". É
 * ausência de alarme indistinguível de "está tudo certo".
 *
 * A sonda mede o que a tela de Settings não responde. Estes testes NÃO provam
 * que o GitHub aceita o PR (só o próximo run prova — que é o ponto). Eles
 * impedem a sonda de sumir, de virar verde quando falha, e de virar a mina que
 * ela veio medir.
 */
describe('🔎 a sonda mede a permissão em vez de acreditar na caixa', () => {
    // A JANELA FECHA ONDE O STEP FECHA. Na 1ª versão ela ia até o fim do
    // arquivo e engolia a rede de segurança — que TEM `gh issue comment` —,
    // reprovando código certo. Janela larga é o vício que já acusou o
    // `rotina-fiscal.js`, o `/status` do auto-sync e o último card da lista.
    const iSonda = yml.indexOf('Sonda — o robô consegue mesmo abrir PR?');
    const iFim = yml.indexOf('═══ REDE DE SEGURANÇA', iSonda);
    const bruto = yml.slice(iSonda, iFim > -1 ? iFim : undefined);

    // E ela lê CÓDIGO, nunca a prosa que o explica: o comentário da sonda
    // CITA `chore/audit-deps` justamente para dizer por que não a reusa —
    // é a mordida do ISS (22/08), em que a explicação reprovava a correção.
    const sonda = bruto
        .split('\n')
        .filter(l => !/^\s*#/.test(l))
        .join('\n');

    it('a sonda existe e roda quando NÃO há correção a entregar', () => {
        // É justamente o dia sem advisory que ficava verde sem provar nada.
        // Havendo correção, o caminho real já mede — rodar as duas daria dois
        // PRs e dois alarmes para o mesmo fato.
        expect(yml).toMatch(/Sonda — o robô consegue mesmo abrir PR\?/);
        expect(sonda).toMatch(/if:\s*steps\.auditoria\.outputs\.limpo == 'true'/);
    });

    it('abre um PR de VERDADE — é isso que a caixa em Settings não responde', () => {
        expect(sonda).toMatch(/gh pr create --draft/);
    });

    it('usa branch PRÓPRIA, nunca a do robô', () => {
        // Reusar `chore/audit-deps` destruiria uma correção real esperando
        // merge — a branch do robô é a mina que travou 3 dias em 17/08.
        expect(sonda).toMatch(/SONDA="chore\/sonda-permissao-pr"/);
        expect(sonda).not.toMatch(/chore\/audit-deps/);
    });

    it('o commit da sonda é VAZIO — nada que alguém possa mesclar por engano', () => {
        expect(sonda).toMatch(/git commit --allow-empty/);
    });

    it('limpa o rastro SEMPRE, e arma a limpeza antes de criar qualquer coisa', () => {
        // Sonda que deixa PR/branch para trás vira o problema que veio medir.
        expect(sonda).toMatch(/trap limpar EXIT/);
        expect(sonda).toMatch(/gh pr close "\$SONDA" --delete-branch/);
        // Comparar com QUALQUER `git push` casaria o `--delete` de dentro da
        // própria função de limpeza, que por definição vem antes do trap.
        // A âncora é o push que CRIA a branch.
        expect(sonda.indexOf('trap limpar EXIT'))
            .toBeLessThan(sonda.indexOf('git push --force-with-lease'));
    });

    it('sonda que falha deixa o run VERMELHO — verde diria que a entrega está garantida', () => {
        const depoisDaRecusa = sonda.slice(sonda.indexOf('::warning::A sonda'));
        expect(depoisDaRecusa).toMatch(/exit 1/);
    });

    it('a issue da sonda NÃO manda procurar correção parada', () => {
        // O caminho real diz "a correção existe e está parada"; aqui não há
        // correção nenhuma. Dizer a falha errada manda procurar no lugar errado.
        expect(sonda).toMatch(/Não procure correção parada|nao procure correcao parada/i);
    });

    it('a issue ensina a CONFERIR por resultado, não por caixa marcada', () => {
        // Foi acreditar na caixa que custou 27 dias.
        expect(sonda).toMatch(/Run workflow/);
        expect(sonda).toMatch(/caixa marcada não é|caixa marcada nao e/i);
    });

    it('não comenta todo dia na issue já aberta (o ruído que faz parar de ler)', () => {
        const trecho = sonda.slice(sonda.indexOf('EXISTE='));
        expect(trecho).toMatch(/gh issue create/);
        expect(trecho).not.toMatch(/gh issue comment/);
    });
});

/**
 * 🚨 MATA-BURRO: UM FATO, UM ALARME.
 *
 * Em 04/09 o mesmo fato abriu DUAS issues — #777 ("não consegue abrir PR",
 * específica e acionável) e #778 ("o robô falhou", genérica) — porque a rede
 * de segurança dispara em `failure()` e não distingue a falha PREVISTA, que já
 * foi avisada com a causa nomeada, da IMPREVISTA, que é a razão de ela existir.
 *
 * Com a sonda rodando todo dia útil, isso passaria a comentar o #778
 * diariamente. Dois alarmes para o mesmo fato é o caminho conhecido para a
 * equipe ignorar os dois — e um robô de segurança ignorado não protege nada.
 *
 * A trava que importa aqui é a do LADO OPOSTO: a rede NÃO pode deixar de
 * cobrir o imprevisto, que foi o silêncio de 14 a 17/08.
 */
describe('🔕 a rede do imprevisto some quando a causa já foi nomeada', () => {
    const rede = yml.slice(yml.indexOf('- name: Robô falhou por outro motivo'));

    it('os passos que avisam com causa nomeada carimbam `avisado`', () => {
        expect(yml).toMatch(/id:\s*abrir_pr/);
        expect(yml).toMatch(/id:\s*sonda/);
        // Dois carimbos: o do caminho real e o da sonda.
        expect((yml.match(/echo "avisado=true" >> "\$GITHUB_OUTPUT"/g) || []).length).toBe(2);
    });

    it('a rede sai de cena quando algum deles já avisou', () => {
        expect(rede).toMatch(/steps\.abrir_pr\.outputs\.avisado != 'true'/);
        expect(rede).toMatch(/steps\.sonda\.outputs\.avisado != 'true'/);
    });

    it('mas continua disparando no imprevisto — o silêncio de 14-17/08', () => {
        // `failure()` tem de continuar lá: passo que nunca rodou devolve
        // string vazia, então a condição segue verdadeira e a rede cobre
        // git/rede/cota, que é a razão de ela existir.
        expect(rede).toMatch(/failure\(\)/);
        expect(rede).toMatch(/gh issue create/);
        expect(rede).toMatch(/gh issue comment/);
    });
});
