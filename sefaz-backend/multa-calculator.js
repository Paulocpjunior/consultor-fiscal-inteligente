// ============================================================================
// sefaz-backend/multa-calculator.js
// Calcula multa + juros ESTIMADOS por tipo de obrigação fiscal em atraso.
//
// Fontes oficiais:
// - DAS Simples: LC 123/2006 art. 21 §3º — multa 0,33%/dia (máx 20%) + SELIC mensal
// - DARF: Lei 9.430/96 art. 61 — 0,33%/dia (máx 20%) + SELIC mensal acumulada
// - DCTFWeb (o DÉBITO confessado): mesma mora do art. 61 sobre o tributo
// - FGTS: Lei 8.036/90 art. 22 — 0,5%/mês ou fração + TR + multa 10% do valor
//
// ═══ O QUE A AUDITORIA DE 03/09 CORRIGIU AQUI ═══════════════════════════════
//
// (a) `diasUteisEntre` contava dias CORRIDOS — o nome mentia. A mora de
//     0,33% "por dia" do art. 61 é por dia CALENDÁRIO (o §2º fala em "dia de
//     atraso", sem exclusão de fim de semana), então contar corridos é o
//     certo; o que estava errado era o NOME. Virou `diasCorridosEntre`.
//
// (b) O piso de R$ 200 na multa da DCTFWeb é a MULTA POR ATRASO NA ENTREGA
//     da declaração (Lei 10.426/2002 art. 7º, multa isolada — mínimo de
//     R$ 200/R$ 500) — não é mora sobre o DÉBITO. Somá-lo ao tributo em
//     atraso inflava a previsão de quem pagou o DARF atrasado com uma multa
//     de OUTRO fato. Este módulo calcula mora sobre débito; a multa de
//     entrega não é calculada aqui (nem em lugar nenhum do app hoje).
//
// (c) Os juros eram `SELIC × ceil(dias/30) − 1` — uma aproximação que dava
//     juro de "um mês" para um pagamento no MESMO mês do vencimento. O art.
//     61 §3º é por MÊS de calendário: SELIC acumulada do mês SEGUINTE ao do
//     vencimento até o mês ANTERIOR ao do pagamento, mais 1% no mês do
//     pagamento. Pagou no mesmo mês ⇒ juros ZERO; no mês seguinte ⇒ 1%; três
//     meses depois ⇒ SELIC de dois meses + 1%.
//
// ⚠️ `SELIC_MENSAL_PCT` É UM NÚMERO ESTALADO — média conservadora escrita à
// mão, não a SELIC publicada pelo BCB. Serve à PREVISÃO da tela ("vencido,
// estimado em R$ X"); quem calcula a cobrança REAL é o SICALC/PGDAS. Trocar
// por uma fonte (série 4390 do BCB, com vigência) é o passo que falta.
// ============================================================================

/** SELIC mensal aproximada (~12,5% a.a.). ESTIMATIVA — não é a taxa publicada. */
export const SELIC_MENSAL_PCT = 1.05;

/** Dias CORRIDOS entre duas datas (calendário, o que o art. 61 §2º conta). */
export function diasCorridosEntre(dataInicio, dataFim) {
    if (!(dataInicio instanceof Date) || !(dataFim instanceof Date)) return 0;
    if (Number.isNaN(dataInicio.getTime()) || Number.isNaN(dataFim.getTime())) return 0;
    const ms = dataFim.getTime() - dataInicio.getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Meses de CALENDÁRIO entre o mês do vencimento e o mês do pagamento
 * (jul→jul = 0, jul→ago = 1, jul→out = 3). Lê os campos em UTC porque as
 * datas chegam como `new Date('AAAA-MM-DD')` (meia-noite UTC) — ler local
 * no Cloud Run (UTC) dá o mesmo; ler local numa máquina em BRT recuaria um
 * dia e trocaria o mês na virada.
 */
export function mesesCalendarioEntre(dataInicio, dataFim) {
    return (dataFim.getUTCFullYear() - dataInicio.getUTCFullYear()) * 12
        + (dataFim.getUTCMonth() - dataInicio.getUTCMonth());
}

/**
 * Juros do art. 61 §3º da Lei 9.430/96, em %: SELIC acumulada do mês
 * SEGUINTE ao vencimento até o mês ANTERIOR ao pagamento + 1% no mês do
 * pagamento. Mesmo mês ⇒ 0.
 *
 * @param {number} [selicMensalPct] taxa mensal usada na acumulação (estimativa)
 */
export function jurosSelicPct(dataVencimento, dataPagamento, selicMensalPct = SELIC_MENSAL_PCT) {
    const meses = mesesCalendarioEntre(dataVencimento, dataPagamento);
    if (meses <= 0) return 0;
    return selicMensalPct * (meses - 1) + 1;
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
    const dias = diasCorridosEntre(dataVencimento, dataPagamento);
    if (dias <= 0) return { dias: 0, multaPct: 0, multaValor: 0, jurosPct: 0, jurosValor: 0, total: valorOriginal };
    // Multa de mora: 0,33% por dia, limitada a 20%
    const multaPct = Math.min(0.33 * dias, 20);
    const multaValor = valorOriginal * (multaPct / 100);
    const jurosPct = jurosSelicPct(dataVencimento, dataPagamento);
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
 * DCTFWeb — mora sobre o DÉBITO confessado: 2% por mês de atraso (máx 20%)
 * + juros do art. 61 §3º. SEM o piso de R$ 200: esse piso é da multa por
 * atraso na ENTREGA da declaração (Lei 10.426/2002 art. 7º), outro fato.
 */
export function calcularMultaDctfweb(valorOriginal, dataVencimento, dataPagamento = new Date()) {
    if (!valorOriginal || valorOriginal <= 0) return null;
    const dias = diasCorridosEntre(dataVencimento, dataPagamento);
    if (dias <= 0) return { dias: 0, multaPct: 0, multaValor: 0, jurosPct: 0, jurosValor: 0, total: valorOriginal };
    // "mês ou fração": atraso dentro do mês do vencimento já conta um.
    const mesesAtraso = mesesCalendarioEntre(dataVencimento, dataPagamento) + 1;
    const multaPct = Math.min(2 * mesesAtraso, 20);
    const multaValor = valorOriginal * (multaPct / 100);
    const jurosPct = jurosSelicPct(dataVencimento, dataPagamento);
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
 * FGTS: 0,5%/mês OU FRAÇÃO (Lei 8.036/90 art. 22, I) + TR (~0%) + multa 10%
 * (que reverte ao trabalhador). "Ou fração" ⇒ o mês do vencimento já conta.
 */
export function calcularMultaFgts(valorOriginal, dataVencimento, dataPagamento = new Date()) {
    if (!valorOriginal || valorOriginal <= 0) return null;
    const dias = diasCorridosEntre(dataVencimento, dataPagamento);
    if (dias <= 0) return { dias: 0, multaPct: 0, multaValor: 0, jurosPct: 0, jurosValor: 0, total: valorOriginal };
    const mesesAtraso = mesesCalendarioEntre(dataVencimento, dataPagamento) + 1;
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
