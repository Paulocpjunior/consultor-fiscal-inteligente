// ============================================================================
// 🚨 SALDO CREDOR ANTERIOR — o arquivo declarava ZERO sem ninguém ter conferido.
//
// Paulo, 17/08: *"essa empresa possui saldos acumulados de meses anteriores…
// hoje, na competência 07/2026, o Consultor me apresenta corretamente a
// movimentação e o saldo referente ao mês, mas a apuração não está considerando
// o saldo que já vinha sendo acumulado nas competências anteriores."*
//
// Fui ler, e são TRÊS apurações com TRÊS comportamentos — nenhum deles avisava:
//
//   ICMS próprio (E110 c.10)  lê `saldoCredorIcms` da ficha da competência
//                             ANTERIOR — que é o que ENTROU naquele mês, não o
//                             que SOBROU dele. Transporta DEFASADO.
//   IPI (E520 VL_SC_ANT_IPI)  o gerador lê `saldoCredorIpiAnterior` e o
//                             orquestrador nunca passa ⇒ SEMPRE 0,00.
//   ST (E210 VL_SLD_CRED_ANT) `apurarStDaUf` aceita `saldoCredorAnterior` e
//                             ninguém passa ⇒ SEMPRE 0,00.
//
// ZERO NUM CAMPO DE SALDO É UMA AFIRMAÇÃO À SEFAZ. Para quem tem crédito
// acumulado, o arquivo recolhe a MAIOR — e nada denuncia, porque ele é aceito.
//
// Este PR não inventa o saldo (seria adivinhar imposto): ele faz o que a casa
// faz com ausência — DIZ que declarou zero, e por quê.
// ============================================================================
import { avisosDeSaldoAnterior } from '../sefaz-backend/saldo-anterior-apuracao.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const juntou = (avisos: string[]) => avisos.join('\n');

describe('zero declarado é dito, não engolido', () => {
    it('ICMS sem saldo: diz que é AFIRMAÇÃO e que pode estar recolhendo a maior', () => {
        const a = juntou(avisosDeSaldoAnterior({ icmsAnterior: 0 }));
        expect(a).toMatch(/AFIRMAÇÃO/);
        expect(a).toMatch(/recolhendo a MAIOR/);
        // A ação tem que estar na frase — alarme sem ação vira alarme ignorado.
        expect(a).toMatch(/Lance o saldo na ficha da competência anterior/);
    });

    it('ICMS COM saldo: sai carimbado com a ORIGEM e com a ressalva da defasagem', () => {
        const a = juntou(avisosDeSaldoAnterior({
            icmsAnterior: 12345.67, origemIcms: 'ficha da competência anterior',
        }));
        expect(a).toMatch(/12345\.67/);
        expect(a).toMatch(/origem: ficha da competência anterior/);
        // O ponto que evita confiar no número: ele NÃO é o saldo que sobrou.
        expect(a).toMatch(/não o saldo que sobrou dela/);
        expect(a).toMatch(/E110 campo 14/);
    });

    it('IPI só avisa quando o bloco E500/E520 SAI', () => {
        expect(juntou(avisosDeSaldoAnterior({ geraIpi: false }))).not.toMatch(/E520/);
        expect(juntou(avisosDeSaldoAnterior({ geraIpi: true }))).toMatch(/E520.*IPI = 0,00/s);
    });

    it('ST só avisa quando o bloco E200/E210 SAI', () => {
        expect(juntou(avisosDeSaldoAnterior({ geraSt: false }))).not.toMatch(/E210/);
        const a = juntou(avisosDeSaldoAnterior({ geraSt: true }));
        expect(a).toMatch(/E210/);
        // A régua fiscal que a frase precisa carregar: ST é apuração PRÓPRIA e
        // POR UF — somar com o ICMS próprio seria erro, não simplificação.
        expect(a).toMatch(/por UF de destino/);
        expect(a).toMatch(/não abate o de outra, nem o do ICMS próprio/);
    });

    it('alarme sem ação não nasce: bloco que não sai não gera aviso', () => {
        const a = avisosDeSaldoAnterior({ icmsAnterior: 500, geraIpi: false, geraSt: false });
        expect(a).toHaveLength(1);
    });
});

describe('🚨 e o gerador do bloco E CHAMA o aviso — núcleo sem leitor não protege', () => {
    const fonte = readFileSync(join(__dirname, '..', 'sefaz-backend/sped-fiscal-blocoE.js'), 'utf8');

    it('importa e chama', () => {
        expect(fonte).toMatch(/import \{ avisosDeSaldoAnterior \} from '\.\/saldo-anterior-apuracao\.js'/);
        expect(fonte).toMatch(/dados\.warnings\.push\(\.\.\.avisosDeSaldoAnterior\(/);
    });

    it('e as flags saem do bloco que REALMENTE foi gerado, não de um palpite', () => {
        // `geraIpi`/`geraSt` vêm do tamanho das linhas produzidas. Se alguém
        // trocar por "a empresa tem IPI no cadastro", o aviso volta a aparecer
        // em arquivo que não tem o bloco.
        expect(fonte).toMatch(/geraSt = st\.linhas\.length > 0/);
        expect(fonte).toMatch(/geraIpi = linhasIpi\.length > 0/);
    });
});
