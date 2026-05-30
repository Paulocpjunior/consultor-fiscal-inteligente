// ============================================================================
// sefaz-backend/multa-calculator.js
// Calcula multa + juros estimados por tipo de obrigação fiscal em atraso.
//
// Fontes oficiais:
// - DAS Simples: LC 123/2006 art. 21 §3º — multa 0,33%/dia (máx 20%) + SELIC mensal
// - DCTFWeb: IN RFB 2.005/2021 — multa 2% do valor (mín R$ 200) + juros SELIC
// - FGTS: Lei 8.036/90 art. 22 — 0,5%/mês + TR + multa 10% do valor
// - DARF: art. 61 Lei 9.430/96 — 0,33%/dia (máx 20%) + SELIC mensal acumulada
// ============================================================================

// SELIC mensal aproximada (atualizar via BCB cuando preciso). Aqui usamos
// média conservadora — relatórios mostram valor estimado, não cobrança real.
const SELIC_MENSAL_PCT = 1.05; // ~12.5% a.a. → ~1.05% a.m.

function diasUteisEntre(dataInicio, dataFim) {
    if (!(dataInicio instanceof Date) || !(dataFim instanceof Date)) return 0;
    const ms = dataFim.getTime() - dataInicio.getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Multa + juros pra DAS / DARF (mesma lógica: 0,33%/dia + SELIC).
 *
 * @param {number} valorOriginal — valor do tributo a pagar (R$)
 * @param {Date} dataVencimento
 * @param {Date} dataPagamento — geralmente "hoje" pra previsão
 * @returns {{ multaPct, multaValor, jurosPct, jurosValor, total, dias }}
 */
export function calcularMultaDarf(valorOriginal, dataVencimento, dataPagamento = new Date()) {
    if (!valorOriginal || valorOriginal <= 0) return null;
    const dias = diasUteisEntre(dataVencimento, dataPagamento);
    if (dias <= 0) return { dias: 0, multaPct: 0, multaValor: 0, jurosPct: 0, jurosValor: 0, total: valorOriginal };
    // Multa de mora: 0,33% por dia, limitada a 20%
    const multaPct = Math.min(0.33 * dias, 20);
    const multaValor = valorOriginal * (multaPct / 100);
    // Juros: SELIC acumulada do mês seguinte ao vencimento + 1% no mês do pagamento
    const mesesAtraso = Math.ceil(dias / 30);
    const jurosPct = SELIC_MENSAL_PCT * Math.max(mesesAtraso - 1, 0) + 1;
    const jurosValor = valorOriginal * (jurosPct / 100);
    return {
        dias,
        multaPct: +multaPct.toFixed(4),
        multaValor: +multaValor.toFixed(2),
        jurosPct: +jurosPct.toFixed(4),
        jurosValor: +jurosValor.toFixed(2),
        total: +(valorOriginal + multaValor + jurosValor).toFixed(2),
    };
}

/**
 * DCTFWeb: multa de 2% (mín R$ 200) + juros SELIC.
 */
export function calcularMultaDctfweb(valorOriginal, dataVencimento, dataPagamento = new Date()) {
    if (!valorOriginal || valorOriginal <= 0) return null;
    const dias = diasUteisEntre(dataVencimento, dataPagamento);
    if (dias <= 0) return { dias: 0, multaPct: 0, multaValor: 0, jurosPct: 0, jurosValor: 0, total: valorOriginal };
    const mesesAtraso = Math.ceil(dias / 30);
    // Multa de mora: 2% por mês de atraso, máx 20%
    const multaPct = Math.min(2 * mesesAtraso, 20);
    const multaValorBruto = valorOriginal * (multaPct / 100);
    const multaValor = Math.max(multaValorBruto, 200);
    const jurosPct = SELIC_MENSAL_PCT * Math.max(mesesAtraso - 1, 0) + 1;
    const jurosValor = valorOriginal * (jurosPct / 100);
    return {
        dias,
        multaPct: +multaPct.toFixed(4),
        multaValor: +multaValor.toFixed(2),
        jurosPct: +jurosPct.toFixed(4),
        jurosValor: +jurosValor.toFixed(2),
        total: +(valorOriginal + multaValor + jurosValor).toFixed(2),
    };
}

/**
 * FGTS: 0,5%/mês + TR (~0%) + multa 10% (que reverte ao trabalhador).
 */
export function calcularMultaFgts(valorOriginal, dataVencimento, dataPagamento = new Date()) {
    if (!valorOriginal || valorOriginal <= 0) return null;
    const dias = diasUteisEntre(dataVencimento, dataPagamento);
    if (dias <= 0) return { dias: 0, multaPct: 0, multaValor: 0, jurosPct: 0, jurosValor: 0, total: valorOriginal };
    const mesesAtraso = Math.ceil(dias / 30);
    const multaPct = 10;
    const multaValor = valorOriginal * (multaPct / 100);
    const jurosPct = 0.5 * mesesAtraso;
    const jurosValor = valorOriginal * (jurosPct / 100);
    return {
        dias,
        multaPct,
        multaValor: +multaValor.toFixed(2),
        jurosPct: +jurosPct.toFixed(4),
        jurosValor: +jurosValor.toFixed(2),
        total: +(valorOriginal + multaValor + jurosValor).toFixed(2),
    };
}

/**
 * Roteador: detecta tipo pela obrigação da tarefa e aplica fórmula certa.
 */
export function calcularMultaPorObrigacao(obrigacao, valorOriginal, dataVencimento, dataPagamento = new Date()) {
    const obr = String(obrigacao || '').toUpperCase();
    if (obr.includes('FGTS')) return calcularMultaFgts(valorOriginal, dataVencimento, dataPagamento);
    if (obr.includes('DCTF') || obr.includes('REINF')) return calcularMultaDctfweb(valorOriginal, dataVencimento, dataPagamento);
    // DAS, DARF, ISS, etc. usam fórmula DARF (0,33%/dia)
    return calcularMultaDarf(valorOriginal, dataVencimento, dataPagamento);
}
