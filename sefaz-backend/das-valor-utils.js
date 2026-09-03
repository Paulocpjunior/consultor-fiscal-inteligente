// ============================================================================
// das-valor-utils.js
// Normalizacao segura de valores de guia DAS vindos da UI/API — e o DONO, no
// backend, da pergunta "que número a pessoa digitou?".
//
// ═══ UMA RÉGUA PARA TEXTO DE DINHEIRO (03/09) ═══════════════════════════════
//
// Havia DUAS respostas para o mesmo texto: `parseValorDas('10.500')` lia
// **10,50** (ponto = decimal) e `numeroDeTexto('10.500')` do SPED lia
// **10.500,00** (ponto = milhar). Dois leitores, dois valores para a MESMA
// guia — e a divergência aparece na hora errada: um DARF pedindo R$ 10,50
// sobre um débito de R$ 10.500,00, calado.
//
// A régua adotada é a de `services/valorDigitado.ts` (`parseValorMoeda`), que
// é quem lê o que a PESSOA digita no frontend — espelhada aqui palavra por
// palavra, porque o backend não importa TypeScript:
//   · vírgula presente ⇒ pt-BR: pontos são milhar, vírgula é decimal
//     ("1.234,56" → 1234.56 · "10,5" → 10.5);
//   · sem vírgula, UM ponto seguido de 1-2 dígitos ⇒ decimal JS
//     ("1234.56" → 1234.56, como sai de export de sistema);
//   · sem vírgula, ponto seguido de 3 dígitos ⇒ MILHAR ("10.500" → 10500 —
//     é a forma que o e-Fiscal imprime quando o valor é redondo; em pt-BR
//     ninguém escreve dez reais e cinquenta como "10.500");
//   · ilegível, negativo ou não finito ⇒ **null** — campo de valor nunca
//     recebe número inventado nem zero de conveniência.
//
// `parseValorDas` continua devolvendo 0 no ilegível porque o contrato dele é
// alimentar `assertValorMinimoDas` ("Valor mínimo R$ 10,00") — a recusa ali é
// nomeada de outro jeito. O que mudou é a LEITURA, que passou a ser uma só.
// ============================================================================

/**
 * O dono da leitura: texto (ou número) de dinheiro → número com 2 casas, ou
 * **null** quando não dá para afirmar o valor. Espelho de `parseValorMoeda`.
 *
 * @param {unknown} v
 * @returns {number|null}
 */
export function dinheiroDeEntrada(v) {
    if (typeof v === 'number') {
        if (!Number.isFinite(v) || v < 0) return null;
        return Math.round(v * 100) / 100;
    }
    const t = String(v ?? '').trim().replace(/^R\$\s*/i, '');
    if (!t) return null;
    if (!/^[\d.,\s]+$/.test(t)) return null;
    const s = t.replace(/\s/g, '');

    let normalizado;
    if (s.includes(',')) {
        // Vírgula presente ⇒ forma pt-BR: pontos são milhar, vírgula é decimal.
        normalizado = s.replace(/\./g, '').replace(',', '.');
    } else {
        const pontos = (s.match(/\./g) || []).length;
        const m = /^(\d+)\.(\d{1,2})$/.exec(s);
        if (pontos === 1 && m) {
            // Um ponto com 1-2 casas no fim ⇒ decimal JS ("3241688.71").
            normalizado = s;
        } else {
            // "1.234" / "10.500" / "1.234.567" ⇒ pontos de milhar.
            normalizado = s.replace(/\./g, '');
        }
    }
    const n = Number(normalizado);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
}

export function parseValorDas(value) {
    return dinheiroDeEntrada(value) ?? 0;
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
