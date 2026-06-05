/**
 * Testes do normalizador de retenção DCTFWeb (XML CONSXMLDECLARACAO).
 * Filosofia idêntica ao MIT normalizer: extrai só tags da allowlist, nunca
 * inventa; shape inesperado -> lido=false com motivo (sem zeros falsos).
 */
// @ts-expect-error — módulo .js puro
import { normalizarRetencaoDctfweb } from '../sefaz-backend/dctfweb-retencao-normalizer.js';

describe('normalizarRetencaoDctfweb — XML no shape esperado', () => {
    it('soma vlrTotalRetPrinc + vlrTotalRetAdic em INSS', () => {
        const xml = `<?xml version="1.0"?>
          <dctfweb><apuracao><retencoes>
            <vlrTotalRetPrinc>523,95</vlrTotalRetPrinc>
            <vlrTotalRetAdic>10,00</vlrTotalRetAdic>
          </retencoes></apuracao></dctfweb>`;
        const r = normalizarRetencaoDctfweb(xml);
        expect(r.lido).toBe(true);
        expect(r.retencoes.INSS).toBe(533.95);
        expect(r.totalReconhecido).toBe(533.95);
        expect(r.camposUsados.some((c: any) => c.tag === 'vlrtotalretprinc'.toLowerCase())).toBe(true);
    });

    it('XML do mock provider é legível (round-trip do provider)', () => {
        // mesmo formato emitido por MockProvider.consultarXmlDeclaracao
        const xml = `<?xml version="1.0" encoding="UTF-8"?><dctfweb><identificacao>`
            + `<categoria>GERAL_MENSAL</categoria><anoPA>2026</anoPA><mesPA>4</mesPA></identificacao>`
            + `<apuracao><retencoes><vlrTotalRetPrinc>1234,56</vlrTotalRetPrinc>`
            + `<vlrTotalRetAdic>0,00</vlrTotalRetAdic></retencoes></apuracao></dctfweb>`;
        const r = normalizarRetencaoDctfweb(xml);
        expect(r.lido).toBe(true);
        expect(r.retencoes.INSS).toBe(1234.56);
    });

    it('namespace com prefixo não atrapalha (localName)', () => {
        const xml = `<x:dctfweb xmlns:x="urn:foo"><x:retencoes>`
            + `<x:inssRetido>100,00</x:inssRetido></x:retencoes></x:dctfweb>`;
        const r = normalizarRetencaoDctfweb(xml);
        expect(r.lido).toBe(true);
        expect(r.retencoes.INSS).toBe(100);
    });
});

describe('normalizarRetencaoDctfweb — honestidade', () => {
    it('XML sem tag de retenção conhecida -> lido=false, sem zeros falsos', () => {
        const xml = `<dctfweb><identificacao><categoria>GERAL_MENSAL</categoria></identificacao></dctfweb>`;
        const r = normalizarRetencaoDctfweb(xml);
        expect(r.lido).toBe(false);
        expect(r.motivo).toMatch(/allowlist|reconhecida|serpro-smoke/i);
        expect(r.totalReconhecido).toBe(0);
    });

    it('entrada vazia -> lido=false', () => {
        expect(normalizarRetencaoDctfweb('').lido).toBe(false);
        expect(normalizarRetencaoDctfweb(null).lido).toBe(false);
    });

    it('XML ilegível -> lido=false', () => {
        const r = normalizarRetencaoDctfweb('<<<não-é-xml');
        expect(r.lido).toBe(false);
    });

    it('aceita objeto já parseado (não só XML)', () => {
        const r = normalizarRetencaoDctfweb({ apuracao: { retencoes: { vlrTotalRetPrinc: '523,95' } } });
        expect(r.lido).toBe(true);
        expect(r.retencoes.INSS).toBe(523.95);
    });
});
