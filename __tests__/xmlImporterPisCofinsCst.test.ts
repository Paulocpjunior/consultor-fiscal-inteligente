/**
 * CAPTURA DO CST DE PIS/COFINS — pré-requisito da apuração não-cumulativa.
 *
 * MESMA ARMADILHA DO IPI (#563): o CST está no XML e o importer só lia valor e
 * alíquota. É esse campo que decide se a ENTRADA gera crédito no regime
 * não-cumulativo (Lei 10.637/02 art. 3º e Lei 10.833/03 art. 3º) — 50-56 dão
 * direito, 70-75 não dão, 98/99 são "outras operações".
 *
 * Sem ele, a base de crédito do PIS/COFINS só pode ser DIGITADA à mão, e foi por
 * isso que a apuração foi parar num Excel (caso WALDESA, 12/08): planilha
 * montando crédito por conta analítica do balancete, com o encadeamento de saldo
 * credor em branco e "contribuição a recolher" saindo NEGATIVA.
 *
 * Paridade obrigatória: o parser do FRONT (xmlParserService) lê os mesmos
 * campos. Ler só de um lado é como as duas leituras divergem sem ninguém ver.
 */
// @ts-expect-error — módulo .js do backend (sem tipos)
import { extrairItens } from '../sefaz-backend/xml-importer.js';

const wrap = (dets: string) => `<?xml version="1.0"?>
<nfeProc><NFe><infNFe><det nItem="1">${dets}</det></infNFe></NFe></nfeProc>`;

const prod = '<prod><cProd>A1</cProd><NCM>22030000</NCM><CFOP>1102</CFOP><qCom>1</qCom><vProd>1000</vProd></prod>';

describe('captura do CST de PIS/COFINS', () => {
    it('PISAliq/COFINSAliq: pega CST, base, alíquota e valor', () => {
        const xml = wrap(`${prod}
            <imposto>
                <PIS><PISAliq><CST>01</CST><vBC>1000.00</vBC><pPIS>1.65</pPIS><vPIS>16.50</vPIS></PISAliq></PIS>
                <COFINS><COFINSAliq><CST>01</CST><vBC>1000.00</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>76.00</vCOFINS></COFINSAliq></COFINS>
            </imposto>`);
        const [item] = extrairItens(xml);
        expect(item.cstPis).toBe('01');
        expect(item.vBcPis).toBe(1000);
        expect(item.aliqPIS).toBe(1.65);
        expect(item.vPIS).toBe(16.5);
        expect(item.cstCofins).toBe('01');
        expect(item.vBcCofins).toBe(1000);
        expect(item.aliqCOFINS).toBe(7.6);
        expect(item.vCOFINS).toBe(76);
    });

    it('PISNT (não tributado): o CST vem MESMO sem valor', () => {
        // 07/08/09 não geram crédito — e é justamente por isso que precisam ser
        // lidos: some do XML ⇒ o app não sabe distinguir "não credita" de
        // "não olhei".
        const xml = wrap(`${prod}
            <imposto>
                <PIS><PISNT><CST>07</CST></PISNT></PIS>
                <COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>
            </imposto>`);
        const [item] = extrairItens(xml);
        expect(item.cstPis).toBe('07');
        expect(item.cstCofins).toBe('07');
        expect(item.vPIS).toBe(0);
    });

    it('PISOutr com CST 50 (entrada COM direito a crédito)', () => {
        const xml = wrap(`${prod}
            <imposto>
                <PIS><PISOutr><CST>50</CST><vBC>1000.00</vBC><pPIS>1.65</pPIS><vPIS>16.50</vPIS></PISOutr></PIS>
                <COFINS><COFINSOutr><CST>50</CST><vBC>1000.00</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>76.00</vCOFINS></COFINSOutr></COFINS>
            </imposto>`);
        const [item] = extrairItens(xml);
        expect(item.cstPis).toBe('50');
        expect(item.cstCofins).toBe('50');
    });

    it('item SEM bloco de PIS/COFINS: CST é ausente, NUNCA "0"', () => {
        // Campo fiscal não recebe default: "sem CST" é diferente de "CST zero",
        // e tratar ausência como zero é o que produziu o Bloco H inteiro zerado.
        const xml = wrap(`${prod}<imposto><ICMS><ICMS00><CST>00</CST></ICMS00></ICMS></imposto>`);
        const [item] = extrairItens(xml);
        expect(item.cstPis == null).toBe(true);
        expect(item.cstCofins == null).toBe(true);
    });

    it('PIS e COFINS podem ter CST DIFERENTES — não se deduz um do outro', () => {
        const xml = wrap(`${prod}
            <imposto>
                <PIS><PISAliq><CST>01</CST><vBC>1000</vBC><pPIS>1.65</pPIS><vPIS>16.50</vPIS></PISAliq></PIS>
                <COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>
            </imposto>`);
        const [item] = extrairItens(xml);
        expect(item.cstPis).toBe('01');
        expect(item.cstCofins).toBe('07');
    });
});
