// ============================================================================
// sefaz-backend/receita-aplicacao-financeira.js  (PURO — testável)
//
// A RECEITA DE APLICAÇÃO FINANCEIRA no EFD-Contribuições — a TERCEIRA fonte de
// receita que não tem documento fiscal.
//
// ═══ POR QUE EXISTE (Paulo, 24/08, CF BANK 1109) ════════════════════════════
//
// *"MAIS UMA EMPRESA COM PARTICULARIDADES QUE DEVEM SER GRAVADAS, 1109 - CF
// BANK, o EFD dela é pela APLICAÇÃO FINANCEIRA … e o código da receita dela de
// PIS/COFINS é diferente também"*.
//
// A CHRISTIAN FAMILY INSTITUIÇÃO DE PAGAMENTO S.A. não fatura por documento:
// a receita dela é RENDIMENTO FINANCEIRO. O arquivo de 07/2026 saiu com
// **M200 e M600 ZERADOS** — a mesma classe do M200 zerado da MANTOAN e da
// AFFITTARE: o app monta o arquivo a partir dos DOCUMENTOS, e aqui não há
// nenhum. Zero num campo de contribuição é uma AFIRMAÇÃO à Receita.
//
// ═══ O GABARITO É O EFD ASSINADO DA PRÓPRIA EMPRESA (06/2026) ═══════════════
//
//   |0110|1|1|1||                        ← não-cumulativo, IND_REG_CUM VAZIO
//   |F100|1|||30062026|21647,53|02|21647,53|0,65|140,71|02|21647,53|4|865,9|||30106030012|||
//   |M200|140,71|0|0|140,71|0|0|140,71|0|0|0|0|140,71|
//   |M205|08|457401|140,71|
//   |M210|02|21647,53|21647,53|0|0|21647,53|0,65|0||140,71|0|0|0|0|140,71|
//   |M605|08|798701|865,9|
//   |M610|02|21647,53|21647,53|0|0|21647,53|4|0||865,9|0|0|0|0|865,9|
//
// ═══ AS QUATRO PARTICULARIDADES, E DE ONDE CADA UMA VEM ═════════════════════
//
// 1. **ALÍQUOTAS 0,65% e 4%** — e elas NÃO são novidade: o app já as conhece
//    (`ALIQ_PIS_APLICACAO`/`ALIQ_COFINS_APLICACAO` do `lucroService`, que é
//    quem calcula a GUIA). O defeito era o SPED não as ler. Este módulo passa a
//    ser o DONO das duas, e a ficha importa daqui — guia e arquivo declarando
//    números diferentes para o mesmo fato é o defeito que esta casa mais paga.
//    Conferem centavo a centavo com o assinado: 21.647,53 × 0,65% = 140,71 e
//    × 4% = 865,90.
//
// 2. **CST 02** — "operação tributável a alíquota DIFERENCIADA". É o que o
//    assinado traz no F100, e é coerente com o item 1: alíquota fora da básica.
//
// 3. **COD_CONT 02** no M210/M610 (Tabela 4.3.5) — "contribuição apurada a
//    alíquota diferenciada", ao lado do 01 (não-cumulativo básico) e do 51
//    (cumulativo) que a casa já usa.
//
// 4. **CÓDIGOS DE RECEITA 4574 (PIS) e 7987 (COFINS)**, com NUM_CAMPO **08**
//    (contribuição NÃO-cumulativa a recolher — o cumulativo é o 12 que a PWR
//    provou). ⚠️ **Eles vêm do arquivo assinado, não da minha memória**, e é a
//    mesma disciplina do 810902/217201 da PWR e do código 9 do ISS fixo.
//
// ⚠️ **O QUE ESTES CÓDIGOS NÃO SÃO**: o código de receita do regime
// não-cumulativo COMUM. Eles são da apuração a alíquota DIFERENCIADA, e
// reaproveitá-los para toda empresa do Lucro Real declararia o débito na
// receita errada da DCTF. O aviso do não-cumulativo comum continua de pé.
// ============================================================================

export const FONTE_APLICACAO_FINANCEIRA = 'EFD-Contribuições ASSINADO da CHRISTIAN FAMILY '
    + 'INSTITUIÇÃO DE PAGAMENTO S.A. 38406148000101 · 06/2026 '
    + '(|F100|1|||30062026|21647,53|02|…|4|865,9| · |M205|08|457401| · |M605|08|798701| · '
    + '|M210|02|…| · |M610|02|…|) + decisão do Paulo em 24/08: "o EFD dela é pela aplicação financeira".';

/**
 * Alíquotas da receita de APLICAÇÃO FINANCEIRA.
 *
 * ⚠️ DONO ÚNICO: `services/lucroService.ts` (que calcula a GUIA) importa daqui.
 * Duas cópias fariam a guia e o SPED declararem números diferentes sobre o
 * mesmo rendimento — e ninguém confere valor a olho.
 */
export const ALIQUOTAS_APLICACAO_FINANCEIRA = Object.freeze({ pis: 0.0065, cofins: 0.04 });

/** CST do F100 — tributável a alíquota DIFERENCIADA (assinado do CF BANK). */
export const CST_APLICACAO_FINANCEIRA = '02';

/** COD_CONT do M210/M610 — apuração a alíquota diferenciada (Tabela 4.3.5). */
export const COD_CONT_APLICACAO_FINANCEIRA = '02';

/**
 * Códigos de receita do M205/M605 para a apuração a alíquota DIFERENCIADA.
 * NUM_CAMPO 08 = contribuição NÃO-cumulativa a recolher (o cumulativo é o 12).
 * ⚠️ Só valem para esta apuração — ver o aviso no topo do módulo.
 */
export const CODIGOS_RECEITA_APLICACAO_FINANCEIRA = Object.freeze({
    numCampo: '08', pis: '457401', cofins: '798701',
});

const n = (v) => {
    const x = parseFloat(v || 0);
    return Number.isFinite(x) ? x : 0;
};

/**
 * A receita de APLICAÇÃO FINANCEIRA da competência.
 *
 * ⚠️ A ARMADILHA DAS DUAS FORMAS já mordeu nesta MESMA classe (21/08,
 * AFFITTARE: a régua lia `faturamentoLocacao`, do INPUT, e a ficha GRAVADA usa
 * `faturamentoMesLocacao`). Aqui o campo tem o mesmo nome nas duas formas
 * (`receitaFinanceira`), mas a leitura passa pelas duas assim mesmo — assumir
 * que desta vez é igual é como a última custou.
 */
export function receitaFinanceiraDaFicha(ficha) {
    if (!ficha) return 0;
    const v = n(ficha.receitaFinanceira) || n(ficha.receitaAplicacaoFinanceira);
    return Math.max(0, v);
}

/**
 * Contribuição da receita financeira — o F100 e a linha do bloco M saem daqui.
 *
 * ⚠️ Devolve VALORES, não a linha pronta: igual ao `montarF550`/`montarF100`.
 * Formatar aqui criaria uma segunda forma do mesmo número.
 *
 * @returns {{receita:number, pis:number, cofins:number, cst:string,
 *   aliqPis:number, aliqCofins:number}|null} `null` sem receita — bloco sem
 *   dados não se inventa.
 */
export function montarReceitaFinanceira({ receita } = {}) {
    const rec = n(receita);
    if (!(rec > 0)) return null;
    const { pis: aliqPis, cofins: aliqCofins } = ALIQUOTAS_APLICACAO_FINANCEIRA;
    return {
        receita: rec,
        pis: Math.round(rec * aliqPis * 100) / 100,
        cofins: Math.round(rec * aliqCofins * 100) / 100,
        cst: CST_APLICACAO_FINANCEIRA,
        aliqPis,
        aliqCofins,
    };
}
