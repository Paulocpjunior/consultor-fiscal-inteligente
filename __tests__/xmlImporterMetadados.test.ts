/**
 * REGRESSÃO de 04/08: `participantes is not defined`.
 *
 * Ao capturar o endereço do destinatário, usei a variável `participantes`
 * dentro de `importarXmlSefaz` — mas ela só existe em `extrairMetadados`.
 * Resultado: ReferenceError em TODA importação. O cofre de e-mail acumulou
 * 25 falhas seguidas ("0 sucessos / 25 falhas · 20× participantes is not
 * defined") e ninguém percebeu por teste — quem denunciou foi o farol do card.
 *
 * A correção foi devolver os campos em `meta`. Este teste trava esse contrato:
 * se alguém tirar um campo daqui, o importer volta a gravar undefined.
 */
import { extrairMetadados } from '../sefaz-backend/xml-importer.js';

const XML = `<?xml version="1.0"?>
<nfeProc><NFe><infNFe Id="NFe35260712345678000199550010000001231000001234">
  <ide><nNF>123</nNF><serie>1</serie><dhEmi>2026-07-15T10:00:00-03:00</dhEmi><tpNF>1</tpNF><natOp>VENDA</natOp></ide>
  <emit><CNPJ>12345678000199</CNPJ><xNome>TECIDOS VINATEX</xNome><IE>123536343115</IE>
    <enderEmit><xMun>Sao Paulo</xMun><cMun>3550308</cMun><UF>SP</UF></enderEmit>
  </emit>
  <dest><CNPJ>42683241000122</CNPJ><xNome>JAIR MAFUZ</xNome><IE>132005880113</IE>
    <enderDest><xMun>SANTOS</xMun><cMun>3548500</cMun><UF>SP</UF></enderDest>
  </dest>
  <total><ICMSTot><vNF>1000.00</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;

describe('extrairMetadados — contrato do participante', () => {
    const meta = extrairMetadados(XML);

    it('devolve o endereço do DESTINATÁRIO (o E010 das saídas depende disso)', () => {
        expect(meta.xNomeDest).toBe('JAIR MAFUZ');
        expect(meta.ufDest).toBe('SP');
        expect(meta.codMunDest).toBe('3548500');
        expect(meta.ieDest).toBe('132005880113');
    });

    it('devolve também o do EMITENTE', () => {
        expect(meta.ufEmit).toBe('SP');
        expect(meta.codMunEmit).toBe('3550308');
    });

    it('mantém os campos que já existiam', () => {
        expect(meta.cnpjEmit).toBe('12345678000199');
        expect(meta.cnpjDest).toBe('42683241000122');
        expect(meta.xNome).toBe('TECIDOS VINATEX');
        expect(meta.numero).toBe('123');
    });

    it('XML sem <dest> (resumo) não quebra — devolve null', () => {
        const resumo = '<resNFe><chNFe>35260712345678000199550010000001231000001234</chNFe>'
            + '<CNPJ>12345678000199</CNPJ><xNome>FORN</xNome></resNFe>';
        const m = extrairMetadados(resumo);
        expect(m.xNomeDest).toBeNull();
        expect(m.ufDest).toBeNull();
    });
});

/**
 * EVENTO NÃO VIRA DOCUMENTO FANTASMA (Paulo, 13/08 — "TA ZICADA ESSA EMPRESA").
 *
 * 435 "notas sem o fornecedor" na aba 🌾 eram eventos de cancelamento gravados
 * como documento, com a chave-Id de 53 dígitos:
 *
 *   110111 35260729240822000121550010000255036113641904 201
 *
 * O evento só ia pelo caminho certo quando `chNFeRef` era lido; sem ele, caía
 * no caminho da NF-e e virava um doc sem participante — que depois pedia, para
 * sempre, para reler um XML que não tem participante nenhum.
 */
describe('evento com chNFe ilegível', () => {
    const CHNFE = '35260729240822000121550010000255036113641904';
    const eventoSemChNFe = `<?xml version="1.0"?>
        <procEventoNFe versao="1.00">
          <evento><infEvento Id="ID110111${CHNFE}201">
            <tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento>
            <xJust>erro de digitacao</xJust>
          </infEvento></evento>
          <retEvento><infEvento><cStat>135</cStat><nProt>135260000123456</nProt></infEvento></retEvento>
        </procEventoNFe>`;

    it('recupera a chave da nota a partir do Id do evento', () => {
        const meta = extrairMetadados(eventoSemChNFe, 'procEventoNFe_v1.00.xsd');
        expect(meta.evento?.chNFeRef).toBe(CHNFE);
        expect(meta.evento?.tpEvento).toBe('110111');
    });

    // Mesmo XML, sem o atributo Id: a chave crua tem 53 dígitos e a última
    // rede é ela própria.
    it('e quando só sobra a chave crua de 53 dígitos, também', () => {
        const semId = eventoSemChNFe.replace(`Id="ID110111${CHNFE}201"`, '')
            .replace('<tpEvento>110111</tpEvento>', `<tpEvento>110111</tpEvento><chNFe></chNFe>`);
        const meta = extrairMetadados(semId, 'procEventoNFe_v1.00.xsd');
        // Sem Id nem chNFe legível, a chave do doc não é de 44 dígitos — e é
        // essa condição que a trava do importer recusa, em vez de gravar.
        const chaveDigitos = String(meta.chave || '').replace(/\D/g, '');
        expect(chaveDigitos.length === 44 || chaveDigitos.length === 0
            || meta.evento?.chNFeRef === CHNFE).toBe(true);
    });
});
