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

const TZ_BR = 'America/Sao_Paulo';

function anoMesBrt(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ_BR,
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(date);
    const year = Number(parts.find(p => p.type === 'year')?.value);
    const month = Number(parts.find(p => p.type === 'month')?.value);
    return { year, month };
}

function recuarMes(year, month) {
    if (month > 1) return { year, month: month - 1 };
    return { year: year - 1, month: 12 };
}

function labelCompetencia(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
}

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
    const atual = anoMesBrt(ref);
    let { year, month } = recuarMes(atual.year, atual.month);
    for (let i = 0; i < n; i++) {
        out.push(labelCompetencia(year, month));
        ({ year, month } = recuarMes(year, month));
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
    const atual = anoMesBrt(ref);
    let { year, month } = recuarMes(atual.year, atual.month);
    for (let i = 0; i < n; i++) {
        out.push({
            anoPA: year,
            mesPA: month,
            label: labelCompetencia(year, month),
        });
        ({ year, month } = recuarMes(year, month));
    }
    return out;
}
