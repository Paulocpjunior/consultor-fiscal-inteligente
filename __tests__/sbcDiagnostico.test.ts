// ============================================================================
// ☎️ O DIAGNÓSTICO DO SBC — e a única regra que faz ele valer alguma coisa
//
// 26/08. Do lado do app não sobrou nada para conferir: os quatro interruptores
// da Meta estão ENABLED e o 🔌 provou o caminho até o SBC **a partir do
// endereço que a própria Meta guarda** (DNS, TLS, certificado, SIP 200 OK).
// A pergunta que resta — **chegou INVITE?** — só se responde dentro do SBC.
//
// 🚨 E ELA ESTAVA PARADA POR UM MOTIVO BOBO: responder exigia saber Asterisk
// (caminho do log, nome do CSV do CDR, comandos do pjsip). Medição que depende
// de conhecimento especializado é medição que não acontece — e a conversa com
// a Meta fica esperando um dado que ninguém coleta.
//
// 🚨 A REGRA QUE MANDA É A DE 25/08: **silêncio só vale se o gravador estava
// LIGADO.** Naquele dia três rodadas de teste não valeram nada porque o SBC
// nasceu sem gravar, e "nenhum INVITE" ficou idêntico a "chegou e ninguém
// anotou". Um script que responde "0" sem conferir o gravador não é
// diagnóstico: é a mesma armadilha com carinha de ferramenta.
// ============================================================================
import { readFileSync, existsSync, mkdtempSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

const raiz = process.cwd();
const script = readFileSync(join(raiz, 'scripts/sbc-diagnostico.sh'), 'utf8');
const doc = readFileSync(join(raiz, 'docs/sbc-whatsapp-hitphone.md'), 'utf8');

describe('🚨 o script se recusa a concluir no escuro', () => {
    it('CONFERE o gravador ANTES de qualquer contagem', () => {
        const ondeConfere = script.indexOf('O gravador está ligado?');
        const ondeConta = script.indexOf('Chegou INVITE');
        expect(ondeConfere).toBeGreaterThan(-1);
        expect(ondeConta).toBeGreaterThan(ondeConfere);
    });

    it('🚨 zero INVITE com gravador DESLIGADO não vira "não chegou"', () => {
        // É a lição de 25/08 escrita em código: as duas leituras mandam fazer
        // coisas opostas (abrir chamado × ligar o gravador e refazer).
        expect(script).toMatch(/NÃO DÁ PARA CONCLUIR/);
        expect(script).toMatch(/GRAVANDO="nao"/);
    });

    it('🚨 e seção sem log não fica MUDA — mudo se lê como "não achou"', () => {
        // Foi o defeito da 1ª versão: sem o arquivo, as seções 4, 5 e 6 não
        // imprimiam nada, e quem lesse concluiria que a busca deu vazio.
        const semLog = script.match(/NÃO CONSEGUI OLHAR/g) || [];
        expect(semLog.length).toBeGreaterThanOrEqual(3);
    });

    it('diz ATÉ ONDE o log alcança — rotação de log invalida o zero', () => {
        // Mesma régua do painel de eventos crus: recorte que não se declara
        // vira afirmação sobre o que não foi medido.
        expect(script).toMatch(/Até onde este log alcança/);
        expect(script).toMatch(/rotação de log/);
    });
});

describe('☎️ ele mede as duas pontas, não só uma', () => {
    it('log do Asterisk E CDR — o CDR não depende de verbose', () => {
        expect(script).toMatch(/\/var\/log\/asterisk\/full/);
        expect(script).toMatch(/cdr-csv\/Master\.csv/);
    });

    it('🚨 procura RECUSA nossa — "tocou 1x e caiu" mora aí', () => {
        // Se o INVITE chega e o Asterisk responde 401/403/488, a causa deixou
        // de ser da Meta e passou a ser nossa. Sem esta seção, o script
        // acharia "0 INVITEs bem-sucedidos" e mandaria cobrar a Meta.
        expect(script).toMatch(/401\|403\|404\|407\|488\|603/);
    });

    it('e mostra se o Asterisk escuta onde a Meta aponta', () => {
        expect(script).toMatch(/pjsip show transports/);
        expect(script).toMatch(/pjsip show identifies/);
    });

    it('arma a captura da PRÓXIMA ligação, com o jeito de desarmar', () => {
        // Trava sem caminho de volta é trava que a equipe contorna.
        expect(script).toMatch(/pjsip set logger on/);
        expect(script).toMatch(/pjsip set logger off/);
    });
});

describe('🚨 script sem caminho é script que não existe', () => {
    it('o arquivo está no repo e é executável de propósito', () => {
        expect(existsSync(join(raiz, 'scripts/sbc-diagnostico.sh'))).toBe(true);
        expect(script.startsWith('#!/usr/bin/env bash')).toBe(true);
    });

    it('e o documento do SBC diz que ele existe e como rodar', () => {
        // A regra de 13/08 na versão script: ferramenta que só quem escreveu
        // sabe que existe é trabalho perdido.
        expect(doc).toMatch(/sbc-diagnostico\.sh/);
    });

    it('a saída CONCLUI — e a conclusão vem com a ação', () => {
        // ⚠️ ESTE TESTE PRENDIA AS FRASES DO "COMO LER" e reprovou a própria
        // correção que a régua mandava fazer: aquele rodapé ENSINAVA a
        // concluir, e os fatos para concluir ficavam fora do print. Trocado
        // pela INTENÇÃO — existe uma conclusão, e ela diz o que fazer.
        expect(script).toMatch(/VEREDITO/);
        expect(script).toMatch(/A META ENTREGA/);
        expect(script).toMatch(/NÃO DÁ PARA CONCLUIR/);
    });
});

// ============================================================================
// 🚨 "RODE DENTRO DO SBC" NÃO É UM CAMINHO — são DUAS máquinas
//
// 26/08: o Paulo rodou `sudo bash scripts/sbc-diagnostico.sh 09:3` no MAC, em
// `~`, e levou *"No such file or directory"* duas vezes. Ele fez o que a
// instrução mandava; a instrução é que estava pela metade — o script mora no
// REPO e precisa rodar DENTRO da VM, e eu não disse como chegar lá.
//
// É a mesma família do aviso que aponta a chave do banco em vez do botão
// (21/08): quem lê procura, não acha, e conclui que a ferramenta está quebrada.
// ============================================================================
describe('🚨 a instrução leva a pessoa até a máquina certa', () => {
    it('o comando completo está no documento — repo → VM, sem copiar arquivo', () => {
        expect(doc).toMatch(/gcloud compute ssh sbc-whatsapp/);
        expect(doc).toMatch(/--zone=us-west1-a/);
        // `bash -s` executa o script vindo da conexão: sem scp, sem paste.
        expect(doc).toMatch(/sudo bash -s -- 09:3/);
    });

    it('e diz o que fazer quando o gcloud NÃO existe no Mac', () => {
        // O `.zprofile` do Paulo aponta para um SDK movido — sem esta saída, a
        // instrução morre no primeiro comando.
        expect(doc).toMatch(/gcloud version/);
        expect(doc).toMatch(/Cloud Shell/);
    });

    it('o próprio script avisa que são duas máquinas', () => {
        expect(script).toMatch(/SÃO DUAS MÁQUINAS/);
        expect(script).toMatch(/gcloud compute ssh sbc-whatsapp/);
    });
});

// ============================================================================
// 🚨 O VEREDITO FICA NO FIM — é o fim que sobrevive ao print
//
// 26/08, 2ª rodada: o Paulo rodou certo, pela VM, e mandou o print — com as
// seções 1, 2 e 3 FORA DA TELA. Só sobrou o "0 linhas com INVITE". E esse zero
// sozinho é exatamente a armadilha de 25/08: sem saber se o gravador estava
// ligado e se o log alcança a hora da tentativa, ele não significa nada.
//
// O "COMO LER" no rodapé não bastava: ele ENSINAVA a concluir, e os fatos para
// concluir tinham rolado para cima. Ferramenta de diagnóstico que depende de
// rolagem não responde — ela CONCLUI, no lugar onde a pessoa olha, e diz junto
// o que a conclusão ASSUME.
// ============================================================================
describe('🚨 o veredito conclui sozinho, e no fim', () => {
    const veredito = script.slice(script.indexOf('VEREDITO'));

    it('está DEPOIS de todas as seções — é o que sobra num print', () => {
        expect(script.indexOf('VEREDITO')).toBeGreaterThan(script.indexOf('Alguma recusa nossa'));
    });

    it('os QUATRO desfechos são decididos por ele, não pelo leitor', () => {
        expect(veredito).toMatch(/NÃO CONSEGUI OLHAR/);      // rodou no Mac
        expect(veredito).toMatch(/NÃO DÁ PARA CONCLUIR/);    // gravador off
        expect(veredito).toMatch(/A META ENTREGA/);          // achou INVITE
        expect(veredito).toMatch(/NENHUM INVITE na janela/); // zero, gravador on
    });

    it('🚨 e o desfecho "a Meta não entrega" DIZ o que ele assume', () => {
        // Sem a janela do log ao lado, seria carimbar prova não medida.
        expect(veredito).toMatch(/só vale se a hora da/);
        expect(veredito).toMatch(/\$\{LOG_DE:-\?\}/);
    });

    it('rodou no lugar errado? o veredito devolve o COMANDO certo', () => {
        // Em vez de repetir "rode dentro do SBC", que foi o que já falhou.
        expect(veredito).toMatch(/gcloud compute ssh sbc-whatsapp/);
    });

    it('⚠️ e sem CDR ele SEGURA a conclusão — o log vira testemunha única', () => {
        expect(veredito).toMatch(/CDR NÃO existe nesta VM/);
        expect(veredito).toMatch(/cdr show status/);
    });

    it('os caminhos são sobrescrevíveis — é o que permite PROVAR os quatro', () => {
        expect(script).toMatch(/LOG_FULL="\$\{LOG_FULL:-/);
        expect(script).toMatch(/LOGGER_CONF="\$\{LOGGER_CONF:-/);
    });
});

// ============================================================================
// 🚨 VARREDURA DE FONTE PROVA O CÓDIGO, NÃO A SAÍDA — então aqui ele RODA
//
// 26/08, a primeira rodada de verdade (Paulo, pela VM, com `--ao-vivo`). O
// script tinha DOIS defeitos que nenhum teste de fonte pegaria, e os dois só
// aparecem quando alguém executa:
//
// 🔴 (1) `JANELA="${1:-}"` engolia a FLAG: `--ao-vivo` descia até o `grep` e a
//    saída trouxe TRÊS `grep: unrecognized option '--ao-vivo'`. As buscas NÃO
//    RODARAM — e mesmo assim o veredito concluiu, sobre `ACHADOS` vazio. É o
//    pior desfecho possível para um diagnóstico: **erro de argumento virando
//    zero plausível**, indistinguível de "procurei e não achei". A mesma
//    família do campo de valor que recebe default (06/08).
// 🔴 (2) a dica de rodar de novo saía `sudo bash bash $(date ...)` — sob
//    `bash -s`, que é o caminho que FUNCIONA, `$0` é literalmente "bash".
//    Comando que não roda é o aviso que aponta lugar inexistente (21/08),
//    e foi ele que a pessoa ia copiar em seguida.
//
// É a lição de 20/08 no campo do cérebro do CFOP: a varredura dizia que o
// código estava certo e o dedo do Paulo não achava o campo. Aqui a régua é a
// mesma — **prova por EXECUÇÃO**, que é exatamente o que os caminhos
// sobrescrevíveis por env existem para permitir.
// ============================================================================
describe('🚨 e ele é provado RODANDO, nas duas máquinas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sbc-'));
    const log = join(dir, 'full');
    const env = {
        ...process.env,
        LOG_FULL: log,
        LOGGER_CONF: join(dir, 'logger.conf'),
        ASTERISK_CONF: join(dir, 'asterisk.conf'),
        CDR_CSV: join(dir, 'nao-existe.csv'),
    };
    const hoje = new Date().toISOString().slice(0, 10);
    writeFileSync(log, `[${hoje} 09:31:02] VERBOSE[1] Received SIP request INVITE\n`);
    writeFileSync(join(dir, 'logger.conf'), 'full => notice,warning,error,verbose\n');
    writeFileSync(join(dir, 'asterisk.conf'), 'verbose = 3\n');

    // Como o Paulo roda de verdade: o script vai pela CONEXÃO, não pelo disco.
    const porBashS = (...args: string[]) =>
        execFileSync('bash', ['-s', '--', ...args], {
            input: script, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        });

    it('🔴 a FLAG não vira filtro de busca — as buscas rodam', () => {
        const saida = porBashS('--ao-vivo');
        expect(saida).not.toMatch(/unrecognized option/);
        // E provou que buscou de verdade: achou o INVITE que está no log.
        expect(saida).toMatch(/1 linha\(s\) com INVITE/);
    });

    it('🔴 opção desconhecida é DITA e descartada, nunca vira janela', () => {
        const saida = execFileSync('bash', ['-s', '--', '09:3', '--ao-vivo', '--xpto'], {
            input: script, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        });
        expect(saida).toMatch(/na janela "09:3"/);
        expect(saida).not.toMatch(/unrecognized option/);
    });

    it('🔴 a dica de rodar de novo NUNCA sai "bash bash"', () => {
        const saida = porBashS('--ao-vivo');
        expect(saida).not.toMatch(/bash bash/);
        // Vindo pela conexão não há arquivo no disco da VM: o caminho de volta
        // é o comando que de fato funciona, não um `$0` que não existe.
        expect(saida).toMatch(/gcloud compute ssh sbc-whatsapp/);
    });

    it('e DENTRO da VM, com o arquivo no disco, ela cita o ARQUIVO', () => {
        const copia = join(dir, 'sbc-diagnostico.sh');
        copyFileSync(join(raiz, 'scripts/sbc-diagnostico.sh'), copia);
        const saida = execFileSync('bash', [copia, '--ao-vivo'], {
            env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        });
        expect(saida).toMatch(new RegExp(`sudo bash ${copia.replace(/[.]/g, '\\.')} `));
    });

    // ── A CLASSE, não a instância ───────────────────────────────────────────
    // O `--ao-vivo` virando filtro foi o ERRO; o que fez ele CONCLUIR mesmo
    // assim foi `${ACHADOS:-0}` — "não consegui contar" lido como "contei e
    // deu zero". As duas leituras mandam fazer coisas opostas: uma abre
    // chamado na Meta, a outra manda rodar de novo. É a régua de 06/08
    // (campo de valor não recebe default) dentro da ferramenta que existe
    // justamente para não deixar ninguém concluir sobre o que não foi medido.
    it('🚨 busca que FALHA não vira zero — nem no texto, nem no veredito', () => {
        // `[` é regex inválida: o grep sai com código 2 (erro), não 1 (zero).
        const saida = porBashS('[');
        expect(saida).toMatch(/NÃO CONSEGUI CONTAR/);
        expect(saida).not.toMatch(/NENHUM INVITE na janela/);
    });

    it('✅ mas o zero LEGÍTIMO continua podendo ser afirmado', () => {
        // `grep -c` sai com 1 quando conta zero. Tratar todo não-zero como
        // falha apagaria justamente o zero que o chamado da Meta precisa.
        const saida = porBashS('03:1');
        expect(saida).toMatch(/0 linha\(s\) com INVITE/);
        expect(saida).toMatch(/NENHUM INVITE na janela/);
        expect(saida).not.toMatch(/NÃO CONSEGUI CONTAR/);
    });

    it('e o INVITE achado conclui que o problema é NOSSO', () => {
        expect(porBashS('09:3')).toMatch(/A META ENTREGA/);
    });

    it('⚠️ e a janela sugerida é do relógio DA VM, não do Mac', () => {
        // Os dois fusos podem diferir; o log é escrito com a hora da VM, então
        // uma janela vinda do Mac procuraria no minuto errado — e devolveria
        // "nenhum INVITE" com toda a confiança.
        expect(porBashS('--ao-vivo')).toMatch(/relógio DESTA VM/);
    });

    it('🚨 o desfecho "rodou no lugar errado" NÃO usa o helper — de propósito', () => {
        // Ali `$0` É um `.sh` que existe (é o Mac), e o helper devolveria o
        // MESMO comando que acabou de falhar. Unificar por elegância criaria
        // um beco: a pessoa repetiria o clique que não funciona.
        const veredito = script.slice(script.indexOf('# ── VEREDITO'));
        expect(veredito).toMatch(/Não unificar/);
        // ⚠️ E a proibição é da CHAMADA, não da palavra: a 1ª versão deste
        // teste barrava o próprio comentário que EXPLICA a decisão, ou seja
        // mandava apagar a explicação para o teste passar. É o vício da trava
        // literal (22/08) dentro da trava que eu estava escrevendo.
        const chama = veredito.split('\n').some((l) => l.trim().startsWith('comando_de_rodar'));
        expect(chama).toBe(false);
    });
});
