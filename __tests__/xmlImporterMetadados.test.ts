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
