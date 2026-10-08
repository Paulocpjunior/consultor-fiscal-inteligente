/**
 * 💳 CRÉDITO DE IPI / ICMS-ST QUE VEIO EM "OUTRAS DESPESAS" (08/10).
 *
 * Paulo, FLANACAR: NF-e 419011 da HSCAR (devolução de compra), vOutro 4,19,
 * IPI 0,00 e "VALOR DO IPI R$4,19" nas informações complementares — forma
 * admitida pela RC SEFAZ/SP 2020/2013 e pela SC COSIT 159/2019. Decisão dele:
 * NO PRÓPRIO DOCUMENTO — o valor sai de outras despesas e vira IPI/ST do
 * item (CST IPI 00), o E510/E520 somam sozinhos, o XML fica como veio.
 *
 * Fatos cobrados: a régua não deixa mover mais do que havia nem lançar sem
 * motivo; o documento lido pela escrituração tem o IPI no item com CST 00 e o
 * total da nota intacto; o E510 e o E520 o enxergam; o VL_OPR do C190 não
 * muda (o valor só troca de campo); o original não é tocado.
 */
import {
    validarAjusteCreditoOutras, aplicarCreditoOutrasDespesas, sugereCreditoEmOutrasDespesas,
} from '../sefaz-backend/credito-outras-despesas.js';
// @ts-expect-error — módulo .js puro (sem tipos)
import { montarLinhasE510 } from '../sefaz-backend/sped-bloco-ipi-e510.js';
// @ts-expect-error — módulo .js puro (sem tipos)
import { somarImpostoPorDirecao } from '../sefaz-backend/sped-fiscal-blocoE.js';
import { valorOperacaoDoItem } from '../sefaz-backend/valor-operacao-c190.js';

const MOTIVO = 'Devolução: IPI informado em outras despesas — RC SEFAZ/SP 2020/2013';

/** A forma da FLANACAR: um item, IPI em outras despesas. */
function devolucao(o: { itemOutro?: number | undefined; totalOutro?: number; direcao?: string; ajuste?: any } = {}): any {
    const itemOutro = 'itemOutro' in o ? o.itemOutro : 4.19;
    return {
        id: 'd1', tipo: 'NFe', modelo: '55', direcao: o.direcao ?? 'entrada', status: 'autorizado',
        empresaCnpj: '11222333000181',
        infAdic: 'DEVOLUCAO REF NF 1234. VALOR DO IPI R$4,19',
        itens: [
            { nItem: '1', xProd: 'PECA', cfop: '1202', vProd: 41.9, vIPI: 0, vOutro: itemOutro },
            { nItem: '2', xProd: 'OUTRA', cfop: '1202', vProd: 10, vIPI: 0, vOutro: 0 },
        ],
        totais: { vProd: 51.9, vIPI: 0, vST: 0, vOutro: o.totalOutro ?? 4.19, vNF: 56.09 },
        ...(o.ajuste ? { ajusteCreditoOutrasDespesas: o.ajuste } : {}),
    };
}

describe('a régua confere antes de gravar', () => {
    it('o caso da FLANACAR passa', () => {
        const v = validarAjusteCreditoOutras(devolucao(), { itens: [{ indice: 0, ipi: 4.19 }], motivo: MOTIVO });
        expect(v).toEqual({ ok: true, ajuste: { itens: [{ indice: 0, ipi: 4.19, st: 0 }], motivo: MOTIVO, total: 4.19 } });
    });

    it.each([
        ['saída não credita', devolucao({ direcao: 'saida' }), [{ indice: 0, ipi: 4.19 }], MOTIVO, /ENTRADA/],
        ['sem motivo', devolucao(), [{ indice: 0, ipi: 4.19 }], 'ipi', /motivo/],
        ['mais que o item', devolucao(), [{ indice: 0, ipi: 4.2 }], MOTIVO, /mais do que as outras despesas do item/],
        ['mais que a nota', devolucao({ itemOutro: undefined }), [{ indice: 1, ipi: 5 }], MOTIVO, /maior que as outras despesas da nota/],
        ['item que não existe', devolucao(), [{ indice: 7, ipi: 1 }], MOTIVO, /não existe/],
        ['item duas vezes', devolucao(), [{ indice: 0, ipi: 1 }, { indice: 0, st: 1 }], MOTIVO, /duas vezes/],
        ['negativo', devolucao(), [{ indice: 0, ipi: -1 }], MOTIVO, /negativo/],
        ['nada informado', devolucao(), [{ indice: 0, ipi: 0, st: 0 }], MOTIVO, /pelo menos um item/],
    ])('%s: recusa e diz', (_n, doc, itens, motivo, erro) => {
        const v = validarAjusteCreditoOutras(doc, { itens: itens as any, motivo: motivo as string });
        expect(v.ok).toBe(false);
        expect(!v.ok && v.erros.join(' ')).toMatch(erro as RegExp);
    });

    it('item sem outras despesas próprias: o teto é o da nota', () => {
        const doc = devolucao({ itemOutro: undefined });
        expect(validarAjusteCreditoOutras(doc, { itens: [{ indice: 1, ipi: 4.19 }], motivo: MOTIVO }).ok).toBe(true);
    });
});

describe('a escrituração lê o documento com o crédito', () => {
    const ajuste = { itens: [{ indice: 0, ipi: 4.19, st: 0 }], motivo: MOTIVO, total: 4.19 };

    it('o IPI vai para o item com CST 00; outras despesas cai; o total da nota NÃO muda', () => {
        const original = devolucao({ ajuste });
        const lido: any = aplicarCreditoOutrasDespesas(original);
        expect(lido.itens[0]).toMatchObject({ vIPI: 4.19, cstIpi: '00', vOutro: 0 });
        expect(lido.itens[1]).toEqual(original.itens[1]);
        expect(lido.totais).toMatchObject({ vIPI: 4.19, vOutro: 0, vNF: 56.09 });
        // O original (o que veio do XML) não foi tocado.
        expect(original.itens[0]).toMatchObject({ vIPI: 0, vOutro: 4.19 });
        expect(original.itens[0].cstIpi).toBeUndefined();
        expect(original.totais.vOutro).toBe(4.19);
    });

    it('sem ajuste, devolve o próprio documento', () => {
        const doc = devolucao();
        expect(aplicarCreditoOutrasDespesas(doc)).toBe(doc);
    });

    it('o VL_OPR do item é o mesmo antes e depois — o valor só trocou de campo', () => {
        const antes = devolucao({ ajuste });
        const depois: any = aplicarCreditoOutrasDespesas(antes);
        expect(valorOperacaoDoItem(depois.itens[0])).toBeCloseTo(valorOperacaoDoItem(antes.itens[0]), 2);
    });

    it('o E510 ganha a linha CFOP 1202 · CST 00 com o IPI, e o E520 o credita', () => {
        const lido = aplicarCreditoOutrasDespesas(devolucao({ ajuste }));
        const e510 = montarLinhasE510([lido]);
        expect(e510.linhas.map((l: string) => l.trim())).toEqual(['|E510|1202|00|46,09|0,00|4,19|']);
        expect(somarImpostoPorDirecao([lido], 'entrada', 'vIPI', 'vIPI')).toBeCloseTo(4.19, 2);
        // Sem o ajuste, não havia crédito nenhum — a fixture alcança o ramo.
        expect(somarImpostoPorDirecao([devolucao()], 'entrada', 'vIPI', 'vIPI')).toBe(0);
    });

    it('ICMS-ST: vai para o vICMSST do item e o vST da nota', () => {
        const lido: any = aplicarCreditoOutrasDespesas(devolucao({ ajuste: { itens: [{ indice: 0, ipi: 0, st: 4.19 }], motivo: MOTIVO, total: 4.19 } }));
        expect(lido.itens[0]).toMatchObject({ vICMSST: 4.19, vOutro: 0, vIPI: 0 });
        expect(lido.itens[0].cstIpi).toBeUndefined();
        expect(lido.totais).toMatchObject({ vST: 4.19, vOutro: 0, vNF: 56.09 });
        expect(lido._creditoOutrasDespesas).toEqual({ ipi: 0, st: 4.19 });
    });
});

describe('o aviso aponta, não deduz', () => {
    it('entrada com outras despesas e texto citando IPI: avisa', () => {
        expect(sugereCreditoEmOutrasDespesas(devolucao())).toBe(true);
    });
    it('já ajustada, saída ou sem outras despesas: não avisa', () => {
        expect(sugereCreditoEmOutrasDespesas(devolucao({ ajuste: { itens: [{ indice: 0, ipi: 4.19, st: 0 }] } }))).toBe(false);
        expect(sugereCreditoEmOutrasDespesas(devolucao({ direcao: 'saida' }))).toBe(false);
        expect(sugereCreditoEmOutrasDespesas(devolucao({ totalOutro: 0 }))).toBe(false);
    });
});
