// Normaliza variações do retorno SERPRO GERARDAS12 para o formato interno.

import { parseValorDas } from './das-valor-utils.js';

function firstNonEmpty(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return '';
}

function dataSerproToIso(value) {
    const raw = String(value || '').replace(/\D/g, '');
    if (/^\d{8}$/.test(raw)) {
        return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
    return value || '';
}

export function normalizarRespostaDasSerpro(result, valorFallback = 0) {
    const dados = result?.dados || {};
    const item = Array.isArray(dados) ? (dados[0] || {}) : dados;
    const detalhamento = item.detalhamentoDas || item.detalhamentoDAS || item.detalhamento || {};
    const valores = detalhamento.valores || item.valores || {};

    return {
        numeroDocumento: firstNonEmpty(
            item.numeroDocumento,
            item.numeroDarf,
            item.numeroDas,
            detalhamento.numeroDocumento,
            detalhamento.numeroDarf,
            detalhamento.numeroDas,
        ),
        codigoBarras: firstNonEmpty(
            item.codigoBarras,
            item.linhaDigitavel,
            item.codigoBarra,
            item.codBarras,
            detalhamento.codigoBarras,
            detalhamento.linhaDigitavel,
        ),
        vencimento: dataSerproToIso(firstNonEmpty(
            item.dataVencimento,
            item.vencimento,
            detalhamento.dataVencimento,
            detalhamento.vencimento,
            detalhamento.dataLimiteAcolhimento,
        )),
        // parseValorDas trata tanto "1234.56" quanto o pt-BR "1.234,56" —
        // Number() cru viraria NaN no formato brasileiro (achado 09/07/2026).
        valor: parseValorDas(firstNonEmpty(
            item.valorTotal,
            item.valor,
            valores.total,
            valores.principal,
            valorFallback,
        )),
        pdfUrl: item.pdfUrl || null,
        pdfBase64: firstNonEmpty(
            item.docArrecadacaoPdfB64,
            item.pdfBase64,
            item.pdf,
            item.arquivo,
            detalhamento.docArrecadacaoPdfB64,
            detalhamento.pdfBase64,
            detalhamento.pdf,
        ) || null,
        _raw: dados,
    };
}
