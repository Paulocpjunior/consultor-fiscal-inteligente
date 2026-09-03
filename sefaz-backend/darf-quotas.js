// ============================================================================
// darf-quotas.js  (PURO — sem Express, sem Firebase, sem rede)
// ----------------------------------------------------------------------------
// AS QUOTAS DO IRPJ/CSLL TRIMESTRAL — e por que elas NÃO se emitem de uma vez.
//
// Paulo, 13/08: *"as cotas devem ser enviadas todos os meses pois sofrem
// atualização da SELIC"*. Ele está certo, e o que o app fazia era o contrário:
// escolhia "3 quotas" e emitia AS TRÊS no mesmo clique, hoje.
//
// ═══ POR QUE ISSO SAI A MENOR (Lei 9.430/96 art. 5º §3º) ════════════════════
//
// O acréscimo de cada quota é *"juros equivalentes à taxa SELIC, acumulada
// mensalmente, calculados a partir do primeiro dia do segundo mês subsequente
// ao do encerramento do período de apuração até o último dia do mês ANTERIOR ao
// do pagamento, e de 1% no mês do pagamento"*. Ou seja:
//
//   quota 1 — vence no 1º mês seguinte ao trimestre: SEM acréscimo
//   quota 2 — vence no 2º mês: 1% (nenhum mês completo de SELIC ainda)
//   quota 3 — vence no 3º mês: SELIC do 2º mês + 1%
//
// A SELIC do 2º mês só é DIVULGADA no começo do 3º. Gerar a quota 3 hoje é
// pedir ao SICALC um número que ainda não existe — ele calcula com o que tem, e
// a guia sai **a menor**. Guia a menor não avisa: o cliente paga, fica com
// débito residual e a diferença só aparece depois, com multa.
//
// ═══ A RÉGUA, E POR QUE ELA É UNIFORME ══════════════════════════════════════
//
// **Cada quota se emite no MÊS DO VENCIMENTO dela.** Poderia haver exceção — a
// quota 2 é 1% fixo e daria pra emitir antes —, mas régua com exceção sutil é
// régua que ninguém lembra na hora. Mata-burro é barreira física, não regra
// para decorar: uma frase só, sem caso especial.
//
// E isso resolve junto o outro pedido do Paulo: se a quota só nasce no mês
// dela, ela naturalmente é ENVIADA no mês dela.
// ============================================================================

// O último dia útil vem do calendário da casa — escrever "recua sábado e
// domingo" aqui seria a segunda cópia de uma régua de PRAZO, e prazo com duas
// contas produz duas datas para a mesma quota (foi o que aconteceu com o FGTS
// em 11/08, um catálogo antecipando e o outro prorrogando).
import { calcularUltimoDiaUtil } from './calendario-obrigacoes.js';

/** Nenhuma quota abaixo de R$ 1.000 (Lei 9.430/96 art. 5º §1º). */
export const QUOTA_VALOR_MINIMO = 1000;

/** Códigos de receita do IRPJ/CSLL trimestral que aceitam quota. */
export const RECEITAS_TRIMESTRAIS_QUOTA = new Set(['2089', '0220', '2372', '6012']);

// Só para INTEIROS de contagem (nº de quotas, cota, ano, mês) — nunca para o
// VALOR: `Number(v) || 0` transformava débito ilegível em plano de R$ 0,00,
// calado (03/09). Valor passa por `valorOuErro`.
const num = (v) => Number(v) || 0;

/**
 * 🚨 CAMPO DE VALOR NÃO RECEBE DEFAULT. Débito que chega `undefined`, `NaN`
 * ou texto ilegível virava plano de quotas de R$ 0,00 — e um plano de zero
 * não avisa ninguém. Recusa nomeada.
 */
function valorOuErro(valor) {
    const v = typeof valor === 'number' ? valor : Number(valor);
    if (!Number.isFinite(v) || v <= 0) {
        throw new Error(`Valor do débito inválido (${JSON.stringify(valor)}) — sem ele não há quota a planejar.`);
    }
    return v;
}

/**
 * Divide o débito em N quotas "iguais" em centavos — a 1ª absorve a diferença
 * de arredondamento (prática RFB). A soma SEMPRE fecha com o total.
 */
export function dividirEmQuotas(valor, n) {
    const totalCent = Math.round(valorOuErro(valor) * 100);
    const partes = Math.max(1, Math.floor(num(n)) || 1);
    const base = Math.floor(totalCent / partes);
    const primeira = totalCent - base * (partes - 1);
    return Array.from({ length: partes }, (_, i) => (i === 0 ? primeira : base) / 100);
}

/** Ano/mês em que a quota `cota` (1..3) do trimestre da competência vence. */
export function mesDaQuota(anoPA, mesPA, cota) {
    const trimestre = Math.floor((num(mesPA) - 1) / 3) + 1;
    let mes = trimestre * 3 + num(cota);
    let ano = num(anoPA);
    while (mes > 12) { mes -= 12; ano += 1; }
    return { ano, mes };
}

/** Vencimento da quota: último dia útil do i-ésimo mês após o trimestre. */
export function vencimentoQuotaTrimestral(anoPA, mesPA, cota) {
    const { ano, mes } = mesDaQuota(anoPA, mesPA, cota);
    return calcularUltimoDiaUtil(ano, mes);
}

/** 'AAAA-MM-DD' → chave comparável AAAAMM (NaN quando a data não é legível). */
const chaveMes = (iso) => {
    const m = /^(\d{4})-(\d{2})/.exec(String(iso ?? ''));
    return m ? Number(m[1]) * 100 + Number(m[2]) : NaN;
};

/**
 * O PLANO das quotas de UM débito: o que se emite hoje e o que espera o mês.
 *
 * @param {object} p
 * @param {number} p.valor      valor total do débito
 * @param {number} p.anoPA
 * @param {number} p.mesPA
 * @param {number} p.quotas     1..3 (escolha do cliente)
 * @param {string} p.hoje       'AAAA-MM-DD' — a data é PARÂMETRO, nunca `new Date()`
 *                              aqui dentro: núcleo que lê o relógio não se testa.
 * @param {boolean} [p.aceitaQuota]  o código de receita comporta quota
 */
export function planejarQuotas({ valor, anoPA, mesPA, quotas = 1, hoje, aceitaQuota = true } = {}) {
    const pedidas = Math.min(3, Math.max(1, Math.floor(num(quotas)) || 1));
    const total = valorOuErro(valor);
    // 🚨 `hoje` AUSENTE OU ILEGÍVEL FAZIA TODA QUOTA SAIR AGORA (03/09):
    // `chaveMes(undefined)` era NaN, `mesDaCota > NaN` é false, e o `return`
    // de baixo carimbava `emitirAgora: true` nas três — exatamente o defeito
    // que este módulo existe para impedir. A data é PARÂMETRO, e parâmetro
    // torto é RECUSA, não plano.
    const mesDeHoje = chaveMes(hoje);
    if (!Number.isFinite(mesDeHoje)) {
        throw new Error(`Data de hoje inválida (${JSON.stringify(hoje)}) — esperado AAAA-MM-DD. `
            + 'Sem ela não dá para saber qual cota já pode sair, e chutar emitiria as três de uma vez.');
    }

    let efetivas = 1;
    let aviso = null;
    if (pedidas > 1 && !aceitaQuota) {
        aviso = 'Esta receita não é IRPJ/CSLL trimestral — cota só existe para o trimestral (Lei 9.430 art. 5º). '
            + 'Emitida em cota única.';
    } else if (pedidas > 1 && total / pedidas < QUOTA_VALOR_MINIMO) {
        aviso = `Valor não comporta ${pedidas} cotas (mínimo R$ 1.000,00 por cota, Lei 9.430 art. 5º §1º) — `
            + 'emitido em cota única.';
    } else if (pedidas > 1) {
        efetivas = pedidas;
    }

    const valores = dividirEmQuotas(total, efetivas);

    const linhas = valores.map((v, i) => {
        const cota = i + 1;
        const vencimento = vencimentoQuotaTrimestral(anoPA, mesPA, cota);
        const mesDaCota = chaveMes(vencimento);
        // Quota única não tem "mês da quota": ela é o vencimento normal do
        // tributo e sai agora, como sempre saiu.
        if (efetivas === 1) {
            return { cota: null, totalCotas: null, valorPrincipal: v, vencimento: null, emitirAgora: true, motivo: null };
        }
        if (mesDaCota > mesDeHoje) {
            return {
                cota, totalCotas: efetivas, valorPrincipal: v, vencimento,
                emitirAgora: false,
                // A causa vai JUNTO — "não emitiu" sem motivo faz a pessoa
                // procurar defeito onde há regra.
                motivo: `A cota ${cota} vence em ${vencimento} e o acréscimo dela (SELIC acumulada até o mês `
                    + 'anterior ao pagamento + 1%, Lei 9.430 art. 5º §3º) ainda não existe hoje. Emitir agora sai '
                    + 'A MENOR, e guia a menor não avisa: o cliente paga e fica com débito residual.',
            };
        }
        return {
            cota, totalCotas: efetivas, valorPrincipal: v, vencimento, emitirAgora: true,
            motivo: mesDaCota < mesDeHoje
                ? `Cota ${cota} vencida em ${vencimento} — o SICALC calcula os acréscimos até a data do pagamento.`
                : null,
        };
    });

    return {
        quotasEfetivas: efetivas,
        aviso,
        linhas,
        agora: linhas.filter((l) => l.emitirAgora),
        depois: linhas.filter((l) => !l.emitirAgora),
    };
}

/**
 * O que a tela diz depois de emitir. Uma frase, com a data da próxima — porque
 * "emitido em 3 quotas" com uma guia só na mão é o que faz alguém achar que
 * faltou guia (ou pior: que já mandou tudo ao cliente).
 */
export function resumoDoPlano(plano) {
    if (!plano || plano.quotasEfetivas <= 1) return null;
    const faltam = plano.depois || [];
    if (!faltam.length) return `Todas as ${plano.quotasEfetivas} cotas já podiam ser emitidas neste mês.`;
    const proxima = faltam[0];
    return `Cota ${plano.agora.length ? plano.agora[plano.agora.length - 1].cota : 0} de ${plano.quotasEfetivas} emitida. `
        + `A próxima (${proxima.cota}) pode ser gerada a partir de 01/${String(proxima.vencimento).slice(5, 7)}/`
        + `${String(proxima.vencimento).slice(0, 4)} — vence em ${String(proxima.vencimento).slice(8, 10)}/`
        + `${String(proxima.vencimento).slice(5, 7)}, então há o mês inteiro para enviar ao cliente. Antes disso o `
        + 'juro dela ainda não existe. Ela fica agendada e aparece em "Cotas do mês".';
}
