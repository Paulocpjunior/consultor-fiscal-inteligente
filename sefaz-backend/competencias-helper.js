// ============================================================================
// competencias-helper.js  (PURO — sem io/firebase, testavel)
//
// Helper de geracao de competencias (rotulos YYYY-MM) para os painéis de
// cobertura (PGDAS, DCTFWeb, Minha Agenda). Centraliza a regra critica
// "mes atual nao entra" — PGDAS/DCTFWeb do mes atual vencem dia 20 do
// proximo mes, entao incluir geraria falso "nao transmitido".
//
// Aceita parametro opcional `agoraIso` (ISO 8601 string) pra testar com
// data determinista. Sem ele, usa o relogio do sistema.
// ============================================================================

/**
 * Retorna as N ultimas competencias mensais, em ordem decrescente (mais
 * recente primeiro), comecando do MES ANTERIOR ao informado.
 *
 * @param {number} n  qtd de meses (≥1)
 * @param {string} [agoraIso]  data de referencia em ISO; default = new Date()
 * @returns {string[]}  ex. ['2026-05', '2026-04', '2026-03']
 */
export function ultimasCompetencias(n, agoraIso) {
    if (!Number.isFinite(n) || n < 1) return [];
    const ref = agoraIso ? new Date(agoraIso) : new Date();
    const out = [];
    const d = new Date(ref.getFullYear(), ref.getMonth(), 1); // 1o dia do mes atual
    d.setMonth(d.getMonth() - 1); // recua p/ mes anterior
    for (let i = 0; i < n; i++) {
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        d.setMonth(d.getMonth() - 1);
    }
    return out;
}

/**
 * Mesma logica mas devolve objetos { anoPA, mesPA, label } — formato usado
 * pelo DCTFWeb que separa ano/mes (queries Firestore mais eficientes).
 */
export function ultimasCompetenciasComAnoMes(n, agoraIso) {
    if (!Number.isFinite(n) || n < 1) return [];
    const ref = agoraIso ? new Date(agoraIso) : new Date();
    const out = [];
    const d = new Date(ref.getFullYear(), ref.getMonth(), 1);
    d.setMonth(d.getMonth() - 1);
    for (let i = 0; i < n; i++) {
        out.push({
            anoPA: d.getFullYear(),
            mesPA: d.getMonth() + 1,
            label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        });
        d.setMonth(d.getMonth() - 1);
    }
    return out;
}
