// ============================================================================
// sefaz-backend/febraban-barcode.js
// Geração de código de barras FEBRABAN — Arrecadação Governo Federal (DARF).
//
// Layout (44 dígitos, padrão FEBRABAN Convenio 4):
//   pos 1     : ID Produto       = 8 (arrecadação)
//   pos 2     : ID Segmento      = 5 (Governo Federal — RFB)
//   pos 3     : ID Valor Real    = 6 (valor com DV módulo 11)
//                                   ou 8 (sem valor / qtde)
//   pos 4     : DV geral         (módulo 11 sobre os 43 demais)
//   pos 5-15  : Valor (11 dig)   centavos, zero-pad
//   pos 16-19 : Codigo do orgao  = 1825 (Receita Federal)
//   pos 20-33 : CNPJ contribuinte (14 dig)
//   pos 34-39 : Periodo apuração (AAAAMM, 6 dig)
//   pos 40-43 : Codigo receita (4 dig, ex IRPJ Presumido = 2089)
//   pos 44    : Reservado/free   = 0
//
// Ref: FEBRABAN Convênio 4 / Manual Técnico Arrecadação RFB.
// ============================================================================

const ID_PRODUTO_ARRECADACAO = '8';
const ID_SEGMENTO_RFB = '5';
const ID_VALOR_REAL_MOD11 = '6';
const CODIGO_ORGAO_RFB = '1825';

/**
 * DV módulo 11 (padrão arrecadação) — pesos 2..9 da direita pra esquerda.
 * Resto 0, 1 ou 10 → DV = 1.
 */
function dvModulo11(numero) {
    let soma = 0, peso = 2;
    for (let i = numero.length - 1; i >= 0; i--) {
        soma += parseInt(numero[i], 10) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    if (resto === 0 || resto === 1 || resto === 10) return '1';
    return String(11 - resto);
}

/**
 * Monta o código de barras DARF (44 dígitos).
 *
 * @param {object} p
 * @param {string} p.cnpj          - CNPJ do contribuinte (14 dig)
 * @param {string} p.periodo       - AAAAMM (mês/ano apuração)
 * @param {number} p.valor         - valor em reais (decimal)
 * @param {string} p.codigoReceita - 4 dig (ex: '2089')
 * @returns {string} 44 dígitos
 */
export function gerarBarrasDarf({ cnpj, periodo, valor, codigoReceita }) {
    const cnpjLimpo = String(cnpj || '').replace(/\D/g, '').padStart(14, '0').slice(-14);
    const periodoLimpo = String(periodo || '').replace(/\D/g, '').padStart(6, '0').slice(0, 6);
    const codigo = String(codigoReceita || '').replace(/\D/g, '').padStart(4, '0').slice(0, 4);
    const valorCentavos = Math.round((valor || 0) * 100).toString().padStart(11, '0').slice(-11);

    // Monta sem o DV geral (posição 4): 43 chars
    const semDv =
        ID_PRODUTO_ARRECADACAO +
        ID_SEGMENTO_RFB +
        ID_VALOR_REAL_MOD11 +
        valorCentavos +
        CODIGO_ORGAO_RFB +
        cnpjLimpo +
        periodoLimpo +
        codigo +
        '0';

    if (semDv.length !== 43) {
        throw new Error(`Layout invalido: ${semDv.length} dig (esperado 43)`);
    }
    const dv = dvModulo11(semDv);
    return semDv.slice(0, 3) + dv + semDv.slice(3);
}

/**
 * Converte 44 dígitos em linha digitável formatada (5 campos com DV cada).
 * Layout: NNNNN.NNNNN NNNNN.NNNNNN NNNNN.NNNNNN N NNNNNNNNNNN — equivalente
 * ao boleto de arrecadação.
 *
 * Para arrecadação cada campo tem 11 dig + DV módulo 10.
 */
export function gerarLinhaDigitavelArrecadacao(barras44) {
    if (!barras44 || barras44.length !== 44) return barras44;
    // Divide em 4 blocos de 11 dígitos
    const blocos = [
        barras44.slice(0, 11),
        barras44.slice(11, 22),
        barras44.slice(22, 33),
        barras44.slice(33, 44),
    ];
    return blocos.map(b => b + dvModulo10(b)).join(' ');
}

function dvModulo10(numero) {
    let soma = 0, peso = 2;
    for (let i = numero.length - 1; i >= 0; i--) {
        let n = parseInt(numero[i], 10) * peso;
        if (n > 9) n = Math.floor(n / 10) + (n % 10);
        soma += n;
        peso = peso === 2 ? 1 : 2;
    }
    const resto = soma % 10;
    return resto === 0 ? '0' : String(10 - resto);
}
