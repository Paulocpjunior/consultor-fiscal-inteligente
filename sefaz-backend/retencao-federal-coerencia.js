// ============================================================================
// sefaz-backend/retencao-federal-coerencia.js  (PURO — testável)
// ----------------------------------------------------------------------------
// A RETENÇÃO FEDERAL TEM ASSINATURA DE ALÍQUOTA — e é ela que denuncia o campo
// trocado, sem precisar de arquivo novo.
//
// ACHADO 07/08 (arquivo real do Paulo × print do IOB): a coluna 59 do export
// de NFS-e do portal de SP, rotulada "CSLL", NÃO é a CSLL. Na nota da CLINIPAR
// (base 590,10) ela vale 27,44 — que é PIS 3,84 + COFINS 17,70 + CSLL 5,90, o
// TOTAL das retenções federais. A CSLL verdadeira não aparece em coluna
// nenhuma. O importer grava `valorCsll` a partir dela.
//
// A pergunta "isso vale também pro export em CSV?" NÃO precisa de outro
// arquivo: as alíquotas são fixas em lei (IN RFB 1.234/2012 e Lei 10.833/2003
// art. 30) e formam uma assinatura que o próprio dado carrega:
//
//     PIS/PASEP  0,65%      COFINS  3,00%      CSLL  1,00%
//     CSRF (as três juntas, código de receita 5952)  =  4,65%
//
// Então: se o campo CSLL bate 4,65% da base enquanto PIS bate 0,65% e COFINS
// bate 3,00%, aquele campo é o TOTAL — e a CSLL está contada DUAS VEZES.
//
// REGRA QUE MANDA AQUI: isto ACUSA, não conserta. Não dá pra deduzir a CSLL
// verdadeira dividindo o total, porque a nota pode ter retenção parcial,
// dispensa por valor mínimo ou só uma das três contribuições. Ausente ≠ zero,
// e "provavelmente é X" não entra em declaração — é a regra do ALERTA, NUNCA
// CONTORNO.
// ============================================================================

const ALIQ = { pis: 0.65, cofins: 3.00, csll: 1.00 };
/** CSRF — as três contribuições num código só (5952). */
export const ALIQ_CSRF = ALIQ.pis + ALIQ.cofins + ALIQ.csll; // 4,65

/** Tolerância em pontos percentuais. Centavo arredondado não é divergência. */
const TOL = 0.06;

const num = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};

/** Alíquota efetiva em %, ou null quando não há base pra dividir. */
export function aliquotaEfetiva(valor, base) {
    const v = num(valor);
    const b = num(base);
    if (v === undefined || !b) return null;
    return Math.round((v / b) * 10000) / 100;
}

const bate = (aliq, alvo) => aliq !== null && Math.abs(aliq - alvo) <= TOL;

/**
 * Diagnóstico das retenções federais de UMA nota.
 *
 * @param {object} n { base, pis, cofins, csll, ir, inss }
 * @returns {{situacao, motivo, acao, aliquotas, exigeAcao}}
 */
export function conferirRetencaoFederal(n) {
    const base = num(n?.base);
    const pis = num(n?.pis);
    const cofins = num(n?.cofins);
    const csll = num(n?.csll);

    const aliquotas = {
        pis: aliquotaEfetiva(pis, base),
        cofins: aliquotaEfetiva(cofins, base),
        csll: aliquotaEfetiva(csll, base),
    };

    if (!base) {
        return {
            situacao: 'sem-base',
            motivo: 'Nota sem base de cálculo — não dá pra conferir alíquota nenhuma.',
            acao: null, aliquotas, exigeAcao: false,
        };
    }
    // Nenhuma retenção: caso normal (a maioria das notas não tem).
    if (!pis && !cofins && !csll) {
        return { situacao: 'sem-retencao', motivo: 'Sem retenção federal nesta nota.', acao: null, aliquotas, exigeAcao: false };
    }

    // A ASSINATURA DO CAMPO TROCADO: CSLL no lugar do total da CSRF.
    if (bate(aliquotas.csll, ALIQ_CSRF) && bate(aliquotas.pis, ALIQ.pis) && bate(aliquotas.cofins, ALIQ.cofins)) {
        return {
            situacao: 'csll-e-o-total',
            motivo: `O campo CSLL está em ${aliquotas.csll}% da base — que é a CSRF INTEIRA (${ALIQ_CSRF}%), `
                + `com PIS e COFINS já contados à parte. A CSLL de verdade seria ${ALIQ.csll}%.`,
            acao: 'Não use este valor como CSLL: ele é o total das três contribuições e, somado a PIS e COFINS, '
                + 'conta tudo em dobro. A CSLL individual não vem neste export — pegue do XML da nota ou do '
                + 'texto da discriminação, onde alguns prestadores a informam.',
            aliquotas, exigeAcao: true,
        };
    }

    // Soma bate com o campo CSLL: mesma doença, mesmo sem as alíquotas cheias
    // (retenção parcial, base com dedução).
    if (csll && pis !== undefined && cofins !== undefined && pis + cofins > 0) {
        const somaTres = pis + cofins + (base * ALIQ.csll) / 100;
        if (Math.abs(csll - somaTres) <= Math.max(0.02, base * 0.0002)) {
            return {
                situacao: 'csll-e-o-total',
                motivo: `O campo CSLL (${csll}) é igual a PIS + COFINS + 1% da base — ou seja, o total das três.`,
                acao: 'Não use como CSLL: soma em dobro. A CSLL individual não vem neste export.',
                aliquotas, exigeAcao: true,
            };
        }
    }

    const fora = [];
    if (pis && !bate(aliquotas.pis, ALIQ.pis)) fora.push(`PIS ${aliquotas.pis}% (esperado ${ALIQ.pis}%)`);
    if (cofins && !bate(aliquotas.cofins, ALIQ.cofins)) fora.push(`COFINS ${aliquotas.cofins}% (esperado ${ALIQ.cofins}%)`);
    if (csll && !bate(aliquotas.csll, ALIQ.csll)) fora.push(`CSLL ${aliquotas.csll}% (esperado ${ALIQ.csll}%)`);

    if (fora.length) {
        return {
            situacao: 'aliquota-fora',
            motivo: `Retenção fora da alíquota legal: ${fora.join(' · ')}.`,
            acao: 'Confira a nota: pode ser base com dedução, retenção parcial, ou valor digitado errado. '
                + 'Retenção errada vai para a declaração e para o DARF.',
            aliquotas, exigeAcao: true,
        };
    }

    return {
        situacao: 'coerente',
        motivo: 'Retenções batem com as alíquotas legais (PIS 0,65% · COFINS 3% · CSLL 1%).',
        acao: null, aliquotas, exigeAcao: false,
    };
}

/**
 * Varredura de um conjunto de notas — é ela que responde, SEM arquivo novo,
 * se o campo trocado atinge o que já está gravado.
 */
export function varrerRetencaoFederal(notas) {
    const linhas = [];
    for (const n of notas || []) {
        const r = conferirRetencaoFederal(n);
        if (r.situacao === 'sem-base' || r.situacao === 'sem-retencao' || r.situacao === 'coerente') continue;
        linhas.push({ ...n, ...r });
    }
    const conta = (s) => linhas.filter((l) => l.situacao === s).length;
    const resumo = {
        analisadas: (notas || []).length,
        comProblema: linhas.length,
        csllEhOTotal: conta('csll-e-o-total'),
        aliquotaFora: conta('aliquota-fora'),
    };
    return { linhas, resumo, avisos: avisos(resumo) };
}

function avisos(r) {
    const out = [];
    if (r.csllEhOTotal > 0) {
        out.push(
            `🚨 ${r.csllEhOTotal} nota(s) com a CSLL igual ao TOTAL das três contribuições (CSRF ${ALIQ_CSRF}%). `
            + 'Somada a PIS e COFINS, a retenção está contada em dobro — e é isso que iria para a declaração. '
            + 'O valor individual da CSLL não vem no export do portal.',
        );
    }
    if (r.aliquotaFora > 0) {
        out.push(
            `${r.aliquotaFora} nota(s) com retenção fora da alíquota legal — confira antes de declarar.`,
        );
    }
    if (r.analisadas > 0 && r.comProblema === 0) {
        out.push('Nenhuma incoerência de retenção federal nas notas analisadas.');
    }
    return out;
}
