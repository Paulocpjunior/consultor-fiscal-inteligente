// ============================================================================
// sefaz-backend/sped-fiscal-format.js
// Helpers de formatacao SPED Fiscal (EFD ICMS/IPI).
//
// Regras Guia Pratico 3.2.2:
// - Datas: DDMMAAAA (sem separadores)
// - Valores: VIRGULA como separador decimal (NT 2024.001), sem milhar.
//   Vazio fica como '' (NAO zero).
// - Strings: limitadas ao tamanho maximo, sem pipes (|), sem espacos
//   nas pontas. Acentos preservados (a SPED aceita Windows-1252).
// - Linhas: separadores |campo1|campo2|...|, terminadas em |\r\n.
// ============================================================================

/** Formata data ISO (YYYY-MM-DD) ou Date pra DDMMAAAA. */
function formatDate(value) {
    if (!value) return '';
    let d;
    if (value instanceof Date) {
        d = value;
    } else if (typeof value === 'string') {
        // Aceita ISO completo ou apenas YYYY-MM-DD
        d = new Date(value);
        if (isNaN(d.getTime())) {
            // Fallback: tenta parsing manual YYYY-MM-DD
            const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (m) return m[3] + m[2] + m[1];
            return '';
        }
    } else {
        return '';
    }
    const dia = String(d.getUTCDate()).padStart(2, '0');
    const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
    const ano = d.getUTCFullYear();
    return `${dia}${mes}${ano}`;
}

/** Formata competencia YYYY-MM pra DDMMAAAA do primeiro dia do mes. */
function formatCompetenciaInicio(competencia) {
    if (!competencia) return '';
    const m = competencia.match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    return `01${m[2]}${m[1]}`;
}

/** Formata competencia YYYY-MM pra DDMMAAAA do ultimo dia do mes. */
function formatCompetenciaFim(competencia) {
    if (!competencia) return '';
    const m = competencia.match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    const ano = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10);
    // Ultimo dia do mes
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return `${String(ultimoDia).padStart(2, '0')}${m[2]}${m[1]}`;
}

/** Formata valor numerico pra string SPED (ponto decimal, sem milhar). */
function formatValue(value, decimals = 2) {
    if (value === null || value === undefined || value === '') return '';
    const n = parseFloat(value);
    if (isNaN(n)) return '';
    // SPED Fiscal exige virgula como separador decimal (NT 2024.001 item a)
    return n.toFixed(decimals).replace('.', ',');
}

/**
 * Sanitiza string pra ficar valida em campo SPED:
 * - Remove pipes (|) que conflitam com separador.
 * - Remove caracteres de controle.
 * - Trim.
 * - Trunca pra tamanho maximo se especificado.
 */
function sanitizeString(s, maxLen) {
    if (!s) return '';
    let cleaned = String(s)
        .replace(/\|/g, ' ')        // pipes viram espaco
        .replace(/[\x00-\x1F\x7F]/g, ' ')  // control chars viram espaco
        .replace(/\s+/g, ' ')        // espacos consecutivos viram 1
        .trim();
    if (maxLen && cleaned.length > maxLen) {
        cleaned = cleaned.substring(0, maxLen);
    }
    return cleaned;
}

/** Sanitiza CNPJ ou CPF pra ficar so com digitos. */
function sanitizeCnpjCpf(s) {
    if (!s) return '';
    return String(s).replace(/\D/g, '');
}

/** Sanitiza CEP pra ficar so com digitos. */
function sanitizeCep(s) {
    if (!s) return '';
    return String(s).replace(/\D/g, '');
}

/**
 * Monta uma linha SPED a partir de array de campos.
 * Adiciona | no inicio, fim e entre cada campo.
 * Termina com |\r\n.
 */
function buildLine(campos) {
    return '|' + campos.map(c => c === null || c === undefined ? '' : String(c)).join('|') + '|\r\n';
}

export {
    formatDate,
    formatCompetenciaInicio,
    formatCompetenciaFim,
    formatValue,
    sanitizeString,
    sanitizeCnpjCpf,
    sanitizeCep,
    buildLine,
};
