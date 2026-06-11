// ============================================================================
// pgdas-utils.js
// Helpers puros para montar/validar payloads PGDAS-D antes da transmissao real.
// ============================================================================

export const PGDAS_VALOR_TOLERANCIA_PADRAO = 0.05;

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

function parseMaybeJson(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    try { return JSON.parse(trimmed); }
    catch { return value; }
}

function findDeclaracaoTransmitida(value, depth = 0) {
    if (depth > 6 || value == null) return null;
    const parsed = parseMaybeJson(value);

    if (Array.isArray(parsed)) {
        return parsed
            .map((item) => findDeclaracaoTransmitida(item, depth + 1) || item)
            .find((item) => item && typeof item === 'object' && (
                Array.isArray(item.valoresDevidos)
                || item.idDeclaracao
                || item.numeroDeclaracao
                || item.recibo
            )) || parsed[0] || null;
    }

    if (typeof parsed !== 'object') return null;
    if (Array.isArray(parsed.valoresDevidos)) return parsed;

    for (const key of ['dados', 'declaracaoTransmitida', 'declaracao', 'resultado', 'declaracoes', 'declaracoesTransmitidas']) {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
            const found = findDeclaracaoTransmitida(parsed[key], depth + 1);
            if (found) return found;
        }
    }
    return null;
}

export function extrairDeclaracaoTransmitidaPgdas(result) {
    if (!result) return null;
    return findDeclaracaoTransmitida(result.dados ?? result);
}

export function normalizarValoresDevidosPgdas(input) {
    const fonte = Array.isArray(input)
        ? input
        : (extrairDeclaracaoTransmitidaPgdas(input)?.valoresDevidos || []);

    return fonte
        .map((item) => ({
            codigoTributo: Number(item.codigoTributo ?? item.codTributo),
            valor: round2(item.valor),
        }))
        .filter((item) => Number.isFinite(item.codigoTributo) && item.codigoTributo > 0 && item.valor >= 0)
        .sort((a, b) => a.codigoTributo - b.codigoTributo);
}

export function somaValoresDevidosPgdas(valoresDevidos) {
    return round2(normalizarValoresDevidosPgdas(valoresDevidos)
        .reduce((sum, item) => sum + item.valor, 0));
}

export function montarDadosDeclaracaoPgdas({
    cnpjLimpo,
    pa,
    declaracao,
    transmitir,
    valoresParaComparacao = [],
}) {
    const valoresComparacao = normalizarValoresDevidosPgdas(valoresParaComparacao);
    const dados = {
        cnpjCompleto: cnpjLimpo,
        pa,
        indicadorTransmissao: Boolean(transmitir),
        indicadorComparacao: Boolean(transmitir && valoresComparacao.length > 0),
        declaracao,
    };
    if (valoresComparacao.length > 0) {
        dados.valoresParaComparacao = valoresComparacao;
    }
    return dados;
}

export function assertValorPgdasCompativel({
    valorLocal,
    valoresDevidos,
    tolerancia = PGDAS_VALOR_TOLERANCIA_PADRAO,
}) {
    const valorSerpro = somaValoresDevidosPgdas(valoresDevidos);
    const valorApp = round2(valorLocal);
    const diferenca = round2(Math.abs(valorSerpro - valorApp));
    if (diferenca <= tolerancia) {
        return { ok: true, valorSerpro, valorApp, diferenca };
    }

    const err = new Error(
        `SERPRO calculou DAS de R$ ${valorSerpro.toFixed(2).replace('.', ',')}, ` +
        `mas a apuracao local esta em R$ ${valorApp.toFixed(2).replace('.', ',')}. ` +
        'Nenhuma declaracao foi transmitida. Revise anexo, segregacoes, ISS retido, ST/monofasico e folha antes de emitir.'
    );
    err.code = 'PGDAS_VALOR_DIVERGENTE';
    err.httpStatus = 422;
    err.valorSerpro = valorSerpro;
    err.valorApp = valorApp;
    err.diferenca = diferenca;
    return (() => { throw err; })();
}
