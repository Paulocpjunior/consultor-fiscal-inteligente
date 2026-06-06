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

function montaContrib(c170s: string[], m210s: string[] = [], m610s: string[] = []): any {
    const txt = [
        '|0000|006|0|01012026|31012026|EMP|12345678000190|SP|3550308|0|0|',
        '|0001|0|',
        '|0200|001|PRODUTO|||UN|01|39011030|||20|',
        '|0990|3|',
        '|C001|0|', ...c170s, '|C990|1|',
        '|M001|0|', '|M200|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
        ...m210s, ...m610s,
        '|M990|3|',
    ].join('\r\n') + '\r\n';
    return parseSpedFiscalParaEdicao(txt);
}

// Constrói M210/M610: |M210|CST|VL_REC_BRT|VL_BC_CONT|... (15 campos)
function m210(cst: string, vlBc: string, vlContApur: string = '0,00'): string {
    return `|M210|${cst}|${vlBc}|${vlBc}|0,00|0,00|${vlBc}|0,65|0,00|0,00|${vlContApur}|0,00|0,00|0,00|0,00|${vlContApur}|`;
}
function m610(cst: string, vlBc: string, vlContApur: string = '0,00'): string {
    return `|M610|${cst}|${vlBc}|${vlBc}|0,00|0,00|${vlBc}|3|0,00|0,00|${vlContApur}|0,00|0,00|0,00|0,00|${vlContApur}|`;
}

describe('regras contribuições — SPED limpo não gera ruído', () => {
    it('cumulativo (Presumido) com CST 01 e alíquotas 0,65 / 3 -> 0 achados', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '5102',
                CST_PIS: '01', VL_BC_PIS: '100,00', ALIQ_PIS: '0,65', VL_PIS: '0,65',
                CST_COFINS: '01', VL_BC_COFINS: '100,00', ALIQ_COFINS: '3', VL_COFINS: '3,00',
            }),
        ], [m210('01', '100,00', '0,65')], [m610('01', '100,00', '3,00')]));
        expect(r.achados).toHaveLength(0);
    });

    it('não-cumulativo (Real) com CST 50 e alíquotas 1,65 / 7,6 -> 0 achados', () => {
        const r = aplicarRegrasContribuicoes(montaContrib([
            c170Contrib({
                CFOP: '1102',
                CST_PIS: '50', VL_BC_PIS: '100,00', ALIQ_PIS: '1,65', VL_PIS: '1,65',
                CST_COFINS: '50', VL_BC_COFINS: '100,00', ALIQ_COFINS: '7,6', VL_COFINS: '7,60',
            }),
        ], [m210('50', '100,00', '1,65')], [m610('50', '100,00', '7,60')]));
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
        ], [m210('01', '100,00', '2,50')], [m610('01', '100,00', '3,00')]));
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

describe('regras contribuições — R9: M210/M610 totalizador × C170', () => {
    const c170Tributado = (over: Record<string, string> = {}) => c170Contrib({
        CFOP: '5102',
        CST_PIS: '01', VL_BC_PIS: '100,00', ALIQ_PIS: '0,65', VL_PIS: '0,65',
        CST_COFINS: '01', VL_BC_COFINS: '100,00', ALIQ_COFINS: '3', VL_COFINS: '3,00',
        ...over,
    });

    it('soma C170 bate com M210/M610 -> sem achado de R9', () => {
        const r = aplicarRegrasContribuicoes(montaContrib(
            [c170Tributado()],
            [m210('01', '100,00')], [m610('01', '100,00')],
        ));
        expect(r.achados.filter((a: any) => a.regra.startsWith('M210') || a.regra.startsWith('M610'))).toHaveLength(0);
    });

    it('M210 ausente (CST 01 em C170, sem totalizador) -> erro M210_FALTANTE', () => {
        const r = aplicarRegrasContribuicoes(montaContrib(
            [c170Tributado()],
            [], [m610('01', '100,00')], // sem M210, só M610
        ));
        expect(r.achados.find((a: any) => a.regra === 'M210_FALTANTE')).toBeTruthy();
    });

    it('M610 ausente -> erro M610_FALTANTE', () => {
        const r = aplicarRegrasContribuicoes(montaContrib(
            [c170Tributado()],
            [m210('01', '100,00')], [],
        ));
        expect(r.achados.find((a: any) => a.regra === 'M610_FALTANTE')).toBeTruthy();
    });

    it('M210 BC MENOR que soma C170 (faltou item) -> erro', () => {
        // 2 itens de 100 = 200; M210 declarado 100 (faltou um)
        const r = aplicarRegrasContribuicoes(montaContrib(
            [c170Tributado(), c170Tributado({ NUM_ITEM: '2' })],
            [m210('01', '100,00')], [m610('01', '200,00')],
        ));
        expect(r.achados.find((a: any) => a.regra === 'M210_BC_MENOR_QUE_C170')).toBeTruthy();
    });

    it('M210 BC MAIOR que soma C170 -> aviso (pode ter A170/F100)', () => {
        const r = aplicarRegrasContribuicoes(montaContrib(
            [c170Tributado()],
            [m210('01', '500,00')], [m610('01', '100,00')],
        ));
        expect(r.achados.find((a: any) => a.regra === 'M210_BC_MAIOR_QUE_C170')).toBeTruthy();
        expect(r.achados.find((a: any) => a.regra === 'M210_BC_MAIOR_QUE_C170').severidade).toBe('aviso');
    });

    it('CST 06 (alíq zero, BC=0) -> não exige M210/M610 (skip)', () => {
        const r = aplicarRegrasContribuicoes(montaContrib(
            [c170Contrib({
                CFOP: '5102',
                CST_PIS: '06', VL_BC_PIS: '0,00', ALIQ_PIS: '0', VL_PIS: '0,00',
                CST_COFINS: '06', VL_BC_COFINS: '0,00', ALIQ_COFINS: '0', VL_COFINS: '0,00',
            })],
        ));
        expect(r.achados.find((a: any) => a.regra === 'M210_FALTANTE')).toBeFalsy();
        expect(r.achados.find((a: any) => a.regra === 'M610_FALTANTE')).toBeFalsy();
    });
});

describe('regras contribuições — escopo', () => {
    it('EFD ICMS/IPI -> naoAplicavel', () => {
        const r = aplicarRegrasContribuicoes({ tipoSped: 'fiscal', linhas: [] });
        expect(r.resumo.naoAplicavel).toBe(true);
        expect(r.achados).toHaveLength(0);
    });
});
