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

/**
 * Determina se o Bloco H deve gerar conteudo (H005+H010) ou ficar vazio.
 *
 * Condicoes pra gerar inventario:
 *   1. O periodo final (competenciaFim) eh dezembro, OU
 *   2. A empresa tem dadosFiscais.gerarInventario = true
 *
 * Alem disso, precisa ter itens (dados.itens) pra listar.
 *
 * @param {object} dados - objeto retornado por coletarDadosEmpresa
 * @returns {boolean}
 */
function deveGerarInventario(dados) {
    const competenciaFim = dados.competenciaFim || '';
    const ehDezembro = competenciaFim.endsWith('-12');
    const forcarInventario = !!(dados.empresa?.dadosFiscais?.gerarInventario);
    return (ehDezembro || forcarInventario) && (dados.itens || []).length > 0;
}

/**
 * Calcula o ultimo dia da competenciaFim no formato ISO (YYYY-MM-DD).
 *
 * @param {string} competenciaFim - 'YYYY-MM'
 * @returns {string} 'YYYY-MM-DD'
 */
function ultimoDiaCompetencia(competenciaFim) {
    const m = (competenciaFim || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    const ano = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10);
    // new Date(ano, mes, 0) retorna o ultimo dia do mes
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return `${m[1]}-${m[2]}-${String(ultimoDia).padStart(2, '0')}`;
}

/**
 * Constroi o Bloco H inteiro.
 *
 * @param {object} dados - mesmo objeto retornado por coletarDadosEmpresa
 * @returns {string[]} array de linhas SPED
 */
export function buildBlocoH(dados) {
    const linhas = [];
    const gerar = deveGerarInventario(dados);

    // H001 — Abertura
    // IND_MOV: 0 = Bloco COM dados, 1 = Bloco SEM dados
    linhas.push(fmt.buildLine(['H001', gerar ? '0' : '1']));

    if (gerar) {
        const itens = dados.itens || [];
        const dtInv = ultimoDiaCompetencia(dados.competenciaFim);

        // Calcula total do inventario (soma de VL_ITEM de cada H010)
        // Como QTD e VL_UNIT defaultam 0, VL_ITEM = QTD * VL_UNIT = 0
        // a menos que dados reais estejam preenchidos.
        let vlTotal = 0;
        const linhasH010 = [];

        for (const item of itens) {
            const qtd = parseFloat(item.qtdInventario || 0);
            const vlUnit = parseFloat(item.vlUnitInventario || 0);
            const vlItem = qtd * vlUnit;
            vlTotal += vlItem;

            // IND_PROP: 0=Informante (proprio), 1=Terceiro, 2=Em poder de terceiro
            const indProp = item.indPropInventario || '0';
            // COD_PART obrigatorio se IND_PROP != 0
            const codPart = indProp !== '0' ? (item.codPartInventario || '') : '';

            linhasH010.push(fmt.buildLine([
                'H010',
                fmt.sanitizeString(item.codItem, 60),                      // COD_ITEM
                fmt.sanitizeString(item.unidade || 'UN', 6),               // UNID
                fmt.formatValue(qtd, 3),                                    // QTD
                fmt.formatValue(vlUnit, 6),                                 // VL_UNIT
                fmt.formatValue(vlItem, 2),                                 // VL_ITEM
                indProp,                                                    // IND_PROP
                codPart,                                                    // COD_PART
                fmt.sanitizeString(item.txtComplInventario || '', 255),     // TXT_COMPL
                fmt.sanitizeString(item.codCtaInventario || '', 255),       // COD_CTA
                fmt.formatValue(item.vlItemIr || '', 2),                    // VL_ITEM_IR
            ]));
        }

        // MOT_INV: motivo do inventario
        // 01 = No final no periodo
        // 02 = Na mudanca de forma de tributacao da mercadoria (ICMS)
        // 03 = Na solicitacao da baixa cadastral, paralisacao temporaria e
        //      outras situacoes
        // 04 = Na alteracao de regime de pagamento — Loss/Actual
        // 05 = Por determinacao dos fiscos
        const motInv = dados.empresa?.dadosFiscais?.motInv || '01';

        // H005 — Totais do Inventario
        // VL_AJ_PERDA e VL_AJ_GANHO sao valores de ajuste (perdas/ganhos),
        // nao o total do estoque. Defaultam 0 — o usuario preenche se houver
        // ajustes. O valor total do inventario eh implicito (soma dos H010).
        linhas.push(fmt.buildLine([
            'H005',
            fmt.formatDate(dtInv),           // DT_INV
            fmt.formatValue(0, 2),           // VL_AJ_PERDA
            fmt.formatValue(0, 2),           // VL_AJ_GANHO
            motInv,                          // MOT_INV
        ]));

        // H010 — itens do inventario
        for (const linha of linhasH010) {
            linhas.push(linha);
        }
    }

    // H990 — Encerramento
    // Total de linhas do bloco INCLUINDO o proprio H990
    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['H990', totalBloco]));

    return linhas;
}
