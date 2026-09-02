// ============================================================================
// 🚨 "NÃO É DESTA EMPRESA" ≠ "NÃO CONSEGUI LER"
//
// 02/09, Ivan Inacio na empresa 0530, importando notas de serviço PRESTADO:
//
//   "O CNPJ 11010322000138 não consta como emitente nem destinatário deste XML
//    (emit: -, dest: 05022073000106)"
//
// O `emit: -` É A RESPOSTA: o app **não leu o prestador** daquele XML — e a
// empresa é justamente a prestadora. A frase afirmava sobre a POSSE, então ela
// manda conferir o cadastro do cliente (que está certo) e o arquivo (que
// também está). É a lição de 31/08 (MARCOS ANTONIO ZAMBOLIN) aplicada ao
// leitor do BACKEND, que é quem de fato recusa a importação.
//
// ⚠️ A recusa CONTINUA: sem um dos lados não dá para decidir a DIREÇÃO, e
// direção chutada é a nota no livro errado. O que muda é a causa e a ação.
// ============================================================================
import { matchCompanyAndDirection } from '../services/xmlParserService';

const doc = (emit: string | null, dest: string | null): any => ({
    emitente: { cnpjCpf: emit || '' },
    destinatario: { cnpjCpf: dest || '' },
    tpNF: undefined,
});

describe('matchCompanyAndDirection — a causa certa da recusa', () => {
    // O caso REAL do print (318.xml).
    it('lado ilegível é dito como LEITURA, nunca como posse', () => {
        const r = matchCompanyAndDirection(doc(null, '05022073000106'), '11010322000138');
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/Não deu para LER o emitente\/prestador/);
        // ⚠️ Não pode continuar afirmando que a nota não é da empresa.
        expect(r.motivo).not.toMatch(/não consta como emitente/);
        // A ação certa: o cadastro pode estar certo, quem não foi lido é o arquivo.
        expect(r.motivo).toMatch(/cadastro da empresa pode estar certo/);
    });

    it('diz o que CONSEGUIU ler — senão a pessoa não sabe o que o app viu', () => {
        const r = matchCompanyAndDirection(doc(null, '05022073000106'), '11010322000138');
        expect(r.motivo).toMatch(/só saiu o destinatário 05022073000106/);
    });

    it('os dois lados ilegíveis também são ditos como leitura', () => {
        const r = matchCompanyAndDirection(doc(null, null), '11010322000138');
        expect(r.motivo).toMatch(/emitente\/prestador nem o destinatário\/tomador/);
    });

    // 🚨 A recusa de POSSE continua existindo, e ela é a legítima: os DOIS
    // lados foram lidos e nenhum é a empresa.
    it('com os dois lados lidos, a recusa volta a ser de POSSE', () => {
        const r = matchCompanyAndDirection(doc('60397448000112', '05022073000106'), '11010322000138');
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/não consta como emitente nem destinatário/);
        // ⚠️ E sem o "-" de campo vazio, que era o que confundia as duas coisas.
        expect(r.motivo).not.toMatch(/emit: -|dest: -/);
    });

    it('a nota da própria empresa continua passando, com a direção', () => {
        expect(matchCompanyAndDirection(doc('11010322000138', '05022073000106'), '11010322000138'))
            .toEqual({ ok: true, direcao: 'saida' });
        expect(matchCompanyAndDirection(doc('05022073000106', '11010322000138'), '11010322000138'))
            .toEqual({ ok: true, direcao: 'entrada' });
    });
});
