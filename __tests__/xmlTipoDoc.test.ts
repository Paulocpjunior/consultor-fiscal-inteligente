/**
 * Testes do classificador de tipoDoc (sefaz-backend/xml-tipo-doc.js).
 *
 * Trava o gap real: ANTES o backend nao reconhecia NFCe (procNFCe / modelo 65)
 * vinda do DistDFe — clientes varejistas perdiam captura. Cada teste cobre um
 * cenario real de schema que a SEFAZ entrega.
 */

// @ts-expect-error — modulo .js puro sem types. node --check garante sintaxe.
import { classificarTipoDoc } from '../sefaz-backend/xml-tipo-doc.js';

// Chave de NFCe (modelo 65, pos 21-22): cUF(35) AAMM(2605) CNPJ + mod=65
const CHAVE_NFCE = '3526' + '05' + '12345678000199' + '65' + '001' + '000000001' + '1' + '00000001' + '0';
// Chave de NFe (modelo 55)
const CHAVE_NFE  = '3526' + '05' + '12345678000199' + '55' + '001' + '000000001' + '1' + '00000001' + '0';
// Chave de CTe (modelo 57)
const CHAVE_CTE  = '3526' + '05' + '12345678000199' + '57' + '001' + '000000001' + '1' + '00000001' + '0';
// Chave de MDFe (modelo 58)
const CHAVE_MDFE = '3526' + '05' + '12345678000199' + '58' + '001' + '000000001' + '1' + '00000001' + '0';

describe('classificarTipoDoc — schemas reais do DistDFe', () => {
    it.each([
        ['procNFe_v4.00.xsd',         CHAVE_NFE,  'NFe',         'NFe'],
        ['resNFe_v1.01.xsd',          CHAVE_NFE,  'resNFe',      'NFe'],
        ['procNFCe_v4.00.xsd',        CHAVE_NFCE, 'NFCe',        'NFCe'],
        ['resNFCe_v1.01.xsd',         CHAVE_NFCE, 'resNFCe',     'NFCe'],
        ['procCTe_v4.00.xsd',         CHAVE_CTE,  'CTe',         'CTe'],
        ['resCTe_v1.00.xsd',          CHAVE_CTE,  'resCTe',      'CTe'],
        ['procMDFe_v3.00.xsd',        CHAVE_MDFE, 'MDFe',        'MDFe'],
        ['resMDFe_v1.00.xsd',         CHAVE_MDFE, 'resMDFe',     'MDFe'],
        ['procEPEC_v1.00.xsd',        CHAVE_NFE,  'EPEC',        'NFe'],
        ['procEventoNFe_v1.00.xsd',   CHAVE_NFE,  'eventoNFe',   'NFe'],
        ['procEventoCTe_v3.00.xsd',   CHAVE_CTE,  'eventoCTe',   'CTe'],
        ['procEventoMDFe_v3.00.xsd',  CHAVE_MDFE, 'eventoMDFe',  'MDFe'],
    ])('schema=%s + chave modelo certo → tipoDoc=%s, tipoNormalizado=%s', (schema, chave, tipoDoc, tipoNormalizado) => {
        const r = classificarTipoDoc(schema, chave);
        expect(r).toEqual({ tipoDoc, tipoNormalizado });
    });
});

describe('classificarTipoDoc — protecao dupla: schema NFe + chave modelo 65', () => {
    it('resNFe + chave modelo 65 → classificado como resNFCe (cliente varejista)', () => {
        // Cenario real: resumo (resNFe_*) entregue pra NFCe — SEFAZ usa
        // o mesmo XSD de resumo pra ambos modelos. Sem essa proteção, NFCe
        // capturada como resumo apareceria na coluna "NFe" do frontend.
        const r = classificarTipoDoc('resNFe_v1.01.xsd', CHAVE_NFCE);
        expect(r).toEqual({ tipoDoc: 'resNFCe', tipoNormalizado: 'NFCe' });
    });

    it('procEventoNFe + chave modelo 65 → classificado como eventoNFCe', () => {
        // Cancelamento de NFCe é o caso comum.
        const r = classificarTipoDoc('procEventoNFe_v1.00.xsd', CHAVE_NFCE);
        expect(r).toEqual({ tipoDoc: 'eventoNFCe', tipoNormalizado: 'NFCe' });
    });

    it('resEvento + chave modelo 65 → eventoNFCe', () => {
        const r = classificarTipoDoc('resEvento_v1.00.xsd', CHAVE_NFCE);
        expect(r).toEqual({ tipoDoc: 'eventoNFCe', tipoNormalizado: 'NFCe' });
    });
});

describe('classificarTipoDoc — fallback por modelo quando schema vier vazio', () => {
    it('schema vazio + chave modelo 65 → NFCe', () => {
        expect(classificarTipoDoc(null, CHAVE_NFCE)).toEqual({ tipoDoc: 'NFCe', tipoNormalizado: 'NFCe' });
        expect(classificarTipoDoc('',   CHAVE_NFCE)).toEqual({ tipoDoc: 'NFCe', tipoNormalizado: 'NFCe' });
    });

    it('schema vazio + chave modelo 55 → NFe', () => {
        expect(classificarTipoDoc(undefined, CHAVE_NFE)).toEqual({ tipoDoc: 'NFe', tipoNormalizado: 'NFe' });
    });

    it('schema vazio + chave modelo 57 → CTe', () => {
        expect(classificarTipoDoc(null, CHAVE_CTE)).toEqual({ tipoDoc: 'CTe', tipoNormalizado: 'CTe' });
    });

    it('schema vazio + chave modelo 58 → MDFe', () => {
        expect(classificarTipoDoc(null, CHAVE_MDFE)).toEqual({ tipoDoc: 'MDFe', tipoNormalizado: 'MDFe' });
    });

    it('schema vazio + sem chave → desconhecido (nao inventa)', () => {
        expect(classificarTipoDoc(null, null)).toEqual({ tipoDoc: 'desconhecido', tipoNormalizado: 'desconhecido' });
        expect(classificarTipoDoc(null, '')).toEqual({ tipoDoc: 'desconhecido', tipoNormalizado: 'desconhecido' });
        expect(classificarTipoDoc(null, 'abc')).toEqual({ tipoDoc: 'desconhecido', tipoNormalizado: 'desconhecido' });
    });
});

describe('classificarTipoDoc — não regride NFe (PR #43)', () => {
    it('procNFe ainda eh NFe (upgrade resumo→completa nao quebra)', () => {
        expect(classificarTipoDoc('procNFe_v4.00.xsd', CHAVE_NFE))
            .toEqual({ tipoDoc: 'NFe', tipoNormalizado: 'NFe' });
    });

    it('resNFe sem chave (caso degradado) ainda eh resNFe modelo NFe', () => {
        expect(classificarTipoDoc('resNFe_v1.01.xsd', null))
            .toEqual({ tipoDoc: 'resNFe', tipoNormalizado: 'NFe' });
    });
});
