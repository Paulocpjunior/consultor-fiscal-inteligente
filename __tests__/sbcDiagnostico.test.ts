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
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

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

    it('a saída ENSINA a ler — as três conclusões possíveis, com a ação', () => {
        expect(script).toMatch(/INVITE presente/);
        expect(script).toMatch(/INVITE ausente E gravador ligado/);
        expect(script).toMatch(/INVITE ausente E gravador desligado/);
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
