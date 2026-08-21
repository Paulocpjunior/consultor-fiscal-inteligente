// ============================================================================
// sefaz-backend/saldo-anterior-apuracao.js  (PURO — testável)
// ----------------------------------------------------------------------------
// O SALDO CREDOR QUE VEM DA COMPETÊNCIA ANTERIOR — e, principalmente, DIZER
// quando o arquivo está afirmando ZERO sem ninguém ter conferido.
//
// ═══ POR QUE EXISTE (Paulo, 17/08) ══════════════════════════════════════════
//
// *"Essa empresa possui saldos acumulados de meses anteriores… a apuração não
// está considerando o saldo que já vinha sendo acumulado nas competências
// anteriores."*
//
// Fui ler, e o estado é este — três apurações, três comportamentos diferentes,
// e nenhum deles avisava:
//
//   ICMS próprio (E110 campo 10)   lê `saldoCredorIcms` da ficha da competência
//                                  ANTERIOR. Só que na ficha esse campo é o que
//                                  ENTROU naquele mês, não o que SOBROU dele —
//                                  ou seja, transporta o saldo DEFASADO e
//                                  ignora a movimentação do próprio mês.
//   IPI (E520 VL_SD_ANT_IPI)       o gerador lê `saldoCredorIpiAnterior` e o
//                                  orquestrador NUNCA passava esse campo ⇒ saía
//                                  SEMPRE 0,00. ✅ LIGADO 19/08 (caso PWR): o
//                                  orquestrador passa o `saldoCredorIpi` da
//                                  ficha DESTA competência — que já significa
//                                  "o que entrou neste mês".
//   ICMS-ST (E210 VL_SLD_CRED_ANT_ST)  `apurarStDaUf` aceita `saldoCredorAnterior`
//                                  e ninguém passa ⇒ SEMPRE 0,00.
//
// ⚠️ ZERO NUM CAMPO DE SALDO É UMA AFIRMAÇÃO: o arquivo diz à SEFAZ que não
// havia crédito a transportar. Para quem tem crédito acumulado, isso paga
// imposto que não é devido — e o erro não aparece em lugar nenhum, porque o
// arquivo é aceito.
//
// Este módulo NÃO inventa o saldo (isso seria adivinhar imposto). Ele faz o que
// a casa faz com ausência: **DIZ que declarou zero e por quê**, para a pessoa
// decidir antes de transmitir.
//
// 🚧 A CRONOLOGIA DE VERDADE (saldo de abertura carimbado + transporte
// calculado mês a mês) é desenho à parte, e a fonte dela não é digitação: é o
// **E110 campo 14 (VL_SLD_CREDOR_TRANSPORTAR)** do último SPED entregue, que o
// `spedFiscalParserService` já sabe ler.
// ============================================================================

const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
};

/** Houve movimento de IPI no período? (é o que faz o E500/E520 existir) */
export const temMovimento = (deb, cred) => num(deb) > 0 || num(cred) > 0;

/**
 * Avisos honestos sobre o saldo anterior de cada apuração.
 *
 * @param {object} p
 * @param {number} [p.icmsAnterior]     o que foi para o E110 campo 10
 * @param {string} [p.origemIcms]       de onde ele veio ('ficha-anterior' | '')
 * @param {number} [p.ipiAnterior]      o que foi para o E520 VL_SD_ANT_IPI
 * @param {string} [p.origemIpi]        de onde ele veio
 * @param {boolean} [p.geraIpi]         o bloco E500/E520 vai sair?
 * @param {boolean} [p.geraSt]          o bloco E200/E210 vai sair?
 * @returns {string[]}
 */
export function avisosDeSaldoAnterior({ icmsAnterior = 0, origemIcms = '', ipiAnterior = 0, origemIpi = '', geraIpi = false, geraSt = false } = {}) {
    const avisos = [];

    // 🧮 A CRONOLOGIA EXISTE DESDE 21/08: quando a origem é a abertura
    // carimbada (SPED entregue) + transporte calculado, o aviso NÃO pode mais
    // dizer "o CFI não calcula o transporte" — aviso desatualizado é o farol
    // mentindo na direção oposta. A origem é quem distingue.
    const daCronologia = (origem) => /abertura|cronologia|SPED ENTREGUE/i.test(String(origem || ''));

    if (num(icmsAnterior) > 0 && daCronologia(origemIcms)) {
        avisos.push(
            `Saldo credor de ICMS do período anterior: ${num(icmsAnterior).toFixed(2)} — CALCULADO pela `
            + `cronologia (${origemIcms}). A ficha não foi usada neste campo.`,
        );
    } else if (num(icmsAnterior) > 0) {
        // Número que veio de outro lugar sai CARIMBADO com a origem — quem
        // confere precisa saber onde ele foi digitado para poder discordar.
        avisos.push(
            `Saldo credor de ICMS do período anterior: ${num(icmsAnterior).toFixed(2)} `
            + `(origem: ${origemIcms || 'não registrada'}). O CFI não calculou o transporte — `
            + 'este valor é o campo "Saldo Credor ICMS (Mês Anterior)" da ficha da competência anterior, '
            + 'não o saldo que sobrou dela. Para a cronologia de verdade, cole o último SPED ENTREGUE na '
            + 'aba 🧮 Saldo de abertura do card SPED.',
        );
    } else {
        avisos.push(
            'O E110 está declarando saldo credor anterior de ICMS = 0,00. Isso é uma AFIRMAÇÃO à SEFAZ, não '
            + 'uma omissão: se esta empresa tem crédito acumulado de competências anteriores, o arquivo está '
            + 'recolhendo a MAIOR. Lance o saldo na ficha da competência anterior antes de transmitir.',
        );
    }

    if (geraIpi && num(ipiAnterior) > 0 && daCronologia(origemIpi)) {
        avisos.push(
            `Saldo credor de IPI do período anterior: ${num(ipiAnterior).toFixed(2)} — CALCULADO pela `
            + `cronologia (${origemIpi}).`,
        );
    } else if (geraIpi && num(ipiAnterior) > 0) {
        // Ligado em 19/08 (caso PWR 07/2026): o valor sai do campo "Cred. IPI
        // do mês anterior" da ficha DESTA competência — na ficha, esse campo
        // já é "o que entrou neste mês", exatamente o VL_SD_ANT_IPI.
        avisos.push(
            `Saldo credor de IPI do período anterior: ${num(ipiAnterior).toFixed(2)} `
            + `(origem: ${origemIpi || 'não registrada'}). O valor foi digitado na ficha, não calculado — `
            + 'confira contra o VL_SC_IPI do E520 do último SPED entregue, ou cole-o na aba 🧮 Saldo de '
            + 'abertura para o transporte passar a ser calculado.',
        );
    } else if (geraIpi) {
        avisos.push(
            'O E520 está declarando saldo credor anterior de IPI = 0,00. Isso é uma AFIRMAÇÃO à SEFAZ: '
            + 'empresa com crédito de IPI acumulado recolhe a MAIOR. O valor sai do campo "Cred. IPI do mês '
            + 'anterior (compensado)" da ficha desta competência — lance-o lá antes de transmitir.',
        );
    }

    if (geraSt) {
        avisos.push(
            'O E210 está declarando saldo credor anterior de ICMS-ST = 0,00 — o CFI ainda não transporta saldo '
            + 'de ST entre competências. A apuração de ST é PRÓPRIA e por UF de destino: o saldo de uma UF não '
            + 'abate o de outra, nem o do ICMS próprio.',
        );
    }

    return avisos;
}
