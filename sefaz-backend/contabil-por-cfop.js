// ============================================================================
// sefaz-backend/contabil-por-cfop.js  (PURO — roda no navegador e no backend)
// ----------------------------------------------------------------------------
// 📊 O VALOR CONTÁBIL DE CADA CFOP DE UMA NOTA — dono único (16/10).
//
// Paulo, KROYA 09/2026: o Resumo por CFOP do CFI dava 5101 = 49.597,72 e
// 5401 = 1.676,59, e o Fiscal (e-Fiscal) 49.432,09 e 1.842,22 — a mesma soma,
// repartida diferente (o mesmo em 6101 × 6401). O CFI rateava o contábil da
// NOTA pela proporção do valor dos PRODUTOS; com ICMS-ST e IPI só em alguns
// itens (o ST é do item 5401/6401), o rateio espalhava o ST pelo 5101. O
// relatório de produtos do e-Fiscal fecha centavo a centavo quando cada item
// carrega o que é DELE: produto + frete + seguro + outras − desconto + ICMS-ST
// + FCP-ST + IPI do item — que é exatamente o VL_OPR do C190 do SPED
// (`valorOperacaoDosItens`). Resumo por CFOP, E201 do Exportar SAGE e C190
// passam a ler a MESMA régua.
//
// O total da nota não muda: se a soma dos itens não fecha com o contábil da
// nota (campo do total sem correspondente nos itens), a diferença vai no
// último grupo, como sempre foi.
// ============================================================================

import { valorOperacaoDosItens } from './valor-operacao-c190.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * @param {object} doc         o documento (para os totais da reserva)
 * @param {object[]} itens     os itens do documento, na ordem (podem ser os sintéticos do CT-e)
 * @param {object[][]} grupos  os itens agrupados por CFOP (mesmos objetos de `itens`)
 * @param {number} contabilNota o contábil da nota
 * @returns {number[]} contábil de cada grupo, na ordem de `grupos`
 */
export function contabilDosGruposDeCfop(doc, itens, grupos, contabilNota) {
    const lista = Array.isArray(itens) ? itens : [];
    const { porItem } = valorOperacaoDosItens({ ...(doc || {}), itens: lista });
    const valorDe = new Map(lista.map((it, i) => [it, porItem[i] || 0]));
    const out = [];
    let distribuido = 0;
    grupos.forEach((g, idx) => {
        const ultimo = idx === grupos.length - 1;
        const v = ultimo
            ? r2(Number(contabilNota || 0) - distribuido)
            : r2((g || []).reduce((s, it) => s + (valorDe.get(it) || 0), 0));
        distribuido = r2(distribuido + v);
        out.push(v);
    });
    return out;
}
