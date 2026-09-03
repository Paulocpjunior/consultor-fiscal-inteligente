// ============================================================================
// sefaz-backend/febraban-barcode.js
// Geração de código de barras FEBRABAN — Arrecadação Governo Federal (DARF).
//
// Layout (44 dígitos, padrão FEBRABAN Convenio 4):
//   pos 1     : ID Produto       = 8 (arrecadação)
//   pos 2     : ID Segmento      = 5 (Governo Federal — RFB)
//   pos 3     : ID Valor Real    = 6 (valor efetivo, DV geral módulo 10)
//                                   ou 8 (valor efetivo, DV geral módulo 11)
//   pos 4     : DV geral         (módulo 10, coerente com id=6)
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
// 3º dígito = 6 → valor efetivo em Reais com DV geral por MÓDULO 10.
const ID_VALOR_REAL_MOD10 = '6';
const CODIGO_ORGAO_RFB = '1825';

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
    // 🚨 NADA AQUI ERA CONFERIDO (03/09): valor em TEXTO virava `NaN` DENTRO
    // da barra (`Math.round('1.234,56' * 100)`), `07/2026` virava `072026`
    // (ano 0720) e CNPJ curto era completado com zeros — um código de barras
    // apontando para contribuinte nenhum. Barra é o que o banco lê: campo
    // torto é RECUSA nomeada, nunca zero-pad.
    const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
    if (cnpjLimpo.length !== 14) {
        throw new Error(`CNPJ inválido para o código de barras ("${String(cnpj ?? '')}") — são 14 dígitos.`);
    }
    const periodoLimpo = String(periodo ?? '').trim();
    if (!/^\d{6}$/.test(periodoLimpo) || !(+periodoLimpo.slice(4) >= 1 && +periodoLimpo.slice(4) <= 12)) {
        throw new Error(`Período de apuração inválido para o código de barras ("${String(periodo ?? '')}") — `
            + 'esperado AAAAMM (ex.: 202607). Quem normaliza a competência é o dono (competencia.js), antes daqui.');
    }
    const codigo = String(codigoReceita || '').replace(/\D/g, '');
    if (codigo.length !== 4) {
        throw new Error(`Código de receita inválido para o código de barras ("${String(codigoReceita ?? '')}") — são 4 dígitos.`);
    }
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
        throw new Error(`Valor inválido para o código de barras (${JSON.stringify(valor)}) — informe um número > 0 (em reais).`);
    }
    const valorCentavos = Math.round(valor * 100).toString().padStart(11, '0');
    if (valorCentavos.length !== 11) {
        throw new Error(`Valor ${valor} não cabe nos 11 dígitos do campo de valor do código de barras.`);
    }

    // Monta sem o DV geral (posição 4): 43 chars
    const semDv =
        ID_PRODUTO_ARRECADACAO +
        ID_SEGMENTO_RFB +
        ID_VALOR_REAL_MOD10 +
        valorCentavos +
        CODIGO_ORGAO_RFB +
        cnpjLimpo +
        periodoLimpo +
        codigo +
        '0';

    if (semDv.length !== 43 || !/^\d{43}$/.test(semDv)) {
        throw new Error(`Layout invalido: "${semDv}" (esperado 43 dígitos numéricos antes do DV)`);
    }
    // DV geral por MÓDULO 10 — o 3º dígito é 6 (valor efetivo com DV módulo 10);
    // usar módulo 11 aqui gerava barra que o banco rejeita (achado 09/07/2026).
    // Coerente com gerarLinhaDigitavelArrecadacao, que já usa módulo 10.
    const dv = dvModulo10(semDv);
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
