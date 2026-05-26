// ============================================================================
// sefaz-backend/sped-fiscal-blocos-vazios.js
// Geradores minimos para os blocos B, D, E, G, H, K, 1 do EFD ICMS/IPI.
//
// Conforme NT 2024.001 item a):
//   "Registros de aberturas e de encerramentos de blocos sao sempre
//    obrigatorios."
//
// Cada bloco vazio gera apenas 2 linhas:
//   X001|1|   — Abertura, IND_MOV=1 (Bloco SEM dados)
//   X990|2|   — Encerramento, total = 2 linhas
//
// ATENCAO: o Bloco E (apuracao ICMS/IPI) eh obrigatorio com conteudo real
// (E100, E110, E200, E210). Esta versao gera apenas estrutura minima pra
// passar na validacao formal do PVA. Apuracao real fica pra Fase 3.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';

/**
 * Gera abertura+encerramento de um bloco vazio.
 * @param {string} sigla - 'B', 'D', 'E', 'G', 'H', 'K' ou '1'
 * @returns {string[]} 2 linhas SPED
 */
function buildBlocoVazio(sigla) {
    return [
        fmt.buildLine([`${sigla}001`, '1']),   // 1 = Bloco SEM dados
        fmt.buildLine([`${sigla}990`, '2']),   // 2 linhas no bloco (001 + 990)
    ];
}

export const buildBlocoB = () => buildBlocoVazio('B');
// buildBlocoD foi pra ./sped-fiscal-blocoD.js (com D100/D190 reais).
// buildBlocoE foi pra ./sped-fiscal-blocoE.js (com E100/E110 zerada).
export const buildBlocoG = () => buildBlocoVazio('G');
// buildBlocoH foi pra ./sped-fiscal-blocoH.js (com H005/H010 reais).
export const buildBlocoK = () => buildBlocoVazio('K');
/**
 * Bloco 1 — gera 1001|0| + 1010|N|x14| + 1990|3|.
 *
 * Registro 1010 (Obrigatoriedade de Registros do Bloco 1) eh exigido pelo
 * PVA mesmo quando a empresa nao tem operacoes especiais. 14 campos S/N,
 * todos 'N' indicando que nada se aplica.
 *
 * Layout do 1010 (NT 2024.001):
 *  REG | IND_EXP | IND_CCRF | IND_COMB | IND_USINA | IND_VA |
 *      | IND_EE  | IND_CART | IND_FORM | IND_AER  | IND_GIAF1 |
 *      | IND_GIAF3 | IND_GIAF4 | IND_REST_RESSARC_COMPL_ICMS
 */
export function buildBloco1() {
    return [
        fmt.buildLine(['1001', '0']),  // 0 = Bloco COM dados (tem o 1010)
        fmt.buildLine([
            '1010',
            'N', 'N', 'N', 'N', 'N',  // EXP, CCRF, COMB, USINA, VA
            'N', 'N', 'N', 'N', 'N',  // EE, CART, FORM, AER, GIAF1
            'N', 'N', 'N',            // GIAF3, GIAF4, REST_RESSARC
        ]),
        fmt.buildLine(['1990', '3']),  // 3 linhas no bloco
    ];
}
