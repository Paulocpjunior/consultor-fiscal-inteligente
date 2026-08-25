// ============================================================================
// ☎️ SAÍDA DO 221: QUEM ESCOLHE ENTRE TELEFONE E WHATSAPP
// ----------------------------------------------------------------------------
// Paulo, 25/08: "se eu ligar p o cliente do ramal 221, como sair pelo SIP ou
// pela Meta?".
//
// 🚨 Quem decide NÃO é o nosso SBC — é o HitPhone. Ligação normal do 221 nem
// passa por aqui: sai pela telefonia deles. Este SBC só vê o que a HIT
// ESCOLHEU mandar ao nosso tronco, e o jeito de escolher é um PREFIXO discado.
//
// O dialplan antigo era um `_.` que mandava TUDO ao WhatsApp. Isso só era
// seguro porque a HIT ainda não roteia nada para cá: no dia em que rotear,
// chamada inesperada iria ao WhatsApp em SILÊNCIO — a família do default de
// campo fiscal, que esta casa não aceita.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const script = readFileSync(join(process.cwd(), 'scripts/setup-sbc-whatsapp.sh'), 'utf8');

describe('a saída separa os dois caminhos por PREFIXO', () => {
    it('o prefixo é parâmetro e NASCE VAZIO (é combinação com a HIT, não invenção)', () => {
        expect(script).toMatch(/SBC_PREFIXO_WHATSAPP="\$\{SBC_PREFIXO_WHATSAPP:-\}"/);
    });

    it('com prefixo definido, ele é RETIRADO antes de discar', () => {
        expect(script).toMatch(/Set\(ALVO=\\\$\{FILTER\(0-9,\\\$\{EXTEN:\$\{#SBC_PREFIXO_WHATSAPP\}\}\)\}\)/);
    });

    it('e o que NÃO casa é RECUSADO com o motivo — nunca discado por engano', () => {
        expect(script).toMatch(/naoemeu\),Verbose\(1, RECUSADA/);
        expect(script).toMatch(/nao tem o prefixo/);
    });

    it('número implausível também recusa (E.164 sem o + tem 10 a 15 dígitos)', () => {
        // Discar lixo faz o colaborador ouvir silêncio sem saber por quê.
        expect(script).toMatch(/numeroruim\),Verbose\(1, RECUSADA/);
        expect(script).toMatch(/< 10 \| .* > 15/);
    });

    it('sem destino da Meta a saída continua bloqueada, dizendo o porquê', () => {
        expect(script).toMatch(/SAIDA BLOQUEADA: META_SIP_DESTINO vazio/);
    });
});

// 🐛 DEFEITO MEU, PEGO ANTES DE SUBIR: escrevi `$[` sem escapar dentro do
// heredoc NÃO-CITADO que gera o extensions.conf. `$[...]` é aritmética legada
// do bash — ele TENTA avaliar `$["*55" = ""]` e o script MORRE com "operand
// expected". As linhas antigas escapavam (`\$[`); as minhas não.
//
// A varredura fecha a CLASSE: no Asterisk `$[...]` é expressão e aparece em
// todo GotoIf, então a próxima linha nova cai na mesma armadilha. `bash -n`
// não pega — ele não avalia heredoc.
describe('nenhum $[ do Asterisk fica sem escape no heredoc', () => {
    it('todo $[ do script está escapado como \\$[', () => {
        const semEscape = script.split('\n')
            .map((l, i) => ({ n: i + 1, l }))
            // Só o `$[` precedido de barra invertida é seguro.
            .filter(({ l }) => /(^|[^\\])\$\[/.test(l));
        expect(semEscape.map((x) => `${x.n}: ${x.l.trim()}`)).toEqual([]);
    });
});

// ═══ 25/08 — AS DUAS DIREÇÕES SÃO PROBLEMAS DIFERENTES ═════════════════════
// Paulo: "vamos separar bem as 2 vertentes de saída de ligação. A saída via
// WhatsApp tem CLIENTE CERTO, colaborador já sabe com quem quer falar da sua
// lista, e pronto! Agora a entrada, aí sim deve passar pela URA, uma vez que
// não tem como cair no atendente correto."
//
// 🚨 O erro de desenho era MEU: tratei as duas como uma coisa só e propus
// prefixo discado para a SAÍDA. Ele apontou o custo real — a permissão é
// pedida DENTRO da conversa, o cliente autoriza NAQUELA conversa, e o app já
// tem o número. Mandar redigitar num teclado reintroduz à mão um dado que o
// sistema tem, e é aí que um dígito errado liga para um estranho com o
// WhatsApp do escritório.
//
// A trava é de GOVERNO: ela impede que a próxima sessão leia o prefixo como o
// caminho principal e reconstrua o que foi descartado.
describe('a saída pelo teclado é caminho SECUNDÁRIO, com o motivo registrado', () => {
    const doc = readFileSync(join(process.cwd(), 'docs/sbc-whatsapp-hitphone.md'), 'utf8');

    it('o script declara o botão na conversa como caminho PRINCIPAL', () => {
        expect(script).toMatch(/CAMINHO SECUNDÁRIO/);
        expect(script).toMatch(/O caminho PRINCIPAL é o BOTÃO na conversa/);
    });

    it('e guarda a fala que derrubou o desenho anterior', () => {
        expect(script).toMatch(/não faz o menor sentido/);
    });

    it('o documento separa as duas direções por QUEM SABE com quem quer falar', () => {
        expect(doc).toMatch(/AS DUAS DIREÇÕES SÃO PROBLEMAS DIFERENTES/);
        expect(doc).toMatch(/SAÍDA — botão na conversa \(click-to-call\)/);
        expect(doc).toMatch(/ENTRADA — pela URA, não por um ramal/);
    });

    it('e diz que a saída ainda depende da ENTRADA (não há como inverter)', () => {
        // Prometer a discagem antes do META_SIP_DESTINO seria construir botão
        // que não disca — a família da promessa que a tela não cumpre.
        expect(doc).toMatch(/A entrada destrava a saída/);
    });
});

describe('a ENTRADA cai na URA que o Paulo decidiu', () => {
    // ⚠️ TRAVA LITERAL TROCADA (25/08). Ela prendia `SBC_DESTINO:-221` e a frase
    // "O default 221 era do PRIMEIRO TESTE" — ou seja, prendia o estado
    // PROVISÓRIO e reprovaria justamente a decisão que ela estava esperando.
    // Paulo respondeu: *"Ramal rota ramal 211, central URA"*. O que a trava
    // garante agora é a INTENÇÃO: o destino é parâmetro, o default é a URA (não
    // o ramal de uma pessoa) e a decisão está escrita com a fala que a gerou.
    it('o destino é PARÂMETRO, e o default é a telefonista (não o ramal do teste)', () => {
        expect(script).toMatch(/SBC_DESTINO="\$\{SBC_DESTINO:-211\}"/);
        expect(script).not.toMatch(/SBC_DESTINO:-221/);   // o ramal do teste não volta a ser default
        expect(script).toMatch(/telefonista/);            // o que o 211 É, com a fala que decidiu
    });

    // 🐛 DEFEITO MEU, DE DEZ MINUTOS (25/08). Ao ler "Ramal rota ramal 211,
    // central URA" eu registrei que o 211 ERA a URA — e escrevi isso no script,
    // no documento e nesta trava. O Paulo corrigiu na mensagem seguinte: "O
    // ramal 211 é telefonista ou seja 1 opção quando recebemos ligação". A
    // trava velha prendia a afirmação FALSA, então ela tinha que cair junto.
    it('🚨 o 211 NÃO é vendido como a URA — ele é UMA opção dentro dela', () => {
        const doc = readFileSync(join(process.cwd(), 'docs/sbc-whatsapp-hitphone.md'), 'utf8');
        expect(doc).not.toMatch(/É a MESMA URA de quem liga no fixo/);
        expect(doc).toMatch(/telefonista/i);
        expect(doc).toMatch(/uma opção DENTRO/i);
    });

    // ⚠️ TRAVA TROCADA PELA 3ª VEZ NA MESMA HORA — e as três porque eu estava
    // travando DEDUÇÃO MINHA, não a operação. A anterior dizia que "o DTMF
    // decide URA × telefonista"; o Paulo respondeu que a URA daqui **não tem
    // opção de discagem** — ela atende e cai na telefonista, em qualquer meio.
    // Não há menu para digitar, então teclado não decide nada.
    it('🚨 a URA NÃO tem opção de discagem — e o documento diz isso', () => {
        const doc = readFileSync(join(process.cwd(), 'docs/sbc-whatsapp-hitphone.md'), 'utf8');
        expect(doc).toMatch(/não tem opção de\s*\n?\s*discagem/i);
        expect(doc).toMatch(/DTMF não decide nada|teclado não decide nada/i);
    });

    it('🚨 o funil é UM SÓ — nada de rotear a chamada de WhatsApp por dono/fila', () => {
        // Rotear por identidade criaria uma SEGUNDA regra para o mesmo cliente:
        // quem liga do celular cai na telefonista, quem liga pelo WhatsApp
        // cairia num ramal. "Mesma coisa, só muda o meio" (Paulo, 25/08).
        const doc = readFileSync(join(process.cwd(), 'docs/sbc-whatsapp-hitphone.md'), 'utf8');
        expect(doc).toMatch(/O FUNIL É UM SÓ/);
        expect(doc).toMatch(/SEGUNDA\s*\n?\s*regra/);
        expect(script).toMatch(/NÃO rotear a chamada de WhatsApp por dono\/fila/);
        // O dialplan tem que continuar simples: um destino, sem consulta ao app.
        expect(script).toMatch(/Dial\(PJSIP\/\$\{SBC_DESTINO\}@hit,60\)/);
    });

    it('a identidade serve ao REGISTRO, e ele vem do CDR (não do webhook)', () => {
        const doc = readFileSync(join(process.cwd(), 'docs/sbc-whatsapp-hitphone.md'), 'utf8');
        expect(doc).toMatch(/CDR do SBC/);
        expect(doc).toMatch(/não manda evento de\s*\n?\s*chamada no webhook/);
    });

    it('🚨 trocar o destino NÃO é dito como conserto do bloqueio da Meta', () => {
        // Sem isto, quem ler "URA decidida" conclui que a ligação passou a
        // funcionar — e ela não passou: o INVITE não chega ao tronco.
        const doc = readFileSync(join(process.cwd(), 'docs/sbc-whatsapp-hitphone.md'), 'utf8');
        expect(doc).toMatch(/NÃO destrava a ligação/);
    });
});

// ═══ 25/08 — O SBC NASCEU SEM DEIXAR RASTRO ════════════════════════════════
// A primeira ligação REAL entrou ("Não atendida" no celular do cliente, 14:17)
// e NÃO HAVIA COMO PROVAR se ela chegou aqui:
//  · `/var/log/asterisk/full` não existia — o pacote do Ubuntu só escreve
//    `messages`, sem verbose, então a linha do dialplan (NoOp) não é escrita
//    em lugar nenhum;
//  · `cdr-csv/Master.csv` também não existia.
//
// 🚨 O silêncio não distinguia "não chegou" de "chegou e ninguém anotou" — a
// pior forma de silêncio, e a MESMA classe que este projeto persegue em toda
// tela. Infraestrutura de diagnóstico que não registra é farol apagado.
describe('toda chamada deixa marca — senão o silêncio mente', () => {
    it('o logger grava VERBOSE em `full` (é dele que sai o INVITE da Meta)', () => {
        expect(script).toMatch(/full => notice,warning,error,verbose/);
    });

    it('e o verbose PERSISTE no asterisk.conf, não em comando de sessão', () => {
        // `core set verbose` some no primeiro restart — foi assim que a
        // ligação de hoje passou sem registro.
        expect(script).toMatch(/verbose = 3/);
        expect(script).toMatch(/grep -q '\^verbose' \/etc\/asterisk\/asterisk\.conf/);
    });

    it('o CDR grava UMA LINHA POR CHAMADA, inclusive as NÃO ATENDIDAS', () => {
        // É a prova barata de "chegou ou não chegou": não depende de logger,
        // de verbose nem de alguém com o console aberto na hora. E `unanswered`
        // é o que importa aqui — a ligação de hoje não foi atendida.
        expect(script).toMatch(/enable = yes/);
        expect(script).toMatch(/unanswered = yes/);
    });
});

// ═══ 25/08 — HEREDOC DE DOIS NÍVEIS: o script morreu NA VM ═════════════════
// `EXTEN: unbound variable` — o provisionamento abortou e NADA foi aplicado
// (nem o logger, nem o CDR que este mesmo PR tinha acabado de acrescentar).
//
// 🚨 A CAUSA É DE ESTRUTURA, e mordeu DUAS vezes no mesmo dia:
//  · o script LOCAL monta o script da VM dentro de `cat > "$STARTUP" <<EOF`
//    (não citado) — ali o shell LOCAL expande `$var` e executa CRASE;
//  · o script da VM escreve o extensions.conf dentro de outro heredoc — e
//    esse estava NÃO CITADO também, então o shell da VM tentava expandir
//    `${EXTEN}` (que é variável do ASTERISK, não do shell) e, com
//    `set -u`, matava tudo.
//
// ✂️ A correção é de UMA letra e resolve a classe: os heredocs do lado da VM
// passam a ser CITADOS (`<<'CONF'`). As variáveis de SHELL já foram expandidas
// no nível local — quando o arquivo chega na VM não há mais nada a expandir —,
// então tudo que é do Asterisk atravessa intacto.
//
// ⚠️ E as CRASES dos meus comentários viravam substituição de comando no nível
// local: foi de lá que saíram os "messages: command not found" e o
// "/var/log/asterisk/full: No such file or directory" NO MAC.
//
// 📌 `bash -n` não pega nenhum dos dois: ele não avalia heredoc. Só GERAR o
// arquivo e conferir pega — e é o que este teste faz.
describe('o script da VM é GERADO e conferido, não suposto', () => {
    const execSync = require('child_process').execSync as typeof import('child_process').execSync;
    const os = require('os') as typeof import('os');
    const fs = require('fs') as typeof import('fs');

    // Recorta a montagem do STARTUP e a executa com valores de exemplo — o
    // mesmo caminho que roda na máquina do Paulo, sem tocar em gcloud.
    const gerado = (() => {
        const i = script.indexOf('STARTUP=$(mktemp)');
        const j = script.indexOf('\nEOF\n', i) + '\nEOF\n'.length;
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'sbc-'));
        const monta = join(dir, 'monta.sh');
        fs.writeFileSync(monta, [
            '#!/usr/bin/env bash', 'set -euo pipefail',
            'SBC_HOST=sip.exemplo.com.br', 'LE_EMAIL=a@b.c', 'IP=1.2.3.4',
            'HIT_HOST=9.9.9.9', 'HIT_PORT=21694', 'SBC_DESTINO=221',
            "META_SIP_DESTINO=''", "SBC_PREFIXO_WHATSAPP='*55'",
            "BLOCO_META_SAIDA='; saida desligada'",
            `export TMPDIR=${dir}`,
            script.slice(i, j),
        ].join('\n'));
        execSync(`bash ${monta}`, { stdio: 'pipe' });
        const arquivos = fs.readdirSync(dir).filter((f) => f.startsWith('tmp.'));
        return fs.readFileSync(join(dir, arquivos[0]), 'utf8');
    })();

    it('o arquivo que vai para a VM tem sintaxe válida', () => {
        const os2 = require('os') as typeof import('os');
        const alvo = join(fs.mkdtempSync(join(os2.tmpdir(), 'sbcchk-')), 'vm.sh');
        fs.writeFileSync(alvo, gerado);
        // Se isto falhar, o provisionamento morre NA VM — e o sintoma chega
        // como "nada foi aplicado", não como erro de script.
        expect(() => execSync(`bash -n ${alvo}`, { stdio: 'pipe' })).not.toThrow();
    });

    it('as variáveis do ASTERISK chegam INTACTAS (não expandidas pelo shell)', () => {
        expect(gerado).toContain('${EXTEN}');
        expect(gerado).toContain('${ALVO}');
        expect(gerado).toContain('${FILTER(0-9,${EXTEN})}');
    });

    it('os heredocs do lado da VM são CITADOS — é o que as protege', () => {
        expect(gerado).toContain("cat > /etc/asterisk/extensions.conf <<'CONF'");
        expect(gerado).toContain("cat > /etc/asterisk/pjsip.conf <<'CONF'");
    });

    it('e as variáveis de SHELL já vieram resolvidas (nada sobra para a VM)', () => {
        expect(gerado).toContain('Dial(PJSIP/221@hit,60)');
        expect(gerado).not.toContain('${SBC_DESTINO}');
        expect(gerado).not.toContain('${IP}');
    });

    it('nenhuma CRASE no heredoc externo (ela vira comando no shell LOCAL)', () => {
        const i = script.indexOf('STARTUP=$(mktemp)');
        const j = script.indexOf('\nEOF\n', i);
        const comCrase = script.slice(i, j).split('\n')
            .map((l, n) => ({ n, l })).filter(({ l }) => l.includes('`'));
        expect(comCrase.map((x) => x.l.trim())).toEqual([]);
    });
});
