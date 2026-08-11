/**
 * CAPTURA DO CST DO IPI — pré-requisito do E510 (consolidação por CFOP+CST_IPI).
 *
 * O de-para dizia: "E510 não é gerado: o CST do IPI não é capturado hoje". Mas o
 * CST ESTÁ no XML — o importer só não lia. Estes testes travam a captura:
 *   · IPITrib (tributado) → CST vem de lá, junto com vIPI/pIPI.
 *   · IPINT (não-tributado/isento/imune) → CST vem de lá, SEM valor — e ele
 *     TAMBÉM entra no E510 (por isso não pode sumir por não ter vIPI).
 *   · item SEM IPI → cstIpi é undefined/null, NUNCA "0" (campo fiscal não recebe
 *     default; ausência é ausência).
 */
// @ts-expect-error — módulo .js do backend (sem tipos)
import { extrairItens } from '../sefaz-backend/xml-importer.js';

const wrap = (dets: string) => `<?xml version="1.0"?>
<nfeProc><NFe><infNFe><det nItem="1">${dets}</det></infNFe></NFe></nfeProc>`;

describe('captura do CST do IPI', () => {
    it('IPITrib: pega CST tributado + valor + enquadramento', () => {
        const xml = wrap(`
            <prod><cProd>A1</cProd><NCM>22030000</NCM><CFOP>5101</CFOP><qCom>1</qCom><vProd>100</vProd></prod>
            <imposto><IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><pIPI>6.00</pIPI><vIPI>6.00</vIPI></IPITrib></IPI></imposto>
        `);
        const [item] = extrairItens(xml);
        expect(item.cstIpi).toBe('50');
        expect(item.cEnqIpi).toBe('999');
        expect(item.vIPI).toBe(6);
        expect(item.aliqIPI).toBe(6);
    });

    it('IPINT: pega CST não-tributado mesmo SEM valor de IPI', () => {
        const xml = wrap(`
            <prod><cProd>B2</cProd><NCM>10063021</NCM><CFOP>5102</CFOP><qCom>1</qCom><vProd>50</vProd></prod>
            <imposto><IPI><cEnq>999</cEnq><IPINT><CST>53</CST></IPINT></IPI></imposto>
        `);
        const [item] = extrairItens(xml);
        expect(item.cstIpi).toBe('53'); // entra no E510 mesmo sem vIPI
        expect(item.vIPI).toBe(0);
    });

    it('item SEM IPI: cstIpi ausente (null/undefined), nunca "0"', () => {
        const xml = wrap(`
            <prod><cProd>C3</cProd><NCM>94036000</NCM><CFOP>5405</CFOP><qCom>1</qCom><vProd>30</vProd></prod>
            <imposto><ICMS><ICMS00><CST>00</CST><vICMS>5.4</vICMS></ICMS00></ICMS></imposto>
        `);
        const [item] = extrairItens(xml);
        expect(item.cstIpi ?? null).toBeNull();
        expect(item.cEnqIpi ?? null).toBeNull();
    });
});
