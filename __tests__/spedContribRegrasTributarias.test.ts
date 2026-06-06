/**
 * Testes do motor de regras tributárias EFD Contribuições.
 * SPED limpo -> 0 achados; cada regra dispara em dado deliberadamente errado.
 */
// @ts-expect-error — módulo .js puro
import { parseSpedFiscalParaEdicao, colunasDoTipo } from '../sefaz-backend/sped-fiscal-editor-parser.js';
// @ts-expect-error — módulo .js puro
import { aplicarRegrasContribuicoes } from '../sefaz-backend/sped-contrib-regras-tributarias.js';

// Constrói C170 contrib (36 campos) preenchendo só os relevantes por nome.
function c170Contrib(o: Record<string, string> = {}): string {
    const cols: string[] = colunasDoTipo('C170', 'contribuicoes');
    const campos = cols.map((c: string) => o[c] ?? '');
    if (campos[cols.indexOf('NUM_ITEM')] === '') campos[cols.indexOf('NUM_ITEM')] = '1';
    if (campos[cols.indexOf('COD_ITEM')] === '') campos[cols.indexOf('COD_ITEM')] = '001';
    if (campos[cols.indexOf('VL_ITEM')] === '') campos[cols.indexOf('VL_ITEM')] = '100,00';
    return '|C170|' + campos.join('|') + '|';
}

function montaContrib(c170s: string[]): any {
    const txt = [
        '|0000|006|0|01012026|31012026|EMP|12345678000190|SP|3550308|0|0|',
        '|0001|0|',
        '|0200|001|PRODUTO|||UN|01|39011030|||20|',
        '|0990|3|',
        '|C001|0|', ...c170s, '|C990|1|',
        '|M001|0|', '|M200|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|', '|M990|3|',
    ].join('\r\n') + '\r\n';
    return parseSpedFiscalParaEdicao(txt);
}

describe('regras contribuições — SPED limpo não gera ruído', () => {
    it('cumulativo (Presumido) com CST 01 e alíquotas 0,65 / 3 -> 0 achados', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '5102',
                CST_PIS: '01', VL_BC_PIS: '100,00', ALIQ_PIS: '0,65', VL_PIS: '0,65',
                CST_COFINS: '01', VL_BC_COFINS: '100,00', ALIQ_COFINS: '3', VL_COFINS: '3,00',
            }),
        ]));
        expect(r.achados).toHaveLength(0);
    });

    it('não-cumulativo (Real) com CST 50 e alíquotas 1,65 / 7,6 -> 0 achados', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '1102',
                CST_PIS: '50', VL_BC_PIS: '100,00', ALIQ_PIS: '1,65', VL_PIS: '1,65',
                CST_COFINS: '50', VL_BC_COFINS: '100,00', ALIQ_COFINS: '7,6', VL_COFINS: '7,60',
            }),
        ]));
        expect(r.achados).toHaveLength(0);
    });
});

describe('regras contribuições — ERROS de validade', () => {
    it('CST_PIS inválido', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({ CFOP: '5102', CST_PIS: '88', CST_COFINS: '01' }),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'CST_PIS_INVALIDO')).toBeTruthy();
    });

    it('CST_COFINS inválido', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({ CFOP: '5102', CST_PIS: '01', CST_COFINS: '88' }),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'CST_COFINS_INVALIDO')).toBeTruthy();
    });

    it('CFOP inválido', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({ CFOP: '9999', CST_PIS: '01', CST_COFINS: '01' }),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'CFOP_INVALIDO')).toBeTruthy();
    });
});

describe('regras contribuições — AVISOS de coerência', () => {
    it('CST 06 (alíq zero) com VL_PIS > 0 -> aviso', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '5102',
                CST_PIS: '06', VL_BC_PIS: '0,00', ALIQ_PIS: '0', VL_PIS: '10,00',
                CST_COFINS: '06', VL_BC_COFINS: '0,00', ALIQ_COFINS: '0', VL_COFINS: '0,00',
            }),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'CST_PIS_NAO_TRIBUTAVEL_COM_VALOR')).toBeTruthy();
    });

    it('CST 01 com BC zero e alíquota 0,65 -> aviso', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '5102',
                CST_PIS: '01', VL_BC_PIS: '0,00', ALIQ_PIS: '0,65', VL_PIS: '0,00',
                CST_COFINS: '01', VL_BC_COFINS: '100,00', ALIQ_COFINS: '3', VL_COFINS: '3,00',
            }),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'BC_PIS_ZERO_COM_ALIQ')).toBeTruthy();
    });

    it('alíquota PIS incomum (ex.: 2,5%)', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '5102',
                CST_PIS: '01', VL_BC_PIS: '100,00', ALIQ_PIS: '2,5', VL_PIS: '2,50',
                CST_COFINS: '01', VL_BC_COFINS: '100,00', ALIQ_COFINS: '3', VL_COFINS: '3,00',
            }),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'ALIQ_PIS_INCOMUM')).toBeTruthy();
    });

    it('CST_PIS != CST_COFINS -> aviso (operação normalmente coerente)', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '5102',
                CST_PIS: '01', VL_BC_PIS: '100,00', ALIQ_PIS: '0,65', VL_PIS: '0,65',
                CST_COFINS: '06', VL_BC_COFINS: '0,00', ALIQ_COFINS: '0', VL_COFINS: '0,00',
            }),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'CST_PIS_COFINS_DIVERGENTE')).toBeTruthy();
    });
});

describe('regras contribuições — escopo', () => {
    it('EFD ICMS/IPI -> naoAplicavel', () => {
        const r = aplicarRegrasContribuicoes({ tipoSped: 'fiscal', linhas: [] });
        expect(r.resumo.naoAplicavel).toBe(true);
        expect(r.achados).toHaveLength(0);
    });
});
