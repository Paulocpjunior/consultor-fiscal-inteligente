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

/**
 * Alíquotas do PIS/COFINS **do prestador** no regime NÃO-CUMULATIVO. Não são
 * retenção: são o tributo da operação, e a NFS-e paulistana tem campos que os
 * prestadores preenchem com isso.
 *
 * Prova documental (07/08, NFS-e 00375235 — ELEVADORES ATLAS SCHINDLER →
 * CONDOMINIO EDIFICIO MONTE CARLO, base 3.413,24): PIS 56,32 = 1,65% e COFINS
 * 259,41 = 7,60%, com a própria nota dizendo em Outras Informações que "os
 * campos de PIS e COFINS são referentes aos valores TOTAIS sobre a operação".
 * A retenção verdadeira estava em outro campo: 158,72 = 4,65% (a CSRF).
 */
const ALIQ_NAO_CUMULATIVO = { pis: 1.65, cofins: 7.60 };
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
    // ⚠️ PRESENÇA ≠ ZERO no campo da CSRF. Quem chama pode ter colapsado
    // ausência em 0 (`?? 0`) — então a presença viaja SEPARADA. É ela que
    // distingue "o documento DIZ que não houve retenção" de "o documento não
    // trouxe o campo", e essas duas coisas pedem respostas opostas.
    const csrfPresente = n?.csllPresente === true;

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

    // OS CAMPOS SÃO O TRIBUTO DA OPERAÇÃO, NÃO A RETENÇÃO.
    //
    // Assinatura inconfundível: PIS 1,65% + COFINS 7,60% (não-cumulativo). O
    // importador grava esses campos como `pisRetido`/`cofinsRetida` — nome que
    // mente —, e mandá-los ao R-4020 declararia como retido o imposto do
    // PRESTADOR, várias vezes maior que a retenção real.
    if (bate(aliquotas.pis, ALIQ_NAO_CUMULATIVO.pis) && bate(aliquotas.cofins, ALIQ_NAO_CUMULATIVO.cofins)) {
        const temCsrf = bate(aliquotas.csll, ALIQ_CSRF);

        // 🚨 O DOCUMENTO DIZ QUE NÃO HOUVE RETENÇÃO — e o app mandava ajustar
        // à mão (02/09, Paulo na HS PROJETOS · 08/2026, nota 22243 da EMBRATOP
        // GEO: *"puxou uma nota que não tem retenção, mas foi informado errado,
        // como não considerar ela?"*).
        //
        // O PDF da NFS-e paulistana traz, lado a lado:
        //   · PIS/PASEP 2,31 (1,65% de 140) e COFINS 10,64 (7,60%) — as
        //     alíquotas do NÃO-CUMULATIVO, ou seja o tributo da OPERAÇÃO do
        //     prestador, que é o caso ATLAS de 07/08;
        //   · **Contribuições Sociais - Retidas: 0,00**, com a descrição
        //     **"0 - PIS/COFINS/CSLL Não Retidos"**.
        //
        // Os dois sinais concordam, e o campo de contribuições retidas é O
        // campo da retenção neste leiaute (é dele que sai a CSRF de 4,65% no
        // caso ATLAS). Com ele PRESENTE e ZERO, a resposta está no documento:
        // **não houve retenção**. Mandar ajustar à mão aqui é a régua de 24/08
        // ao contrário — quando o app tem como saber a resposta, avisar não é
        // entrega, é passar o problema adiante.
        //
        // ⚠️ E ela só vale com a assinatura da OPERAÇÃO já provada acima: PIS
        // em 0,65% + COFINS em 3% com CSRF zerada seria retenção de verdade com
        // o campo agregado em branco, e concluir "sem retenção" ali declararia
        // a MENOS do que foi retido.
        if (csrfPresente && csll === 0) {
            return {
                situacao: 'sem-retencao-declarada',
                motivo: `PIS em ${aliquotas.pis}% e COFINS em ${aliquotas.cofins}% são o tributo da OPERAÇÃO `
                    + 'do prestador (regime não-cumulativo), e o campo de contribuições sociais RETIDAS do '
                    + 'documento está ZERADO — a própria nota declara "PIS/COFINS/CSLL Não Retidos". '
                    + 'Não há retenção a declarar nesta nota.',
                acao: null,
                aliquotas,
                // Não exige ação: não há o que ajustar numa nota sem retenção.
                exigeAcao: false,
            };
        }

        return {
            situacao: 'campos-sao-totais-da-operacao',
            motivo: `PIS em ${aliquotas.pis}% e COFINS em ${aliquotas.cofins}% são as alíquotas do regime `
                + 'NÃO-CUMULATIVO do prestador — é o tributo da operação, não retenção. A NFS-e paulistana '
                + 'tem campos que muitos prestadores preenchem assim, e a própria nota costuma avisar em '
                + '"Outras Informações".'
                + (temCsrf
                    ? ` A retenção de verdade é o campo de contribuições sociais retidas: ${aliquotas.csll}% da base (CSRF).`
                    : ''),
            acao: temCsrf
                ? 'Use o valor de contribuições sociais retidas (CSRF 4,65%) como retenção, NÃO os campos de '
                  + 'PIS e COFINS. O rateio individual entre PIS, COFINS e CSLL não está no documento — pegue '
                  + 'do XML da nota se precisar declarar separado.'
                : 'Não use PIS e COFINS desta nota como retenção. Confira no documento qual campo traz a '
                  + 'retenção efetiva antes de declarar.',
            aliquotas, exigeAcao: true,
        };
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
        camposDaOperacao: conta('campos-sao-totais-da-operacao'),
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
    if (r.camposDaOperacao > 0) {
        out.push(
            `${r.camposDaOperacao} nota(s) em que os campos de PIS/COFINS são o tributo do PRESTADOR `
            + '(não-cumulativo 1,65% e 7,60%), não retenção. Declarar esses valores como retidos infla a '
            + 'retenção várias vezes — a retenção real é a CSRF de 4,65%.',
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
