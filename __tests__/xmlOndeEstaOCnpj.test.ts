// ============================================================================
// 🚨 A PERGUNTA QUE O COLABORADOR NÃO CONSEGUE RESPONDER SOZINHO
//
// 02/09, caso do Ivan (0530). A importação recusou com `emit: -` e eu pedi o
// arquivo. Paulo cortou: *"como vou enviar um arquivo se você diz que não
// posso capturar?"* — e a régua de 24/08 já dizia o mesmo: **quando o app tem
// como saber a resposta, avisar não é entrega, é passar o problema adiante**.
//
// O app TEM o XML. Então ele responde: *"o CNPJ desta empresa está aqui
// dentro? em qual tag?"* — e a resposta conserta o leitor sem ninguém enviar
// nada a ninguém.
//
// ⚠️ Sai ESTRUTURA (nome de tag) e o CNPJ que a própria pessoa digitou. Nenhum
// outro valor do documento é exposto.
// ============================================================================
import { documentosNoXml, procurarCnpjNoXml, explicarProcura } from '../services/xmlOndeEstaOCnpj';

// ABRASF v2 — o prestador com o CNPJ solto e o tomador embrulhado em CpfCnpj.
const ABRASF = `<?xml version="1.0"?>
<CompNfse><Nfse><InfNfse>
  <PrestadorServico><IdentificacaoPrestador>
    <Cnpj>11010322000138</Cnpj><InscricaoMunicipal>123</InscricaoMunicipal>
  </IdentificacaoPrestador></PrestadorServico>
  <TomadorServico><IdentificacaoTomador><CpfCnpj>
    <Cnpj>05022073000106</Cnpj>
  </CpfCnpj></IdentificacaoTomador></TomadorServico>
</InfNfse></Nfse></CompNfse>`;

describe('documentosNoXml — lê o caminho, não prevê a estrutura', () => {
    it('acha todo CNPJ com a trilha de tags até ele', () => {
        const docs = documentosNoXml(ABRASF);
        expect(docs.map(d => d.documento)).toEqual(['11010322000138', '05022073000106']);
        expect(docs[0].caminho).toEqual([
            'CompNfse', 'Nfse', 'InfNfse', 'PrestadorServico', 'IdentificacaoPrestador', 'Cnpj',
        ]);
        expect(docs[1].caminho).toContain('CpfCnpj');
    });

    // ⚠️ Prefixo de namespace não é o nome da tag — `ns2:Cnpj` é `Cnpj`.
    it('ignora o prefixo de namespace', () => {
        const docs = documentosNoXml('<ns2:Prestador><ns2:Cnpj>11010322000138</ns2:Cnpj></ns2:Prestador>');
        expect(docs[0].tag).toBe('Cnpj');
        expect(docs[0].caminho).toEqual(['Prestador', 'Cnpj']);
    });

    // ⚠️ Número solto de outro campo NÃO é documento: só 11 e 14 dígitos.
    it('não confunde valor/chave com CNPJ', () => {
        const docs = documentosNoXml('<v><Valor>1234567</Valor><ch>'
            + '35240611010322000138550010000000071000000079</ch></v>');
        expect(docs).toEqual([]);
    });
});

describe('procurarCnpjNoXml — as duas respostas mandam a lugares OPOSTOS', () => {
    it('CNPJ presente ⇒ o defeito é do LEITOR, e a tag é a correção', () => {
        const p = procurarCnpjNoXml(ABRASF, '11.010.322/0001-38');
        expect(p.encontrado).toBe(true);
        const frase = explicarProcura(p, '11010322000138');
        expect(frase).toMatch(/ESTÁ neste XML/);
        expect(frase).toMatch(/PrestadorServico › IdentificacaoPrestador › Cnpj/);
        expect(frase).toMatch(/o app é que ainda não sabe ler/);
        // 🚨 E NÃO manda mexer em cadastro: o cadastro está certo.
        expect(frase).not.toMatch(/cadastro/i);
    });

    it('CNPJ ausente ⇒ a recusa estava certa, e a tela diz de quem é o arquivo', () => {
        const p = procurarCnpjNoXml(ABRASF, '99999999000199');
        expect(p.encontrado).toBe(false);
        const frase = explicarProcura(p, '99999999000199');
        expect(frase).toMatch(/NÃO aparece em lugar nenhum/);
        expect(frase).toMatch(/11010322000138, 05022073000106/);
        expect(frase).toMatch(/confira se a empresa selecionada/);
    });

    // ⚠️ Arquivo sem documento nenhum é OUTRO problema (baixa incompleta), e
    // dizer "é de outra empresa" ali mandaria procurar no lugar errado.
    it('arquivo sem CNPJ nenhum não vira "é de outra empresa"', () => {
        const p = procurarCnpjNoXml('<Nfse><Numero>318</Numero></Nfse>', '11010322000138');
        expect(explicarProcura(p, '11010322000138')).toMatch(/incompleto ou não ser uma nota/);
    });

    // 🔒 Nenhum valor do documento vaza — só tag e o CNPJ que a pessoa digitou.
    it('a frase não expõe valor nenhum do documento', () => {
        const comValor = ABRASF.replace('</InfNfse>', '<ValorServicos>12345.67</ValorServicos></InfNfse>');
        const p = procurarCnpjNoXml(comValor, '11010322000138');
        expect(explicarProcura(p, '11010322000138')).not.toMatch(/12345/);
    });
});
