// ============================================================================
// sefaz-backend/data-brt.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 📅 A DATA DE HOJE NO FUSO DO ESCRITÓRIO — dono único.
//
// Auditoria de 26/09: 57 usos de `new Date().toISOString().slice(0, 10|7)` no
// backend, e 15 offsets fixos de -3 h. O Cloud Run roda em UTC: das 21h à
// meia-noite (horário de Brasília) o "hoje" em UTC já é amanhã. É a classe do
// vencido-a-menor (guia que vence hoje aparece "vencida" às 21h) e da suíte
// que ficava vermelha à noite. Aqui a data sai do Intl com o fuso explícito,
// que conhece o horário de verão se ele voltar, e o instante entra por
// parâmetro para o teste pinar.
// ============================================================================

export const FUSO_ESCRITORIO = 'America/Sao_Paulo';

const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_ESCRITORIO, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** 'AAAA-MM-DD' de `agora` no fuso de São Paulo. Inválido → null. */
export function dataBrt(agora = new Date()) {
    const d = agora instanceof Date ? agora : new Date(agora);
    if (Number.isNaN(d.getTime())) return null;
    // en-CA formata como 2026-09-25 — o ISO sem hora, sem depender de locale
    // com barras. `formatToParts` é a forma robusta caso o padrão mude.
    const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
}

/** 'AAAA-MM-DD' de hoje no fuso de São Paulo. */
export function hojeBrt(agora = new Date()) {
    return dataBrt(agora);
}

/** 'AAAA-MM' de hoje no fuso de São Paulo (competência corrente). */
export function anoMesBrt(agora = new Date()) {
    const d = dataBrt(agora);
    return d ? d.slice(0, 7) : null;
}
