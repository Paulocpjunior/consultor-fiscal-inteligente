// ============================================================================
// sefaz-backend/credito-outras-despesas.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 💳 CRÉDITO DE IPI / ICMS-ST QUE VEIO EM "OUTRAS DESPESAS" (08/10).
//
// Paulo, FLANACAR (NF-e 419011 da HSCAR, devolução de compra): o fornecedor
// devolve sem ser contribuinte do IPI e informa o imposto em OUTRAS DESPESAS
// (vOutro = 4,19; IPI = 0,00; "VALOR DO IPI R$4,19" nas informações
// complementares) — forma admitida pela Resposta à Consulta SEFAZ/SP
// 2020/2013 e pela SC COSIT 159/2019. Quem recebe a devolução TEM o crédito,
// e o mesmo vale para o ICMS-ST.
//
// Decisão do Paulo (08/10): o crédito entra NO PRÓPRIO DOCUMENTO da
// escrituração — o valor sai de "Outras despesas" e vira IPI / ICMS-ST do
// item, com CST de IPI de ENTRADA COM CRÉDITO (00). O XML original continua
// guardado como veio; o ajuste fica no documento, CARIMBADO (autor, data,
// motivo), e se desfaz.
//
// ⚠️ ALERTA, NUNCA CONTORNO: o CFI NÃO deduz o valor sozinho a partir do
// texto da nota. Quem escritura informa, item a item; a régua aqui só confere
// (não move mais do que havia em outras despesas) e aplica.
//
// O total da nota NÃO muda: o valor troca de campo (outras despesas → IPI/ST).
// ============================================================================

import { direcaoEfetivaDoc } from './xml-metadata-helper.js';

export const MIN_MOTIVO_CREDITO = 15;
/** CST do IPI na entrada com recuperação de crédito (tabela do IPI). */
export const CST_IPI_ENTRADA_COM_CREDITO = '00';

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Confere um ajuste antes de gravar.
 *
 * @param {object} doc  documento fiscal gravado
 * @param {{itens: Array<{indice:number, ipi?:number, st?:number}>, motivo: string}} ajuste
 * @returns {{ok: true, ajuste: object} | {ok: false, erros: string[]}}
 */
export function validarAjusteCreditoOutras(doc, ajuste) {
    const erros = [];
    const itens = Array.isArray(doc?.itens) ? doc.itens : [];
    if (direcaoEfetivaDoc(doc) !== 'entrada') erros.push('O crédito de outras despesas só vale para nota de ENTRADA.');
    if (!itens.length) erros.push('A nota não tem itens gravados — não há onde lançar o crédito.');

    const motivo = String(ajuste?.motivo || '').trim();
    if (motivo.length < MIN_MOTIVO_CREDITO) {
        erros.push(`Escreva o motivo (mínimo ${MIN_MOTIVO_CREDITO} caracteres) — por exemplo, a base legal e o que diz a nota.`);
    }

    const linhas = [];
    const vistos = new Set();
    for (const l of Array.isArray(ajuste?.itens) ? ajuste.itens : []) {
        const indice = Number(l?.indice);
        const ipi = r2(num(l?.ipi));
        const st = r2(num(l?.st));
        if (!Number.isInteger(indice) || indice < 0 || indice >= itens.length) {
            erros.push(`Item ${l?.indice} não existe nesta nota.`);
            continue;
        }
        if (vistos.has(indice)) { erros.push(`Item ${indice + 1} informado duas vezes.`); continue; }
        vistos.add(indice);
        if (ipi < 0 || st < 0) { erros.push(`Item ${indice + 1}: valor negativo não é crédito.`); continue; }
        if (ipi === 0 && st === 0) continue;
        const outrasDoItem = itens[indice]?.vOutro;
        // Item com outras despesas próprias: não se move mais do que ele tem.
        if (outrasDoItem !== undefined && outrasDoItem !== null && num(outrasDoItem) > 0 && ipi + st > num(outrasDoItem) + 0.005) {
            erros.push(`Item ${indice + 1}: ${(ipi + st).toFixed(2)} é mais do que as outras despesas do item (${num(outrasDoItem).toFixed(2)}).`);
        }
        linhas.push({ indice, ipi, st });
    }
    if (!linhas.length) erros.push('Informe o valor de IPI e/ou ICMS-ST de pelo menos um item.');

    const total = r2(linhas.reduce((t, l) => t + l.ipi + l.st, 0));
    const outrasDaNota = num(doc?.totais?.vOutro);
    if (total > outrasDaNota + 0.005) {
        erros.push(`O crédito informado (${total.toFixed(2)}) é maior que as outras despesas da nota (${outrasDaNota.toFixed(2)}).`);
    }

    if (erros.length) return { ok: false, erros };
    return { ok: true, ajuste: { itens: linhas, motivo, total } };
}

/**
 * O documento COMO A ESCRITURAÇÃO O LÊ: com o ajuste aplicado. Sem ajuste,
 * devolve o próprio documento. Nunca altera o original.
 *
 * @param {object} doc
 */
export function aplicarCreditoOutrasDespesas(doc) {
    const aj = doc?.ajusteCreditoOutrasDespesas;
    const linhas = Array.isArray(aj?.itens) ? aj.itens : [];
    if (!linhas.length || !Array.isArray(doc?.itens)) return doc;

    const itens = doc.itens.map((it) => ({ ...it }));
    let somaIpi = 0;
    let somaSt = 0;
    for (const l of linhas) {
        const it = itens[l.indice];
        if (!it) continue;
        const ipi = r2(num(l.ipi));
        const st = r2(num(l.st));
        if (ipi > 0) {
            it.vIPI = r2(num(it.vIPI) + ipi);
            it.cstIpi = CST_IPI_ENTRADA_COM_CREDITO;
        }
        if (st > 0) it.vICMSST = r2(num(it.vICMSST) + st);
        if (it.vOutro !== undefined && it.vOutro !== null && num(it.vOutro) > 0) {
            it.vOutro = r2(Math.max(0, num(it.vOutro) - ipi - st));
        }
        it._creditoOutrasDespesas = { ipi, st };
        somaIpi += ipi;
        somaSt += st;
    }
    const t = { ...(doc.totais || {}) };
    t.vIPI = r2(num(t.vIPI) + somaIpi);
    t.vST = r2(num(t.vST) + somaSt);
    t.vOutro = r2(Math.max(0, num(t.vOutro) - somaIpi - somaSt));
    return { ...doc, itens, totais: t, _creditoOutrasDespesas: { ipi: r2(somaIpi), st: r2(somaSt) } };
}

/**
 * Aviso para quem escritura: a nota de ENTRADA tem outras despesas e o texto
 * dela cita IPI ou ST, sem ajuste lançado. NÃO deduz o valor — só aponta.
 */
export function sugereCreditoEmOutrasDespesas(doc) {
    if (direcaoEfetivaDoc(doc) !== 'entrada') return false;
    if (doc?.ajusteCreditoOutrasDespesas?.itens?.length) return false;
    if (num(doc?.totais?.vOutro) <= 0) return false;
    const texto = String(doc?.infAdic || doc?.infCpl || '');
    return /\bIPI\b|\bICMS[\s-]*ST\b|SUBST/i.test(texto);
}
