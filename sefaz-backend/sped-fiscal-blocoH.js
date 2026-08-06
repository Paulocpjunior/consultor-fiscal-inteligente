// ============================================================================
// sefaz-backend/sped-fiscal-blocoH.js
// Bloco H do EFD ICMS/IPI — Inventario Fisico.
//
// Registros gerados:
//   H001 — Abertura do Bloco H
//   H005 — Totais do Inventario
//   H010 — Inventario item a item
//   H990 — Encerramento do Bloco H
//
// O inventario eh obrigatorio no encerramento do exercicio (dezembro) ou
// quando a empresa tem dadosFiscais.gerarInventario = true.
//
// Itens do inventario vem de dados.itens (registros 0200 ja cadastrados).
// QTD e VL_UNIT default 0 — o usuario preenche via UI ou estima do
// historico de compras.
//
// Layout: Guia Pratico EFD ICMS/IPI 3.2.2.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';
import { planejarBlocoH, dataInventario, inventarioExigido } from './sped-bloco-h.js';

/**
 * Constroi o Bloco H inteiro.
 *
 * A DECISAO de gerar (e com quais itens) mora em sped-bloco-h.js, que e puro e
 * testado. Aqui so vira linha.
 *
 * REGRA QUE MANDA: inventario NAO informado sai como bloco VAZIO, nunca zerado
 * — bloco vazio diz "nao declarei", bloco zerado diz "declarei que nao tenho
 * estoque", e a segunda e mentira que o PVA aceita sem reclamar.
 *
 * @param {object} dados - mesmo objeto retornado por coletarDadosEmpresa
 * @returns {string[]} array de linhas SPED
 */
export function buildBlocoH(dados) {
    const linhas = [];
    const plano = planejarBlocoH({
        itens: dados.itens || [],
        exigido: inventarioExigido({
            competenciaFim: dados.competenciaFim,
            gerarInventario: dados.empresa?.dadosFiscais?.gerarInventario,
        }),
        motInv: dados.empresa?.dadosFiscais?.motInv,
    });

    // Os avisos precisam CHEGAR a quem gera: inventario faltando e coisa pra
    // resolver antes de transmitir, nao detalhe de log.
    if (Array.isArray(dados.avisos)) dados.avisos.push(...plano.avisos);
    for (const a of plano.avisos) console.warn(`[bloco-H] ${a}`);

    // H001 — IND_MOV: 0 = Bloco COM dados, 1 = Bloco SEM dados
    linhas.push(fmt.buildLine(['H001', plano.gerar ? '0' : '1']));

    if (plano.gerar) {
        // H005 — REG|DT_INV|VL_INV|MOT_INV. O gerador antigo punha
        // VL_AJ_PERDA/VL_AJ_GANHO no lugar do VL_INV e DESCARTAVA o total que
        // ele mesmo somava. LEIAUTE A CONFERIR NO PVA (doc oficial bloqueada
        // pela rede do ambiente) — os testes travam a estrutura.
        linhas.push(fmt.buildLine([
            'H005',
            fmt.formatDate(dataInventario(dados.competenciaFim)),
            fmt.formatValue(plano.valorTotal, 2),
            plano.motInv,
        ]));

        for (const item of plano.itens) {
            linhas.push(fmt.buildLine([
                'H010',
                fmt.sanitizeString(item.codItem, 60),
                fmt.sanitizeString(item.unidade, 6),
                fmt.formatValue(item.qtd, 3),
                fmt.formatValue(item.vlUnit, 6),
                fmt.formatValue(item.vlItem, 2),
                item.indProp,
                item.codPart,
                fmt.sanitizeString(item.txtCompl, 255),
                fmt.sanitizeString(item.codCta, 255),
                fmt.formatValue(item.vlItemIr, 2),
            ]));
        }
    }

    // H990 — total de linhas do bloco INCLUINDO o proprio H990
    linhas.push(fmt.buildLine(['H990', linhas.length + 1]));
    return linhas;
}
