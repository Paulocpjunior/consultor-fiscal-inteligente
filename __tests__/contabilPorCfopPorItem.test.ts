/**
 * 📊 CONTÁBIL POR CFOP = SOMA DOS ITENS, NÃO RATEIO PELO PRODUTO (16/10, KROYA).
 *
 * Paulo, KROYA 09/2026: o Resumo por CFOP do CFI dava 5101 = 49.597,72 e
 * 5401 = 1.676,59; o Fiscal (e-Fiscal), 49.432,09 e 1.842,22 — mesma soma,
 * repartida diferente. O relatório de produtos do e-Fiscal fecha centavo a
 * centavo somando, por item, produto + acessórias − desconto + ICMS-ST + IPI.
 * Fixture = a NF 15589 REAL do CSV dele: 5 itens 5101 (IPI, sem ST) e 2 itens
 * 5401 (com ST): e-Fiscal 313,32 + 44,94 = 358,26. O rateio antigo pela
 * proporção do produto dava 317,86 + 40,40.
 *
 * Fatos cobrados: o Resumo por CFOP, o dono da repartição (que o E201 do SAGE
 * também usa) e o 🧾 Produtos por nota dizem 313,32/44,94; o total da nota
 * não muda; e o CSV sai com o contábil do item.
 */
import { resumoPorCfop, produtosPorNota, csvProdutosPorNota } from '../services/relatoriosAgregacoes';
import { contabilDosGruposDeCfop } from '../sefaz-backend/contabil-por-cfop.js';

const item = (n: number, cfop: string, vProd: number, vIPI: number, vICMSST = 0) => ({
    nItem: String(n), cProd: `P${n}`, xProd: `PRODUTO ${n}`, ncm: '39269090', cfop, uCom: 'UN', qCom: 1, vUnCom: vProd,
    vProd, vIPI, vICMSST, vICMS: 0, vPIS: 0, vCOFINS: 0, cst: vICMSST ? '10' : '00', orig: '1',
});
const nf15589: any = {
    id: 'kroya-15589', tipo: 'NFe', modelo: '55', numero: '0000015589', serie: '0', direcao: 'saida', tpNF: '1', status: 'autorizado',
    chave: '35260901961491000108550000000155891626406517', dataEmissao: '2026-09-01',
    cnpjEmit: '01961491000108', empresaCnpj: '01961491000108', cnpjDest: '20675475000195', xNomeDest: 'BREST COMERCIO', ufDest: 'SP',
    totais: { vNF: 358.26 },
    itens: [
        item(1, '5101', 99.6, 9.71), item(2, '5101', 53.4, 2.78), item(3, '5101', 78, 4.06),
        item(4, '5101', 28.32, 1.47), item(5, '5101', 34.2, 1.78),
        item(6, '5401', 22, 1.72, 2.79), item(7, '5401', 15.3, 1.19, 1.94),
    ],
};
const ctx: any = { naturezaAtividade: 'comercio', cfopOverrides: undefined, parametrosCfop: [], regimeTributario: 'LUCRO_PRESUMIDO', contribuinteIpi: 'sim' };

it('Resumo por CFOP: 5101 = 313,32 e 5401 = 44,94 (o e-Fiscal), total 358,26', () => {
    const r = resumoPorCfop([nf15589], ctx);
    const por = Object.fromEntries(r.map((l) => [l.cfop, l.contabil]));
    expect(por).toEqual({ 5101: 313.32, 5401: 44.94 });
});

it('o dono da repartição (o mesmo do E201 do SAGE) diz o mesmo', () => {
    const g5101 = nf15589.itens.slice(0, 5);
    const g5401 = nf15589.itens.slice(5);
    expect(contabilDosGruposDeCfop(nf15589, nf15589.itens, [g5101, g5401], 358.26)).toEqual([313.32, 44.94]);
});

it('a nota que não fecha com os itens: a diferença vai no último grupo, o total não muda', () => {
    const g = [nf15589.itens.slice(0, 5), nf15589.itens.slice(5)];
    const v = contabilDosGruposDeCfop(nf15589, nf15589.itens, g, 360);
    expect(v[0]).toBe(313.32);
    expect(Math.round((v[0] + v[1]) * 100) / 100).toBe(360);
});

it('🧾 Produtos por nota: um item por linha, contábil do item somando o Resumo', () => {
    const linhas = produtosPorNota([nf15589], ctx);
    expect(linhas).toHaveLength(7);
    expect(linhas[0]).toMatchObject({ numero: '0000015589', item: '1', cfop: '5101', contabilItem: 109.31, contabilNota: 358.26 });
    expect(linhas[5]).toMatchObject({ cfop: '5401', icmsSt: 2.79, ipi: 1.72, contabilItem: 26.51, contabilNota: null });
    const soma = (c: string) => Math.round(linhas.filter((l) => l.cfop === c).reduce((s, l) => s + l.contabilItem, 0) * 100) / 100;
    expect([soma('5101'), soma('5401')]).toEqual([313.32, 44.94]);
    const csv = csvProdutosPorNota(linhas).split('\r\n');
    expect(csv[0].split(';').pop()).toBe('Valor Contábil do Item');
    expect(csv[1].split(';').pop()).toBe('109,31');
});
