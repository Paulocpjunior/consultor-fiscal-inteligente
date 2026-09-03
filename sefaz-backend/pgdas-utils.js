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

/**
 * 🚨 `round2(Number(n) || 0)` TRANSFORMAVA VALOR AUSENTE/ILEGÍVEL DO SERPRO EM
 * 0,00 (03/09) — e o `>= 0` do filtro o MANTINHA. Um tributo que voltou sem
 * valor entrava na soma valendo zero: ou a comparação acusava divergência
 * falsa (a apuração local tem o tributo, a soma não), ou — pior — batia por
 * coincidência e a declaração ia com um débito a menos. Item que não dá para
 * ler sai NOMEADO em `ilegiveis`, e a SOMA se recusa a existir enquanto houver
 * um: total parcial num campo chamado "valor devido" é lido como o total.
 *
 * @returns {{ valores: Array<{codigoTributo:number, valor:number}>, ilegiveis: Array<{codigoTributo:unknown, valor:unknown, motivo:string}> }}
 */
export function lerValoresDevidosPgdas(input) {
    const fonte = Array.isArray(input)
        ? input
        : (extrairDeclaracaoTransmitidaPgdas(input)?.valoresDevidos || []);

    const valores = [];
    const ilegiveis = [];
    for (const item of fonte) {
        const codigoCru = item?.codigoTributo ?? item?.codTributo;
        const codigoTributo = Number(codigoCru);
        const valorCru = item?.valor;
        const valorNum = (valorCru === null || valorCru === undefined || valorCru === '')
            ? NaN
            : Number(valorCru);
        if (!Number.isFinite(codigoTributo) || codigoTributo <= 0) {
            ilegiveis.push({ codigoTributo: codigoCru, valor: valorCru, motivo: 'código do tributo ausente ou ilegível' });
            continue;
        }
        if (!Number.isFinite(valorNum) || valorNum < 0) {
            ilegiveis.push({ codigoTributo: codigoCru, valor: valorCru, motivo: 'valor ausente, ilegível ou negativo' });
            continue;
        }
        valores.push({ codigoTributo, valor: round2(valorNum) });
    }
    valores.sort((a, b) => a.codigoTributo - b.codigoTributo);
    return { valores, ilegiveis };
}

function erroIlegiveis(ilegiveis) {
    const lista = ilegiveis
        .map((i) => `tributo ${String(i.codigoTributo ?? '?')} = ${JSON.stringify(i.valor)} (${i.motivo})`)
        .join('; ');
    const err = new Error(
        `SERPRO devolveu valor devido que nao da para ler: ${lista}. `
        + 'Nenhuma declaracao foi transmitida — a soma ficaria a MENOR e a comparacao com a apuracao local nao teria sentido. '
        + 'Repita a validacao ou confira a apuracao no PGDAS-D.'
    );
    err.code = 'PGDAS_VALOR_ILEGIVEL';
    err.httpStatus = 502;
    err.ilegiveis = ilegiveis;
    return err;
}

/** Só os legíveis (contrato antigo) — quem precisa saber o que ficou de fora lê `lerValoresDevidosPgdas`. */
export function normalizarValoresDevidosPgdas(input) {
    return lerValoresDevidosPgdas(input).valores;
}

/** A soma RECUSA enquanto houver item ilegível: parcial aqui vira "total". */
export function somaValoresDevidosPgdas(valoresDevidos) {
    const { valores, ilegiveis } = lerValoresDevidosPgdas(valoresDevidos);
    if (ilegiveis.length) throw erroIlegiveis(ilegiveis);
    return round2(valores.reduce((sum, item) => sum + item.valor, 0));
}

export function montarDadosDeclaracaoPgdas({
    cnpjLimpo,
    pa,
    declaracao,
    transmitir,
    valoresParaComparacao = [],
}) {
    const { valores: valoresComparacao, ilegiveis } = lerValoresDevidosPgdas(valoresParaComparacao);
    // Comparação com um tributo a menos é comparação com outro número — o
    // SERPRO responderia "diverge" (ou, pior, "confere") sobre uma lista que
    // não é a dele.
    if (ilegiveis.length) throw erroIlegiveis(ilegiveis);
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
