// ============================================================================
// sefaz-backend/cnpjs-dirigidos.js
//
// Régua da CAPTURA DIRIGIDA: normaliza a lista de CNPJs que a rodada vai
// percorrer. Mora fora das rotas porque rota é I/O — e porque `sync-routes.js`
// puxa firebase-admin e não carrega no jest (a régua sem teste é a régua que
// ninguém prova).
//
// ⚠️ O TETO É DO TEMPO, NÃO DO GOSTO: a rodada dorme 90s entre empresas — é
// esse respiro que evita o cStat **656** ("Consumo Indevido") da SEFAZ, que é
// limite DELA. Trinta CNPJs já são ~45 min de rodada.
// ============================================================================

/** Máximo de CNPJs por rodada dirigida. */
export const LIMITE_CNPJS_DIRIGIDOS = 30;

/** Respiro entre empresas, em ms — o que segura o 656. */
export const RESPIRO_ENTRE_EMPRESAS_MS = 90000;

/**
 * Normaliza a lista pedida: só dígitos, 14 posições, sem repetido, sem vazio.
 *
 * Quem usa a captura dirigida COLA de uma lista (a 🎯 prioritárias, a fila de
 * migração), então a entrada chega com máscara, vírgula, ponto-e-vírgula ou
 * quebra de linha — quem separa é quem lê, não quem digita.
 *
 * @param {unknown} lista
 * @returns {string[]}
 */
export function normalizarCnpjsDirigidos(lista) {
    const vistos = new Set();
    const out = [];
    for (const c of Array.isArray(lista) ? lista : []) {
        const d = String(c ?? '').replace(/\D/g, '');
        if (d.length !== 14 || vistos.has(d)) continue;
        vistos.add(d);
        out.push(d);
    }
    return out;
}

/**
 * Minutos estimados da rodada. A primeira empresa não espera — o respiro é
 * ENTRE elas —, e o número aparece ANTES do clique: rodada de 45 min sem aviso
 * é lida como "travou".
 *
 * @param {number} quantas
 * @returns {number}
 */
export function minutosEstimadosDirigida(quantas) {
    if (!Number.isFinite(quantas) || quantas <= 1) return 0;
    return Math.ceil((quantas - 1) * (RESPIRO_ENTRE_EMPRESAS_MS / 1000) / 60);
}
