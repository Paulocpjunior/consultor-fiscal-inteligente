/**
 * 📗 As duas recusas do PVA que faltavam na prevalidação (ELS 08/2026, 28/09):
 *  - CST 50–56 em C170 de compra de PESSOA FÍSICA (30 documentos);
 *  - VL_PIS/VL_COFINS do C100 MENOR que a soma dos C170 (11 + 4).
 * Linhas no formato do arquivo real; a asserção cobra o fato, não a frase.
 */
// @ts-expect-error módulo .js puro sem tipos
import { conferirCstDeEntradaPessoaFisica, conferirPisCofinsDoC100ContraItens, avisosDaPrevalidacaoContrib } from '../sefaz-backend/sped-contrib-campos.js';

const p0150 = (cod: string, cnpj: string, cpf: string) => `|0150|${cod}|NOME|1058|${cnpj}|${cpf}||3121209||||||`;
const c100 = (oper: '0' | '1', part: string, num: string, pis: string, cofins: string) =>
    `|C100|${oper}|1|${part}|55|00|001|${num}|35260800000000000000550010000000011000000001|10082026|10082026|1000,00|0|0,00||1000,00|9|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|${pis}|${cofins}|||`;
const c170 = (cstPis: string, vlPis: string, cstCofins = cstPis, vlCofins = '0,00') =>
    // 37 campos, nas posições do Guia (25 CST_PIS · 30 VL_PIS · 31 CST_COFINS · 36 VL_COFINS).
    `|C170|1|P1|BANANA|1,00000|KG|1000,00|0,00|0|000|1102||0,00|0,00|0,00|0,00|0,00|0,00|0|||0,00|0,00|0,00|${cstPis}|1000,00|1,6500|||${vlPis}|${cstCofins}|1000,00|7,6000|||${vlCofins}||`;

describe('CST com crédito em compra de pessoa física', () => {
    it('C170 com 50 sob C100 de entrada cujo 0150 tem CPF é acusado (PIS e COFINS), e nomeia a nota', () => {
        const linhas = [p0150('10985437693', '', '10985437693'), c100('0', '10985437693', '3347', '16,50', '76,00'), c170('50', '16,50', '50', '76,00')];
        const r = conferirCstDeEntradaPessoaFisica(linhas).erros;
        expect(r).toHaveLength(2);
        expect(r[0].mensagem).toMatch(/3347/);
        expect(r[0].mensagem).toMatch(/pessoa física/);
        expect(avisosDaPrevalidacaoContrib(linhas).some((a: string) => /pessoa física/.test(a))).toBe(true);
    });

    it('não acusa: PJ com 50; PF com 70; saída de PF (venda a consumidor)', () => {
        expect(conferirCstDeEntradaPessoaFisica([p0150('49167213000100', '49167213000100', ''), c100('0', '49167213000100', '1', '16,50', '76,00'), c170('50', '16,50')]).erros).toEqual([]);
        expect(conferirCstDeEntradaPessoaFisica([p0150('10985437693', '', '10985437693'), c100('0', '10985437693', '1', '0,00', '0,00'), c170('70', '0,00', '70', '0,00')]).erros).toEqual([]);
        expect(conferirCstDeEntradaPessoaFisica([p0150('10985437693', '', '10985437693'), c100('1', '10985437693', '1', '16,50', '76,00'), c170('01', '16,50', '01', '76,00')]).erros).toEqual([]);
    });
});

describe('VL_PIS/VL_COFINS do C100 contra a soma dos C170', () => {
    it('cabeçalho menor que a soma é acusado, uma vez por tributo; igual ou maior passa', () => {
        const ruim = [c100('0', '49167213000100', '3347', '0,00', '1,00'), c170('50', '11,00', '50', '8,00')];
        const r = conferirPisCofinsDoC100ContraItens(ruim).erros;
        expect(r).toHaveLength(2);
        expect(r.map((e: any) => e.campo)).toEqual(['26 - VL_PIS', '27 - VL_COFINS']);
        expect(r[0].mensagem).toMatch(/3347/);
        const bom = [c100('0', '49167213000100', '1', '11,00', '8,00'), c170('50', '11,00', '50', '8,00')];
        expect(conferirPisCofinsDoC100ContraItens(bom).erros).toEqual([]);
        expect(conferirPisCofinsDoC100ContraItens([c100('0', '49167213000100', '1', '11,01', '8,00'), c170('50', '11,00', '50', '8,00')]).erros).toEqual([]);
    });

    it('CST 05 e 75 ficam fora da soma, como diz a mensagem do PVA', () => {
        const linhas = [c100('0', '49167213000100', '1', '0,00', '0,00'), c170('75', '11,00', '05', '8,00')];
        expect(conferirPisCofinsDoC100ContraItens(linhas).erros).toEqual([]);
    });

    it('dois documentos seguidos não misturam as somas', () => {
        const linhas = [
            c100('0', '49167213000100', '1', '11,00', '8,00'), c170('50', '11,00', '50', '8,00'),
            c100('0', '49167213000100', '2', '0,00', '0,00'), c170('50', '5,00', '50', '3,00'),
        ];
        const r = conferirPisCofinsDoC100ContraItens(linhas).erros;
        expect(r).toHaveLength(2);
        expect(r.every((e: any) => /NF 2\b/.test(e.mensagem))).toBe(true);
    });
});
