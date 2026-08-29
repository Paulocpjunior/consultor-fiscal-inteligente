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
// buildBlocoK foi pra ./sped-fiscal-blocoK.js (com K010/K100/K200/K230/K235
// reais). A versão vazia foi DELETADA de propósito: código morto é a isca para
// alguém reativar a régua velha — e aqui a régua velha declara, todo mês, um
// bloco K sem dados em quem entrega o controle de produção.
/**
 * Bloco 1 — gera 1001|0| + 1010|…| + (1400 por municipio) + 1990|N|.
 *
 * Registro 1010 (Obrigatoriedade de Registros do Bloco 1) eh exigido pelo
 * PVA mesmo quando a empresa nao tem operacoes especiais. 14 campos S/N.
 *
 * Layout do 1010 (NT 2024.001):
 *  REG | IND_EXP | IND_CCRF | IND_COMB | IND_USINA | IND_VA |
 *      | IND_EE  | IND_CART | IND_FORM | IND_AER  | IND_GIAF1 |
 *      | IND_GIAF3 | IND_GIAF4 | IND_REST_RESSARC_COMPL_ICMS
 *
 * IND_VA ("informou Valor Adicionado?") eh o interruptor do Registro 1400:
 * so pode ser 'S' quando ha 1400 no arquivo, e nao pode ser 'N' quando ha —
 * o PVA rejeita as duas combinacoes.
 *
 * Registro 1400 = DIPAM por municipio (Manual da DIPAM 2026, pag. 29):
 * |1400|COD_ITEM_IPM|MUN|VALOR| — ex.: |1400|SPDIPAM11|3548906|52520,00|.
 * Quem compra de produtor rural paulista informa aqui o montante mensal
 * agrupado por municipio de origem. Ver sefaz-backend/dipam-produtor-rural.js.
 *
 * @param {Array<{codItemIpm:string, mun:string, valor:number}>} [registros1400]
 */
export function buildBloco1(registros1400 = []) {
    const dipam = (registros1400 || []).filter((r) => r && r.mun && Number(r.valor) > 0);
    const temVA = dipam.length > 0;

    const linhas = [
        fmt.buildLine(['1001', '0']),  // 0 = Bloco COM dados (tem o 1010)
        fmt.buildLine([
            '1010',
            'N', 'N', 'N', 'N', temVA ? 'S' : 'N',  // EXP, CCRF, COMB, USINA, VA
            'N', 'N', 'N', 'N', 'N',  // EE, CART, FORM, AER, GIAF1
            'N', 'N', 'N',            // GIAF3, GIAF4, REST_RESSARC
        ]),
        ...dipam.map((r) => fmt.buildLine([
            '1400',
            fmt.sanitizeString(r.codItemIpm, 60),
            String(r.mun).replace(/\D/g, ''),
            fmt.formatValue(r.valor),
        ])),
    ];
    linhas.push(fmt.buildLine(['1990', String(linhas.length + 1)]));
    return linhas;
}
