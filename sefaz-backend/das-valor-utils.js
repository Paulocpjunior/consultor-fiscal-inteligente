// ============================================================================
// das-valor-utils.js
// Normalizacao segura de valores de guia DAS vindos da UI/API.
// ============================================================================

export function parseValorDas(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value ?? '').trim();
    if (!raw) return 0;
    const cleaned = raw.replace(/[^\d,.-]/g, '');
    if (!cleaned) return 0;

    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
        const decimalSep = lastComma > lastDot ? ',' : '.';
        const thousandSep = decimalSep === ',' ? '.' : ',';
        const normalized = cleaned
            .replace(new RegExp(`\\${thousandSep}`, 'g'), '')
            .replace(decimalSep, '.');
        const n = Number(normalized);
        return Number.isFinite(n) ? n : 0;
    }

    if (lastComma >= 0) {
        const n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
        return Number.isFinite(n) ? n : 0;
    }

    const dotMatches = cleaned.match(/\./g) || [];
    if (dotMatches.length > 1) {
        const n = Number(cleaned.replace(/\./g, ''));
        return Number.isFinite(n) ? n : 0;
    }

    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
}

export function normalizarValorDas(value) {
    return Math.round(parseValorDas(value) * 100) / 100;
}

export function assertValorMinimoDas(value) {
    const valor = normalizarValorDas(value);
    if (!valor || valor < 10) {
        const err = new Error('Valor mínimo R$ 10,00');
        err.code = 'DAS_VALOR_MINIMO';
        err.httpStatus = 400;
        throw err;
    }
    return valor;
}
