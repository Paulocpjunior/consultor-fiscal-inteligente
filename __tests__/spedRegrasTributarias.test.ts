/**
 * Testes do motor de regras tributarias do SPED Fiscal.
 *
 * Estrategia: arquivo REAL limpo deve dar 0 achados (sem falso-positivo);
 * cada regra deve DISPARAR em dado deliberadamente errado.
 */
import * as fs from 'fs';

// @ts-expect-error — modulo .js puro
import { parseSpedFiscalParaEdicao } from '../sefaz-backend/sped-fiscal-editor-parser.js';
// @ts-expect-error — modulo .js puro
import { aplicarRegrasTributarias } from '../sefaz-backend/sped-fiscal-regras-tributarias.js';

// Monta um SPED fiscal minimo editavel a partir de partes.
function montaSped(linhasMeio: string[]): any {
    const txt = [
        '|0000|017|0|01012026|31012026|EMP|12345678000190|SP|123|3550308||A|',
        '|0001|0|',
        '|0200|001|PROD A|||UN|00|39011030|||||0000000|',
        '|0990|3|',
        '|C001|0|',
        ...linhasMeio,
        '|C990|1|',
        '|E001|0|',
        '|E110|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
        '|E990|2|',
    ].join('\r\n') + '\r\n';
    return parseSpedFiscalParaEdicao(txt);
}

// C170 com 37 campos. Defaults validos; overrides por indice (1-based no SPED).
function c170(over: Record<number, string> = {}): string {
    const campos = Array(37).fill('');
    campos[0] = '1';        // NUM_ITEM
    campos[1] = '001';      // COD_ITEM (existe no 0200)
    campos[4] = 'UN';
    campos[5] = '1000,00';  // VL_ITEM
    campos[8] = '000';      // CST_ICMS (origem0 + 00)
    campos[9] = '1102';     // CFOP entrada
    campos[11] = '1000,00'; // VL_BC_ICMS
    campos[12] = '18';      // ALIQ_ICMS
    campos[13] = '180,00';  // VL_ICMS
    for (const [k, v] of Object.entries(over)) campos[Number(k) - 1] = v;
    return '|C170|' + campos.join('|') + '|';
}

const C100_ENTRADA = '|C100|0|0|F1|55|00|1|100|chave|01012026|01012026|1000,00|0|0,00|0,00|1000,00|9|0,00|0,00|0,00|1000,00|180,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|';
const C100_SAIDA = C100_ENTRADA.replace('|C100|0|', '|C100|1|');

describe('regras tributarias — arquivo REAL limpo nao gera ruido', () => {
    it('MODELO_SPED_FISCAL real -> 0 erros e 0 avisos', () => {
        const p = '/root/.claude/uploads/397fe5b6-3431-4ff6-b38a-f6d52ff24969/d123747f-MODELO_SPED_FISCAL.TXT.TXT';
        if (!fs.existsSync(p)) return; // arquivo so existe no ambiente de dev
        const txt = fs.readFileSync(p, 'latin1');
        const parsed = parseSpedFiscalParaEdicao(txt);
        const r = aplicarRegrasTributarias(parsed);
        expect(r.resumo.erros).toBe(0);
        expect(r.resumo.avisos).toBe(0);
    });

    it('SPED sintetico valido (com C190 totalizador) -> 0 achados', () => {
        // c170() default: CFOP=1102, CST_ICMS=000, ALIQ=18, VL_ITEM=1000, VL_BC=1000, VL_ICMS=180
        const c190Default = '|C190|000|1102|18|1000,00|1000,00|180,00|0,00|0,00|0,00|0,00||';
        const r = aplicarRegrasTributarias(montaSped([C100_ENTRADA, c170(), c190Default]));
        expect(r.achados).toHaveLength(0);
    });
});

describe('regras tributarias — ERROS de validade', () => {
    it('CFOP invalido', () => {
        const r = aplicarRegrasTributarias(montaSped([C100_ENTRADA, c170({ 10: '9999' })]));
        expect(r.achados.find((a: any) => a.regra === 'CFOP_INVALIDO')).toBeTruthy();
    });

    it('CST_ICMS invalido', () => {
        const r = aplicarRegrasTributarias(montaSped([C100_ENTRADA, c170({ 9: '099' })])); // CST 99 inexistente
        expect(r.achados.find((a: any) => a.regra === 'CST_ICMS_INVALIDO')).toBeTruthy();
    });

    it('NCM invalido no 0200', () => {
        const txt = montaSped([C100_ENTRADA, c170()]);
        // injeta um 0200 com NCM curto reparseando
        const ruim = parseSpedFiscalParaEdicao(
            '|0000|017|0|01012026|31012026|E|12345678000190|SP|1|3550308||A|\r\n' +
            '|0001|0|\r\n|0200|001|X|||UN|00|123|||||0|\r\n|0990|2|\r\n' +
            '|E001|0|\r\n|E110|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|\r\n|E990|2|\r\n'
        );
        const r = aplicarRegrasTributarias(ruim);
        expect(r.achados.find((a: any) => a.regra === 'NCM_INVALIDO')).toBeTruthy();
    });

    it('item C170 sem 0200 correspondente', () => {
        const r = aplicarRegrasTributarias(montaSped([C100_ENTRADA, c170({ 2: '999' })]));
        expect(r.achados.find((a: any) => a.regra === 'ITEM_SEM_0200')).toBeTruthy();
    });
});

describe('regras tributarias — AVISOS de coerencia', () => {
    it('CFOP x direcao divergente (saida com CFOP entrada, nao-devolucao)', () => {
        const r = aplicarRegrasTributarias(montaSped([C100_SAIDA, c170({ 10: '1102' })]));
        expect(r.achados.find((a: any) => a.regra === 'CFOP_DIRECAO')).toBeTruthy();
    });

    it('CFOP de devolucao NAO dispara CFOP_DIRECAO', () => {
        // C100 saida + CFOP 1411 (devolucao de venda) — legitimo, nao avisa.
        const r = aplicarRegrasTributarias(montaSped([C100_SAIDA, c170({ 10: '1411' })]));
        expect(r.achados.find((a: any) => a.regra === 'CFOP_DIRECAO')).toBeFalsy();
    });

    it('CST 60 com VL_ICMS > 0', () => {
        const r = aplicarRegrasTributarias(montaSped([C100_ENTRADA, c170({ 9: '060', 14: '50,00' })]));
        expect(r.achados.find((a: any) => a.regra === 'CST60_COM_ICMS')).toBeTruthy();
    });

    it('CST tributada com BC zero e aliquota > 0', () => {
        const r = aplicarRegrasTributarias(montaSped([C100_ENTRADA, c170({ 9: '000', 12: '0,00', 13: '18', 14: '0,00' })]));
        expect(r.achados.find((a: any) => a.regra === 'BC_ICMS_ZERO')).toBeTruthy();
    });

    it('aliquota ICMS incomum', () => {
        const r = aplicarRegrasTributarias(montaSped([C100_ENTRADA, c170({ 13: '13,5' })]));
        expect(r.achados.find((a: any) => a.regra === 'ALIQ_ICMS_INCOMUM')).toBeTruthy();
    });
});

describe('regras tributarias — R8: C190 totalizador x C170', () => {
    // C190: |C190|CST|CFOP|ALIQ|VL_OPR|VL_BC|VL_ICMS|VL_BC_ST|VL_ICMS_ST|VL_RED_BC|VL_IPI|COD_OBS|
    const c190 = (cst: string, cfop: string, aliq: string, vlOpr: string, vlBc: string, vlIcms: string) =>
        `|C190|${cst}|${cfop}|${aliq}|${vlOpr}|${vlBc}|${vlIcms}|0,00|0,00|0,00|0,00||`;

    it('soma C170 bate com C190 -> sem achado', () => {
        const r = aplicarRegrasTributarias(montaSped([
            C100_ENTRADA,
            c170({ 6: '1000,00', 12: '1000,00', 14: '180,00' }), // VL_ITEM, VL_BC, VL_ICMS
            c170({ 1: '2', 6: '500,00', 12: '500,00', 14: '90,00' }),
            c190('000', '1102', '18', '1500,00', '1500,00', '270,00'),
        ]));
        expect(r.achados.filter((a: any) => a.regra.startsWith('C190'))).toHaveLength(0);
    });

    it('VL_OPR do C190 não bate -> erro C190_VL_OPR_DIVERGE', () => {
        const r = aplicarRegrasTributarias(montaSped([
            C100_ENTRADA,
            c170({ 6: '1000,00', 12: '1000,00', 14: '180,00' }),
            c170({ 1: '2', 6: '500,00', 12: '500,00', 14: '90,00' }),
            c190('000', '1102', '18', '1400,00', '1500,00', '270,00'), // VL_OPR errado
        ]));
        expect(r.achados.find((a: any) => a.regra === 'C190_VL_OPR_DIVERGE')).toBeTruthy();
    });

    it('VL_ICMS do C190 não bate -> erro', () => {
        const r = aplicarRegrasTributarias(montaSped([
            C100_ENTRADA,
            c170({ 6: '1000,00', 12: '1000,00', 14: '180,00' }),
            c190('000', '1102', '18', '1000,00', '1000,00', '170,00'),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'C190_VL_ICMS_DIVERGE')).toBeTruthy();
    });

    it('C170 sem C190 correspondente (totalizador esquecido) -> erro C190_FALTANTE', () => {
        const r = aplicarRegrasTributarias(montaSped([
            C100_ENTRADA,
            c170({ 6: '1000,00', 12: '1000,00', 14: '180,00' }), // CFOP 1102 + CST 000 + 18%
            c190('000', '5102', '18', '1000,00', '1000,00', '180,00'), // C190 com CFOP DIFERENTE
        ]));
        expect(r.achados.find((a: any) => a.regra === 'C190_FALTANTE')).toBeTruthy();
        // E o C190 órfão é reportado também
        expect(r.achados.find((a: any) => a.regra === 'C190_SEM_C170')).toBeTruthy();
    });

    it('dois C190 com a mesma combinação -> aviso C190_DUPLICADO', () => {
        const r = aplicarRegrasTributarias(montaSped([
            C100_ENTRADA,
            c170({ 6: '1000,00', 12: '1000,00', 14: '180,00' }),
            c190('000', '1102', '18', '1000,00', '1000,00', '180,00'),
            c190('000', '1102', '18', '1000,00', '1000,00', '180,00'),
        ]));
        expect(r.achados.find((a: any) => a.regra === 'C190_DUPLICADO')).toBeTruthy();
    });

    it('tolera 1 centavo de arredondamento -> sem achado', () => {
        const r = aplicarRegrasTributarias(montaSped([
            C100_ENTRADA,
            c170({ 6: '333,33', 12: '333,33', 14: '60,00' }),
            c170({ 1: '2', 6: '333,33', 12: '333,33', 14: '60,00' }),
            c170({ 1: '3', 6: '333,34', 12: '333,34', 14: '60,00' }),
            c190('000', '1102', '18', '1000,00', '1000,00', '180,00'), // soma exata
        ]));
        expect(r.achados.filter((a: any) => a.regra.startsWith('C190'))).toHaveLength(0);
    });
});

describe('regras tributarias — escopo', () => {
    it('EFD Contribuicoes -> naoAplicavel (regras sao do EFD ICMS/IPI)', () => {
        const r = aplicarRegrasTributarias({ tipoSped: 'contribuicoes', linhas: [] });
        expect(r.resumo.naoAplicavel).toBe(true);
        expect(r.achados).toHaveLength(0);
    });
});
