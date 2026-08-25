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
