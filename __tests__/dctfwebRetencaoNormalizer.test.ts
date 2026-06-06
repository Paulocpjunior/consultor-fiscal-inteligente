/**
 * Testes do normalizador de retenção DCTFWeb (XML CONSXMLDECLARACAO).
 * CALIBRADO contra XML REAL (XMLSaida_32602701000197_042026_40.xml):
 *   - INSS (cod 1162) = 523,95  ← bate com o R-2010 real (mesmo prestador)
 *   - IRRF (cod 1708) = 164,99
 *   - CSRF (cod 5952) = 621,29
 *   - débitos próprios (patronal/segurados/terceiros) e IRRF de folha = IGNORADOS
 */
import * as fs from 'fs';

// @ts-expect-error — módulo .js puro
import { normalizarRetencaoDctfweb } from '../sefaz-backend/dctfweb-retencao-normalizer.js';

const REAL = '/root/.claude/uploads/397fe5b6-3431-4ff6-b38a-f6d52ff24969/2e76656f-XMLSaida_32602701000197_042026_40.xml';

describe('normalizarRetencaoDctfweb — XML REAL (DCTFWeb Geral Mensal)', () => {
    it('extrai só as 3 retenções Reinf, ignora os 11 débitos próprios', () => {
        if (!fs.existsSync(REAL)) return;
        const r = normalizarRetencaoDctfweb(fs.readFileSync(REAL, 'utf8'));
        expect(r.lido).toBe(true);
        expect(r.retencoes.INSS).toBe(523.95);   // = R-2010 real, à centavo
        expect(r.retencoes.IRRF).toBe(164.99);
        expect(r.retencoes.CSRF).toBe(621.29);
        expect(r.totalReconhecido).toBe(1310.23);
        expect(r.detalhes).toHaveLength(3);
        expect(r.ignorados).toBe(11);            // todos os outros CreditoTributarioApurado
    });

    it('a linha de INSS carrega o ctCnpj do prestador (ponto de cruzamento c/ R-2010)', () => {
        if (!fs.existsSync(REAL)) return;
        const r = normalizarRetencaoDctfweb(fs.readFileSync(REAL, 'utf8'));
        const inss = r.detalhes.find((d: any) => d.familia === 'INSS');
        expect(inss.codReceita).toBe('116201');
        expect(inss.ctCnpj).toBe('03222111000130');
        expect(inss.valor).toBe(523.95);
    });

    it('NÃO confunde IRRF de folha (cod 5610) com retenção Reinf', () => {
        if (!fs.existsSync(REAL)) return;
        const r = normalizarRetencaoDctfweb(fs.readFileSync(REAL, 'utf8'));
        // 56107 (IRRF salários, R$ 10.361,37) não pode entrar em IRRF nem em lugar nenhum
        expect(r.retencoes.IRRF).toBe(164.99); // só o 170806, não o 56107
        expect(r.detalhes.some((d: any) => d.codReceita === '56107')).toBe(false);
    });
});

describe('normalizarRetencaoDctfweb — mock provider e honestidade', () => {
    it('aceita { xml } (shape do provider)', () => {
        const xml = `<ProcDctf xmlns="http://www.serpro.gov.br/dctf/v1"><A050-CreditosTributariosApurados>`
            + `<CreditoTributarioApurado><codReceita>116201</codReceita>`
            + `<ctValor>523.95</ctValor></CreditoTributarioApurado>`
            + `</A050-CreditosTributariosApurados></ProcDctf>`;
        const r = normalizarRetencaoDctfweb({ xml, fonte: 'serpro' });
        expect(r.lido).toBe(true);
        expect(r.retencoes.INSS).toBe(523.95);
    });

    it('declaração só com débitos próprios -> lido=true, retenções 0 (sem fake)', () => {
        const xml = `<ProcDctf><CreditoTributarioApurado><codReceita>113801</codReceita>`
            + `<ctValor>65833.70</ctValor></CreditoTributarioApurado></ProcDctf>`;
        const r = normalizarRetencaoDctfweb(xml);
        expect(r.lido).toBe(true);
        expect(r.totalReconhecido).toBe(0);
        expect(r.ignorados).toBe(1);
    });

    it('XML sem CreditoTributarioApurado -> lido=false com motivo', () => {
        const r = normalizarRetencaoDctfweb('<ProcDctf><vazio/></ProcDctf>');
        expect(r.lido).toBe(false);
        expect(r.motivo).toMatch(/CreditoTributarioApurado|serpro-smoke/i);
    });

    it('entrada vazia / ilegível -> lido=false', () => {
        expect(normalizarRetencaoDctfweb('').lido).toBe(false);
        expect(normalizarRetencaoDctfweb(null).lido).toBe(false);
        expect(normalizarRetencaoDctfweb('<<<não-xml').lido).toBe(false);
    });
});
