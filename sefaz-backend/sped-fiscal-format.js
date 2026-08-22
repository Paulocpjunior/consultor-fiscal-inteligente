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

/**
 * Formata data pra DDMMAAAA.
 *
 * 🚨 A DATA DO DOCUMENTO É A DO EMITENTE — nunca a convertida para UTC.
 *
 * O `dhEmi` da NF-e chega com o fuso do emitente (`2026-07-31T22:30:00-03:00`).
 * A versão anterior fazia `new Date(...)` e lia `getUTCDate()`: a nota emitida
 * às 22h30 de Brasília vira **01/08** em UTC, porque lá já é o dia seguinte.
 *
 * O efeito é de duas gravidades:
 *   · nota emitida depois das **21h** sai no arquivo com a data do dia
 *     SEGUINTE — errado, e ninguém percebe;
 *   · na VIRADA DO MÊS ela sai com a data de OUTRA competência, e aí o PVA
 *     recusa ("data fora do período da escrituração").
 *
 * A data que o documento fiscal declara é a do texto — `2026-07-31` —, então
 * é o TEXTO que responde. Converter para outro fuso é reescrever o que a nota
 * diz.
 *
 * ⚠️ `Date` continua lido em UTC porque um `Date` já perdeu o fuso de origem:
 * não há o que recuperar. Quem tem a string não deve convertê-la antes.
 */
function formatDate(value) {
    if (!value) return '';
    if (typeof value === 'string') {
        // ISO com ou sem hora — a data é o prefixo, no fuso do emitente.
        const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return iso[3] + iso[2] + iso[1];
        // Forma brasileira, que aparece em colagem e em cadastro manual.
        const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (br) return br[1] + br[2] + br[3];
        const d = new Date(value);
        if (isNaN(d.getTime())) return '';
        return emUtc(d);
    }
    if (value instanceof Date) return emUtc(value);
    // Firestore Timestamp (ou qualquer coisa com toDate) — data não se perde
    // em silêncio num campo que o PVA cobra.
    if (typeof value?.toDate === 'function') {
        const d = value.toDate();
        return d instanceof Date && !isNaN(d.getTime()) ? emUtc(d) : '';
    }
    return '';
}

function emUtc(d) {
    const dia = String(d.getUTCDate()).padStart(2, '0');
    const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dia}${mes}${d.getUTCFullYear()}`;
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

/**
 * Formata valor numerico pra string SPED (virgula decimal, sem milhar).
 *
 * 🚨 O `parseFloat` CRU ENCOLHIA O NÚMERO EM SILÊNCIO (22/08). Ele lê só o
 * prefixo que entende, e as duas formas em que um valor chega como TEXTO neste
 * projeto são justamente as que ele erra:
 *
 *   · `'1.234,56'` (pt-BR, como sai de e-Fiscal, PDF e colagem) → **1.234**,
 *     ou seja **`1,23`** no arquivo — mil vezes menos;
 *   · `'1234,56'`  (digitado sem milhar)                        → **1234**,
 *     ou seja os centavos somem.
 *
 * Nas duas o arquivo sai com um número ERRADO e plausível, que é o pior
 * desfecho: o PVA aceita, e ninguém confere valor a olho. Número é lido pela
 * MESMA régua do resto da casa — `parseValorMoeda` responde "que número é
 * este?" para texto digitado; aqui vale a mesma leitura, porque a origem do
 * texto é a mesma pessoa ou o mesmo relatório.
 *
 * ⚠️ Ilegível continua saindo **''** (ausência), nunca zero: campo de valor não
 * recebe default, e '' o PVA acusa — número errado, não.
 */
function formatValue(value, decimals = 2) {
    if (value === null || value === undefined || value === '') return '';
    const n = typeof value === 'number' ? value : numeroDeTexto(value);
    if (n === null || !Number.isFinite(n)) return '';
    // SPED Fiscal exige virgula como separador decimal (NT 2024.001 item a)
    return n.toFixed(decimals).replace('.', ',');
}

/**
 * Texto → número, cobrindo as formas em que o valor chega de verdade: pt-BR
 * com milhar, pt-BR sem milhar, e a forma JS com ponto decimal. Devolve null
 * para o que não é número — nunca um prefixo.
 */
function numeroDeTexto(value) {
    const t = String(value).trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
    if (!t) return null;
    const sinal = t.startsWith('-') ? -1 : 1;
    const s = t.replace(/^[+-]/, '');
    if (!/^[\d.,]+$/.test(s)) return null;
    let normalizado;
    if (s.includes(',')) {
        // Vírgula presente ⇒ pt-BR: pontos são milhar, vírgula é decimal.
        normalizado = s.replace(/\./g, '').replace(',', '.');
    } else if ((s.match(/\./g) || []).length === 1 && /^\d+\.\d{1,2}$/.test(s)) {
        normalizado = s;                      // decimal JS ("1234.56")
    } else {
        normalizado = s.replace(/\./g, '');   // "1.234" / "1.234.567" ⇒ milhar
    }
    const n = Number(normalizado);
    return Number.isFinite(n) ? sinal * n : null;
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
