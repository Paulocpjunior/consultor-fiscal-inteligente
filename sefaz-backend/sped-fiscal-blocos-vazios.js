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
export const buildBlocoD = () => buildBlocoVazio('D');
export const buildBlocoE = () => buildBlocoVazio('E');
export const buildBlocoG = () => buildBlocoVazio('G');
export const buildBlocoH = () => buildBlocoVazio('H');
export const buildBlocoK = () => buildBlocoVazio('K');
export const buildBloco1 = () => buildBlocoVazio('1');
