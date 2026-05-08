// ============================================================================
// sefaz-backend/sped-fiscal-blocoE.js
// Bloco E minimo viavel — Apuracao do ICMS e do IPI.
//
// Esta versao gera apuracao zerada (E110/E200/E210 com todos os valores 0,00).
// Suficiente pra passar o validador PVA quando a empresa nao tem ICMS/IPI a
// apurar no periodo (Simples Nacional, ou empresa sem operacoes tributadas).
//
// Apuracao real (calculo de debitos/creditos consolidados) fica pra Fase 3.
//
// Registros (5 ao todo):
//   E001|0|       — Abertura, COM dados
//   E100|...|     — Periodo da apuracao ICMS
//   E110|...|     — Apuracao ICMS (14 valores zerados)
//   E990|N|       — Encerramento
//
// Layout: Guia Pratico 3.2.0 / Leiaute 020.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';

const ZERO = '0,00';

/**
 * @param {object} dados
 * @param {string} dados.competenciaInicio - YYYY-MM
 * @param {string} dados.competenciaFim - YYYY-MM
 * @returns {string[]}
 */
export function buildBlocoE(dados) {
    const linhas = [];

    // E001 — Abertura. 0 = Bloco com dados (vamos gerar E100/E110)
    linhas.push(fmt.buildLine(['E001', '0']));

    // E100 — Periodo da apuracao do ICMS
    // Campos: REG, DT_INI, DT_FIN
    linhas.push(fmt.buildLine([
        'E100',
        fmt.formatCompetenciaInicio(dados.competenciaInicio),
        fmt.formatCompetenciaFim(dados.competenciaFim),
    ]));

    // E110 — Apuracao do ICMS — Operacoes Proprias
    // Campos (15): REG + 14 valores
    linhas.push(fmt.buildLine([
        'E110',
        ZERO,  // VL_TOT_DEBITOS
        ZERO,  // VL_AJ_DEBITOS
        ZERO,  // VL_TOT_AJ_DEBITOS
        ZERO,  // VL_ESTORNOS_CRED
        ZERO,  // VL_TOT_CREDITOS
        ZERO,  // VL_AJ_CREDITOS
        ZERO,  // VL_TOT_AJ_CREDITOS
        ZERO,  // VL_ESTORNOS_DEB
        ZERO,  // VL_SLD_CREDOR_ANT
        ZERO,  // VL_SLD_APURADO
        ZERO,  // VL_TOT_DED
        ZERO,  // VL_ICMS_RECOLHER
        ZERO,  // VL_SLD_CREDOR_TRANSPORTAR
        ZERO,  // DEB_ESP
    ]));

    // E990 — Encerramento
    const total = linhas.length + 1;
    linhas.push(fmt.buildLine(['E990', total]));

    return linhas;
}
