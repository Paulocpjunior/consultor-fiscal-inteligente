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

describe('a ENTRADA cai onde o Paulo mandar — e o 221 era do TESTE', () => {
    it('SBC_DESTINO é parâmetro e o comentário diz que o default era de teste', () => {
        expect(script).toMatch(/SBC_DESTINO="\$\{SBC_DESTINO:-221\}"/);
        expect(script).toMatch(/O default 221 era do PRIMEIRO TESTE/);
        expect(script).toMatch(/aponte para a URA/);
    });

    it('e a URA tem que ser a MESMA de quem liga no fixo (uma triagem só)', () => {
        const doc = readFileSync(join(process.cwd(), 'docs/sbc-whatsapp-hitphone.md'), 'utf8');
        expect(doc).toMatch(/A URA deve ser a MESMA de quem liga no fixo/);
    });
});
