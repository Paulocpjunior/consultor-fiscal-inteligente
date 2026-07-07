/**
 * sharepoint-competencia-helper.js (PURO — sem firebase, testável em jest)
 *
 * Problema (caso J.N. VINATEX, 07/07/2026): o auto-sync do SharePoint só
 * varria a pasta da competência do MÊS ATUAL (`new Date()`). Na virada do
 * mês o cron trocava de pasta — os XMLs de junho depositados pelo cliente
 * nos primeiros dias de julho (fluxo normal de fechamento fiscal) nunca
 * eram baixados. Resultado: "XMLs NFe (Entrada/Saída)" com 06/2026 vazio
 * e nenhum erro em lugar algum, porque a pasta de julho sincronizava OK.
 *
 * Regra: cada execução do auto-sync varre uma JANELA de competências —
 * por padrão a anterior + a atual (mais antiga primeiro, é o mês em
 * fechamento). A deduplicação por chave de acesso torna a re-varredura
 * idempotente. Competência explícita no body continua valendo sozinha
 * (disparo manual pra um mês específico).
 */

/**
 * Decide quais competências (YYYY-MM) o auto-sync deve varrer.
 *
 * @param {number} nowMs        timestamp de referência (Date.now()).
 * @param {object} [opts]
 * @param {string} [opts.explicita]  competência YYYY-MM pedida no request —
 *                                   se válida, é a única varrida.
 * @param {number} [opts.janelas]    quantos meses varrer (default 2 =
 *                                   anterior + atual; clamp 1..6).
 * @returns {string[]} competências em ordem cronológica (mais antiga primeiro).
 */
export function competenciasAutoSync(nowMs, opts = {}) {
    const explicita = String(opts.explicita || '').trim();
    if (/^\d{4}-\d{2}$/.test(explicita)) return [explicita];

    const janelas = Math.max(1, Math.min(6, Number(opts.janelas) || 2));
    let d = new Date(nowMs);
    if (Number.isNaN(d.getTime())) d = new Date();

    let ano = d.getUTCFullYear();
    let mes = d.getUTCMonth(); // 0-based
    const out = [];
    for (let i = 0; i < janelas; i++) {
        out.push(`${ano}-${String(mes + 1).padStart(2, '0')}`);
        mes--;
        if (mes < 0) { mes = 11; ano--; }
    }
    return out.reverse();
}
