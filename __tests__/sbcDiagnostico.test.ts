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

    it('🚨 e o desfecho do zero DIZ o que ele assume', () => {
        // Sem a janela do log ao lado, seria carimbar prova não medida.
        //
        // ⚠️ ESTA ASSERÇÃO JÁ FOI LITERAL DEMAIS e me acusou hoje (23/09):
        // ela exigia a frase *"só vale se a hora da"*, que a reescrita do
        // desfecho trocou por um texto MAIS forte ("zero AQUI é zero NESTA
        // janela"). Trava que cobra a REDAÇÃO em vez do FATO manda reescrever
        // para agradar o teste — o vício de 22/08. Agora ela cobra o fato: o
        // desfecho mostra os limites da janela conferida E manda conferir a
        // hora da tentativa antes de concluir.
        expect(veredito).toMatch(/\$\{LOG_DE:-\?\}/);
        expect(veredito).toMatch(/\$\{LOG_ATE:-\?\}/);
        expect(veredito).toMatch(/hora da tentativa/);
        // E não conclui mais contra a Meta a partir do zero da janela.
        expect(veredito).toMatch(/medição de janela não vira conclusão/);
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

    // ════════════════════════════════════════════════════════════════════════
    // 🔴 23/09 — O DIAGNÓSTICO MEDIA UMA DÚVIDA MORTA.
    //
    // Ele contava INVITE, e em 28/08 o log respondeu isso de vez: a linha
    // `meta: Couldn't negotiate stream 0:audio-0:audio:sendrecv (nothing)` só
    // existe DEPOIS de um INVITE aceito no nosso endpoint. A chamada CHEGA e
    // morre na mídia.
    //
    // 🚨 O CUSTO DE NÃO MEDIR ISSO ERA UM CHAMADO ERRADO: a varredura daquele
    // dia olhou a janela "08:0", deu zero, e o veredito mandava a pessoa ao
    // suporte da Meta — com o erro das 11:03 no MESMO arquivo. Medição de
    // JANELA não vira conclusão sobre o OUTRO LADO.
    // ════════════════════════════════════════════════════════════════════════
    describe('🔴 a mídia é a pergunta de hoje — e o zero da janela não manda mais à Meta', () => {
        const dirM = mkdtempSync(join(tmpdir(), 'sbc-midia-'));
        const logM = join(dirM, 'full');
        const envM = {
            ...process.env,
            LOG_FULL: logM,
            LOGGER_CONF: join(dirM, 'logger.conf'),
            ASTERISK_CONF: join(dirM, 'asterisk.conf'),
            CDR_CSV: join(dirM, 'nao-existe.csv'),
        };
        // O log REAL de 28/08: o INVITE e o erro estão às 11:03, e quem
        // procurar na janela das 08:0 não acha nada.
        writeFileSync(logM, [
            '[2026-08-28 11:03:37] VERBOSE[1] Received SIP request INVITE from meta',
            'm=audio 5004 UDP/TLS/RTP/SAVPF 111 0 8',
            "[2026-08-28 11:03:38] ERROR[35904] res_pjsip_session.c: meta: Couldn't"
                + ' negotiate stream 0:audio-0:audio:sendrecv (nothing)',
            '',
        ].join('\n'));
        writeFileSync(join(dirM, 'logger.conf'), 'full => notice,warning,error,verbose\n');
        writeFileSync(join(dirM, 'asterisk.conf'), 'verbose = 3\n');

        const rodar = (...args: string[]) =>
            execFileSync('bash', ['-s', '--', ...args], {
                input: script, env: envM, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
            });

        it('mostra o m=audio, que é a ÚNICA linha que decide a causa', () => {
            // Sem ela, trocar `media_encryption` é chute — e chute aqui já
            // custou três rodadas.
            expect(rodar('11:0')).toMatch(/UDP\/TLS\/RTP\/SAVPF/);
        });

        it('conta a falha de negociação e DIZ que o problema é nosso', () => {
            const saida = rodar('11:0');
            expect(saida).toMatch(/A META ENTREGA/);
            expect(saida).toMatch(/falha\(s\) de negociação/);
            expect(saida).toMatch(/NÃO é caso de Meta/);
        });

        it('🚨 e a janela VAZIA não manda mais abrir chamado na Meta', () => {
            // ESTE é o caso de 28/08. Antes, zero na janela virava "o fato que
            // falta no chamado da Meta"; agora ele diz que o log INTEIRO
            // desmente isso, e que o texto do chamado está suspenso.
            const saida = rodar('08:0');
            expect(saida).toMatch(/NENHUM INVITE na janela/);
            expect(saida).toMatch(/PROVA CONTRÁRIA/);
            expect(saida).toMatch(/SUSPENSO/);
        });

        // ════════════════════════════════════════════════════════════════════
        // 🚨 23/09 — O GRAVADOR TEM DOIS INTERRUPTORES E A SEÇÃO 1 VIA UM.
        //
        // O print do Paulo (23/09) saiu 🟡 "NENHUM INVITE na janela, com o
        // gravador LIGADO" e mandava ao chamado da Meta. Só que `logger.conf`
        // liga o VERBOSE; quem escreve as mensagens SIP — as linhas de INVITE
        // que a seção 4 conta — é o `pjsip set logger`, OUTRO botão, que some
        // a cada restart. Ele rodou sem `--ao-vivo`.
        //
        // É o "0 INVITEs com o gravador desligado" de 25/08 um nível abaixo:
        // a trava existia, passava, e não cobria a metade do gravador que de
        // fato escreve o que ela conta.
        // ════════════════════════════════════════════════════════════════════
        it('🚨 verbose LIGADO e trace SIP DESLIGADO não conclui contra a Meta', () => {
            const dirT = mkdtempSync(join(tmpdir(), 'sbc-trace-'));
            // O log do print: três dias, verbose escrevendo, zero mensagem SIP.
            writeFileSync(join(dirT, 'full'), [
                '[2026-09-20 00:00:02] VERBOSE[1] Asterisk Ready',
                '[2026-09-23 09:32:20] WARNING[2] algo',
                '',
            ].join('\n'));
            writeFileSync(join(dirT, 'logger.conf'), 'full => notice,warning,error,verbose\n');
            writeFileSync(join(dirT, 'asterisk.conf'), 'verbose = 3\n');
            const saida = execFileSync('bash', ['-s', '--', '2026-09-23'], {
                input: script,
                env: {
                    ...process.env,
                    LOG_FULL: join(dirT, 'full'),
                    LOGGER_CONF: join(dirT, 'logger.conf'),
                    ASTERISK_CONF: join(dirT, 'asterisk.conf'),
                    CDR_CSV: join(dirT, 'nao-existe.csv'),
                },
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            expect(saida).toMatch(/ZERO linha de trace SIP/);
            expect(saida).toMatch(/NÃO DÁ PARA CONCLUIR — o trace SIP/);
            expect(saida).toMatch(/NÃO abra chamado com isto/);
            // E o desfecho que mandava à Meta NÃO pode aparecer aqui.
            expect(saida).not.toMatch(/NENHUM INVITE na janela, com o gravador LIGADO/);
        });

        // ════════════════════════════════════════════════════════════════════
        // ☎️ 23/09 — DUAS RODADAS GASTAS POR CAUSA DA GRADE DE ATENDIMENTO.
        //
        // O teste saiu às 07:50 BRT e a janela da Meta abre às 08:00. Ela NÃO
        // entrega fora da grade, então "nenhum INVITE" era a resposta CERTA —
        // e o script deixou a conclusão por conta de quem lia. As quatro
        // falhas reais do log caem todas DENTRO (21/09 15:43, 22/09 11:07 e
        // 13:52 BRT).
        //
        // É a mesma classe do trace SIP: concluir sobre uma medição que não
        // tinha como acontecer.
        // ════════════════════════════════════════════════════════════════════
        it('🚨 rodada FORA da grade da Meta não vira defeito de entrega', () => {
            // ⚠️ A JANELA NÃO EXISTE NO LOG, DE PROPÓSITO. Com uma janela que
            // casa, o veredito para no 🔴 ("a Meta entrega") antes de chegar
            // na grade, e a trava passaria sem medir nada.
            // 🐛 DUAS FIXTURES MINHAS FALHARAM ANTES DESTA: '11:0' casava o
            // INVITE, e '03:3' casava DENTRO de "11:03:37" — o filtro é
            // substring, não hora. Fixture que não alcança o ramo é teste
            // verde sobre código não exercitado.
            const saida = execFileSync('bash', ['-s', '--', '1999-01-01'], {
                input: script,
                // Grade impossível de casar: qualquer hora cai fora.
                env: { ...envM, META_TZ: 'UTC', META_GRADE: '23:58-23:59' },
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            expect(saida).toMatch(/FORA da grade/);
            expect(saida).toMatch(/NÃO DÁ PARA CONCLUIR — a rodada está FORA/);
            expect(saida).toMatch(/não vira chamado/);
        });

        it('⚠️ e a grade NÃO é carimbada de memória — é parâmetro com fonte', () => {
            // O valor vem do `call_hours` que o GET /settings da Meta devolve,
            // registrado no documento. Cravar horário no código seria inventar
            // cadastro de terceiro.
            expect(script).toMatch(/META_GRADE="\$\{META_GRADE:-/);
            expect(script).toMatch(/META_TZ="\$\{META_TZ:-/);
            expect(script).toMatch(/call_hours/);
        });

        it('⚠️ e "não consegui contar" nunca vira "a mídia está boa"', () => {
            // Mesma disciplina da seção 4: sem log, a seção 7 DIZ que não
            // olhou — zero inventado aqui afirmaria áudio negociado sobre
            // medição nenhuma.
            const saida = execFileSync('bash', ['-s', '--', '11:0'], {
                input: script,
                env: { ...envM, LOG_FULL: join(dirM, 'sumiu') },
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            expect(saida).toMatch(/sem o log, não há como ver a negociação/);
            expect(saida).not.toMatch(/0 falha\(s\) de negociação/);
        });
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
        //
        // 🚨 E A 2ª VERSÃO ERRAVA O ALCANCE — ela me acusou hoje (23/09). A
        // proibição vale para ESTE desfecho, e ela varria o VEREDITO INTEIRO:
        // quando o desfecho novo do trace desligado passou a dizer "arme e
        // refaça a ligação" (que é EXATAMENTE para o que o helper serve), a
        // trava ficou vermelha sobre código certo. Trava com alcance maior
        // que a regra vira alarme falso, e alarme falso é trava desligada.
        const ondeVale = veredito.slice(veredito.indexOf('NÃO CONSEGUI OLHAR'));
        const soEsteDesfecho = ondeVale.slice(0, ondeVale.indexOf('elif '));
        expect(soEsteDesfecho).toMatch(/gcloud compute ssh sbc-whatsapp/);
        const chama = soEsteDesfecho.split('\n').some((l) => l.trim().startsWith('comando_de_rodar'));
        expect(chama).toBe(false);
        // 🚩 E o recorte tem de ter pegado ALGO — fatia vazia passaria verde
        // sem exercitar nada, que é o defeito que esta casa mais repete.
        expect(soEsteDesfecho.length).toBeGreaterThan(200);
    });
});
