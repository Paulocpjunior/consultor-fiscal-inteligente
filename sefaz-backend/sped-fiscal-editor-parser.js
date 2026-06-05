// ============================================================================
// sped-fiscal-editor-parser.js
//
// Parser SPED Fiscal focado em ROUND-TRIP seguro pra edicao: indexa TODAS as
// linhas (nao descarta nada) preservando ordem original, e expoe um subset
// dos campos COM NOMES amigaveis pros registros mais editados pelo contador
// (0150, 0200, C100, C170, C190, E110, H010 — cobrem CFOP/CST/NCM/BC).
//
// Modulo PURO (sem io/firebase) — testavel direto.
//
// SAIDA:
//   {
//     linhas: [{ idx, tipo, campos: string[], original: string }, ...]
//     editaveis: { 'C170': [{ idx, campos: { CFOP, CST_ICMS, NCM, VL_ITEM, ... } }, ...], ... }
//     resumo: { totalLinhas, registrosPorTipo: { '0000': 1, 'C170': 5234, ... } }
//   }
// ============================================================================

// Layout dos registros editaveis — apenas campos relevantes pra correcao
// (CFOP, CST, NCM, base de calculo, aliquota, valores). Nomes seguem Guia
// Pratico EFD ICMS/IPI 3.2.2. Ordem do array = ordem no SPED (campos[0]=tipo,
// campos[1]=primeiro campo). Indices 1-based correspondem aos do Manual.
const LAYOUT = {
    // Bloco 0 — Identificacao + cadastros
    '0150': [
        'COD_PART', 'NOME', 'COD_PAIS', 'CNPJ', 'CPF',
        'IE', 'COD_MUN', 'SUFRAMA', 'END', 'NUM', 'COMPL', 'BAIRRO',
    ],
    '0200': [
        'COD_ITEM', 'DESCR_ITEM', 'COD_BARRA', 'COD_ANT_ITEM', 'UNID_INV',
        'TIPO_ITEM', 'COD_NCM', 'EX_IPI', 'COD_GEN', 'COD_LST', 'ALIQ_ICMS', 'CEST',
    ],
    // Bloco C — Documentos fiscais (Nota Fiscal)
    'C100': [
        'IND_OPER', 'IND_EMIT', 'COD_PART', 'COD_MOD', 'COD_SIT', 'SER', 'NUM_DOC',
        'CHV_NFE', 'DT_DOC', 'DT_E_S', 'VL_DOC', 'IND_PGTO', 'VL_DESC', 'VL_ABAT_NT',
        'VL_MERC', 'IND_FRT', 'VL_FRT', 'VL_SEG', 'VL_OUT_DA', 'VL_BC_ICMS', 'VL_ICMS',
        'VL_BC_ICMS_ST', 'VL_ICMS_ST', 'VL_IPI', 'VL_PIS', 'VL_COFINS', 'VL_PIS_ST', 'VL_COFINS_ST',
    ],
    'C170': [
        'NUM_ITEM', 'COD_ITEM', 'DESCR_COMPL', 'QTD', 'UNID', 'VL_ITEM', 'VL_DESC',
        'IND_MOV', 'CST_ICMS', 'CFOP', 'COD_NAT', 'VL_BC_ICMS', 'ALIQ_ICMS', 'VL_ICMS',
        'VL_BC_ICMS_ST', 'ALIQ_ST', 'VL_ICMS_ST', 'IND_APUR', 'CST_IPI', 'COD_ENQ',
        'VL_BC_IPI', 'ALIQ_IPI', 'VL_IPI',
        'CST_PIS', 'VL_BC_PIS', 'ALIQ_PIS', 'QUANT_BC_PIS', 'ALIQ_PIS_REAIS', 'VL_PIS',
        'CST_COFINS', 'VL_BC_COFINS', 'ALIQ_COFINS', 'QUANT_BC_COFINS', 'ALIQ_COFINS_REAIS', 'VL_COFINS',
        'COD_CTA', 'VL_ABAT_NT',
    ],
    'C190': [
        'CST_ICMS', 'CFOP', 'ALIQ_ICMS', 'VL_OPR', 'VL_BC_ICMS', 'VL_ICMS',
        'VL_BC_ICMS_ST', 'VL_ICMS_ST', 'VL_RED_BC', 'VL_IPI', 'COD_OBS',
    ],
    // Bloco E — Apuracao ICMS/IPI
    'E110': [
        'VL_TOT_DEBITOS', 'VL_AJ_DEBITOS', 'VL_TOT_AJ_DEBITOS', 'VL_ESTORNOS_CRED',
        'VL_TOT_CREDITOS', 'VL_AJ_CREDITOS', 'VL_TOT_AJ_CREDITOS', 'VL_ESTORNOS_DEB',
        'VL_SLD_CREDOR_ANT', 'VL_SLD_APURADO', 'VL_TOT_DED', 'VL_ICMS_RECOLHER',
        'VL_SLD_CREDOR_TRANSPORTAR', 'DEB_ESP',
    ],
    // Bloco H — Inventario
    'H010': [
        'COD_ITEM', 'UNID', 'QTD', 'VL_UNIT', 'VL_ITEM',
        'IND_PROP', 'COD_PART', 'TXT_COMPL', 'COD_CTA', 'VL_ITEM_IR',
    ],
};

/**
 * @param {string} text  conteudo bruto do SPED (.txt)
 * @returns {{
 *   linhas: Array<{ idx:number, tipo:string, campos:string[], original:string }>,
 *   editaveis: Record<string, Array<{ idx:number, campos:Record<string,string> }>>,
 *   resumo: { totalLinhas:number, registrosPorTipo:Record<string,number> }
 * }}
 */
export function parseSpedFiscalParaEdicao(text) {
    if (!text || typeof text !== 'string') {
        throw new Error('SPED Fiscal: conteudo vazio ou invalido');
    }
    // Preserva quebras originais. Linhas vazias sao ignoradas pela leitura
    // mas removidas (Guia Pratico nao admite linha vazia entre registros).
    const rawLines = text.split(/\r?\n/);
    const linhas = [];
    const editaveis = {};
    const registrosPorTipo = {};
    let idx = 0;

    for (const raw of rawLines) {
        if (!raw || !raw.trim()) continue;
        // Linha SPED: |TIPO|c1|c2|...|cN|
        if (!raw.startsWith('|') || !raw.endsWith('|')) {
            // Linha mal-formada (cabecalho de email anexado, BOM, etc) — ignora
            // mas mantem visivel no resumo pra investigacao.
            registrosPorTipo['_invalida'] = (registrosPorTipo['_invalida'] || 0) + 1;
            continue;
        }
        const campos = raw.slice(1, -1).split('|');
        const tipo = campos[0] || '';
        if (!tipo) continue;

        linhas.push({ idx, tipo, campos, original: raw });
        registrosPorTipo[tipo] = (registrosPorTipo[tipo] || 0) + 1;

        const layout = LAYOUT[tipo];
        if (layout) {
            const camposNomeados = {};
            for (let i = 0; i < layout.length; i++) {
                camposNomeados[layout[i]] = campos[i + 1] || '';
            }
            if (!editaveis[tipo]) editaveis[tipo] = [];
            editaveis[tipo].push({ idx, campos: camposNomeados });
        }
        idx++;
    }

    return {
        linhas,
        editaveis,
        resumo: { totalLinhas: linhas.length, registrosPorTipo },
    };
}

/** Devolve a lista de tipos com layout estruturado (pra UI). */
export function tiposEditaveis() {
    return Object.keys(LAYOUT).sort();
}

/** Layout (colunas nomeadas) de um tipo — pra cabecalho da planilha. */
export function colunasDoTipo(tipo) {
    return LAYOUT[tipo] ? [...LAYOUT[tipo]] : null;
}
