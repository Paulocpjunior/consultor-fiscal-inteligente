// ============================================================================
// sefaz-backend/cofre-email-metrics.js  (ESM)
// ----------------------------------------------------------------------------
// Lógica PURA (testável) das MÉTRICAS do cofre de e-mail (Fase 1 — controle).
// Agrega o histórico de execuções (cofre_email_runs) em KPIs pro painel, sem
// varrer documentos_fiscais (cada run já traz suas contagens).
// ============================================================================

const DIA_MS = 24 * 60 * 60 * 1000;
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000; // -03:00: desloca antes de fatiar o dia

/** Data YYYY-MM-DD no fuso BRT a partir de um timestamp ms. */
export function diaBRT(ms) {
  return new Date(Number(ms) - BRT_OFFSET_MS).toISOString().slice(0, 10);
}
/** Competência YYYY-MM no fuso BRT. */
export function mesBRT(ms) {
  return diaBRT(ms).slice(0, 7);
}

/**
 * Agrega uma lista de runs em KPIs.
 * @param {Array<{ranAtMs:number, saida?:number, entrada?:number, erros?:number, mensagens?:number}>} runs
 * @param {number} hojeMs
 * @param {number} [diasSerie=14] tamanho da série diária
 */
export function agregarKpisDeRuns(runs, hojeMs, diasSerie = 14) {
  const hoje = diaBRT(hojeMs);
  const mes = mesBRT(hojeMs);

  const tot = { saida: 0, entrada: 0, erros: 0, execucoes: 0 };
  const kpiHoje = { saida: 0, entrada: 0, erros: 0 };
  const kpiMes = { saida: 0, entrada: 0, erros: 0 };
  const porDiaMap = new Map(); // dia -> {saida, entrada}
  let ultimaExecMs = null;

  for (const r of runs || []) {
    const ms = Number(r.ranAtMs);
    if (!Number.isFinite(ms)) continue;
    const s = Number(r.saida || 0), e = Number(r.entrada || 0), er = Number(r.erros || 0);
    tot.saida += s; tot.entrada += e; tot.erros += er; tot.execucoes++;
    if (ultimaExecMs === null || ms > ultimaExecMs) ultimaExecMs = ms;

    const dia = diaBRT(ms);
    if (dia === hoje) { kpiHoje.saida += s; kpiHoje.entrada += e; kpiHoje.erros += er; }
    if (mesBRT(ms) === mes) { kpiMes.saida += s; kpiMes.entrada += e; kpiMes.erros += er; }

    const acc = porDiaMap.get(dia) || { saida: 0, entrada: 0 };
    acc.saida += s; acc.entrada += e;
    porDiaMap.set(dia, acc);
  }

  // Série dos últimos `diasSerie` dias (preenche zeros nos dias sem execução).
  const porDia = [];
  for (let i = diasSerie - 1; i >= 0; i--) {
    const dia = diaBRT(hojeMs - i * DIA_MS);
    const v = porDiaMap.get(dia) || { saida: 0, entrada: 0 };
    porDia.push({ dia, saida: v.saida, entrada: v.entrada });
  }

  return { hoje: kpiHoje, mes: kpiMes, total: tot, porDia, ultimaExecMs };
}
