/**
 * raiz-throttle-helper.js (PURO — sem firebase, testável em jest)
 *
 * Problema (caso J.N. VINATEX, 02/07/2026): o cron consulta DistDFe das 3
 * filiais da raiz 32602701 em sequência (06:02, 06:06, 06:06). A primeira
 * passa (cStat=137), as seguintes tomam cStat=656 "Consumo Indevido" — a
 * SEFAZ aplica rate-limit por autor/raiz dentro da janela de 1h. Resultado:
 * a filial 0002 está com ultNSU=0 há semanas (nunca capturou).
 *
 * Regra: no máximo 1 CNPJ por raiz (8 primeiros dígitos) por ciclo do cron,
 * com rotação diária determinística — cada filial sincroniza a cada N dias
 * (N = tamanho do grupo), sem precisar de estado extra no Firestore.
 */

/** Raiz do CNPJ (8 primeiros dígitos). '' se não for CNPJ de 14 dígitos. */
export function cnpjRaiz(cnpj) {
    const d = String(cnpj || '').replace(/\D/g, '');
    return d.length === 14 ? d.slice(0, 8) : '';
}

/**
 * Filtra a lista de empresas elegíveis para no máx. 1 por raiz por ciclo.
 * Rotação: índice = diaDoAno % tamanhoDoGrupo (grupo ordenado por CNPJ).
 * @param {Array<{cnpj: string}>} empresas
 * @param {number} agoraMs epoch ms (injetável pra teste determinístico)
 * @returns {{selecionadas: Array, puladas: Array}}
 */
export function umaPorRaizPorCiclo(empresas, agoraMs = Date.now()) {
    const grupos = new Map();
    for (const e of empresas || []) {
        const raiz = cnpjRaiz(e.cnpj) || `solo-${String(e.cnpj || Math.random())}`;
        if (!grupos.has(raiz)) grupos.set(raiz, []);
        grupos.get(raiz).push(e);
    }
    const dia = Math.floor(agoraMs / 86400000);
    const selecionadas = [];
    const puladas = [];
    for (const grupo of grupos.values()) {
        if (grupo.length === 1) { selecionadas.push(grupo[0]); continue; }
        grupo.sort((a, b) => String(a.cnpj).localeCompare(String(b.cnpj)));
        const idx = dia % grupo.length;
        grupo.forEach((e, i) => (i === idx ? selecionadas : puladas).push(e));
    }
    return { selecionadas, puladas };
}
