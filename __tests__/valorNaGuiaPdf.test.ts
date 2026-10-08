/**
 * 🧾 O VALOR DA GUIA ANEXADA CONFERE COM A APURAÇÃO? (08/10)
 *
 * Fatos cobrados: o valor apurado impresso no PDF confere em qualquer
 * formatação brasileira; PDF com outros valores DIVERGE (e diz quais);
 * PDF sem texto ou sem valor legível NÃO vira "confere" nem trava em falso.
 */
import { conferirValorNaGuia, valoresMonetariosDoTexto } from '../services/valorNaGuiaPdf';

// Texto no jeito que o pdfjs entrega: pedaços em linhas soltas.
const DAMSP = [
    'PREFEITURA DO MUNICÍPIO DE SÃO PAULO', 'DAMSP', 'Documento de Arrecadação do Município de São Paulo',
    'CCM', '3.199.033-9', 'Competência', '09/2026', 'Vencimento', '09/10/2026',
    'Valor do Tributo', '1.290,33', 'Multa', '0,00', 'Juros', '0,00', 'Valor Total', '1.290,33',
    '81600000012-9 90330000000-1 10092026000-0 00000000000-0',
].join('\n');

describe('valores em reais no texto', () => {
    it('lê 1.290,33 e 0,00, sem repetir, e ignora código de barras e datas', () => {
        expect(valoresMonetariosDoTexto(DAMSP)).toEqual([1290.33, 0]);
    });

    it('formatos com e sem milhar', () => {
        expect(valoresMonetariosDoTexto('R$ 17,86 e R$1290,33 e 12.345.678,90')).toEqual([12345678.9, 1290.33, 17.86]);
    });
});

describe('conferir o PDF contra a apuração', () => {
    it('o valor apurado está impresso: confere', () => {
        expect(conferirValorNaGuia([DAMSP], 1290.33)).toEqual({ situacao: 'confere', valor: 1290.33 });
    });

    it('o caso REALITY: apuração inflada (1.290,33) e guia do retido real (17,86) — diverge e diz o que o PDF traz', () => {
        const guiaReal = DAMSP.replace(/1\.290,33/g, '17,86');
        const r = conferirValorNaGuia([guiaReal], 1290.33);
        expect(r).toEqual({ situacao: 'diverge', valor: 1290.33, valoresNoPdf: [17.86, 0] });
    });

    it('centavo de diferença também diverge (arredondamento não aprova)', () => {
        expect(conferirValorNaGuia([DAMSP], 1290.34).situacao).toBe('diverge');
    });

    it('PDF imagem (sem texto): ilegível — nem confere, nem trava em falso', () => {
        expect(conferirValorNaGuia([''], 1290.33, { textoInsuficiente: true }).situacao).toBe('ilegivel');
    });

    it('PDF com texto mas sem nenhum valor em reais: ilegível', () => {
        expect(conferirValorNaGuia(['GUIA DE RECOLHIMENTO', 'Vencimento 09/10/2026'], 10).situacao).toBe('ilegivel');
    });

    it('o valor pode estar em qualquer página', () => {
        expect(conferirValorNaGuia(['capa sem valores', 'Total a recolher 250,00'], 250).situacao).toBe('confere');
    });
});
