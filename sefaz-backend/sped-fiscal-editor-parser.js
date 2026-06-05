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
const LAYOUT_FISCAL = {
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

// Layout EFD CONTRIBUICOES (PIS/COFINS) — VALIDADO contra arquivo real
// (MODELO_EFD_CONT). Achados confirmados em dado real:
//   - 0150: 12 campos — idêntico ao Fiscal.
//   - 0200: 11 campos — Fiscal SEM o CEST final (COD_NCM confirmado no campo 7).
//   - C100: 28 campos — idêntico ao Fiscal.
//   - C170: 36 campos — C170 Fiscal SEM o VL_ABAT_NT final. CST_PIS confirmado
//     no campo 24, ALIQ_PIS no 26, VL_PIS no 29, CST_COFINS no 30, VL_COFINS no 35.
//     (Meu chute anterior de 22 campos estava ERRADO — corrigido com dado real.)
//   - M210/M610: 15 campos — bateram de primeira.
// A rede de seguranca (contagem de campos) continua protegendo qualquer
// variacao de versao: se nao bater, vira read-only em vez de corromper.
const LAYOUT_CONTRIB = {
    '0150': LAYOUT_FISCAL['0150'],
    '0200': LAYOUT_FISCAL['0200'].slice(0, 11),
    'C100': LAYOUT_FISCAL['C100'],
    'C170': LAYOUT_FISCAL['C170'].slice(0, 36),
    // M210 — Detalhamento da contribuicao PIS por CST (layout v3+).
    'M210': [
        'CST_PIS', 'VL_REC_BRT', 'VL_BC_CONT',
        'VL_AJUS_ACRES_BC_PIS', 'VL_AJUS_REDUC_BC_PIS', 'VL_BC_CONT_AJUS',
        'ALIQ_PIS', 'QUANT_BC_PIS', 'ALIQ_PIS_QUANT', 'VL_CONT_APUR',
        'VL_AJUS_ACRES', 'VL_AJUS_REDUC', 'VL_CONT_DIFER', 'VL_CONT_DIFER_ANT', 'VL_CONT_PER',
    ],
    // M610 — Detalhamento da contribuicao COFINS por CST (espelho do M210).
    'M610': [
        'CST_COFINS', 'VL_REC_BRT', 'VL_BC_CONT',
        'VL_AJUS_ACRES_BC_COFINS', 'VL_AJUS_REDUC_BC_COFINS', 'VL_BC_CONT_AJUS',
        'ALIQ_COFINS', 'QUANT_BC_COFINS', 'ALIQ_COFINS_QUANT', 'VL_CONT_APUR',
        'VL_AJUS_ACRES', 'VL_AJUS_REDUC', 'VL_CONT_DIFER', 'VL_CONT_DIFER_ANT', 'VL_CONT_PER',
    ],
};

/**
 * Detecta o tipo de SPED pela presenca de registros caracteristicos:
 *   - M200/M600 (apuracao PIS/COFINS) -> EFD Contribuicoes
 *   - E110/E520 (apuracao ICMS/IPI)   -> EFD ICMS/IPI (Fiscal)
 * Default: 'fiscal'.
 */
function detectarTipoSped(tiposPresentes) {
    if (tiposPresentes.has('M200') || tiposPresentes.has('M600') || tiposPresentes.has('M210') || tiposPresentes.has('M610')) {
        return 'contribuicoes';
    }
    if (tiposPresentes.has('E110') || tiposPresentes.has('E520')) return 'fiscal';
    return 'fiscal';
}

function layoutDe(tipoSped) {
    return tipoSped === 'contribuicoes' ? LAYOUT_CONTRIB : LAYOUT_FISCAL;
}

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
    const layoutMismatch = {}; // tipos com layout divergente -> read-only (nao corrompe)
    let idx = 0;

    // 1a passada: coleta linhas validas + tipos presentes (pra detectar SPED).
    const parsedLinhas = [];
    for (const raw of rawLines) {
        if (!raw || !raw.trim()) continue;
        if (!raw.startsWith('|') || !raw.endsWith('|')) {
            registrosPorTipo['_invalida'] = (registrosPorTipo['_invalida'] || 0) + 1;
            continue;
        }
        const campos = raw.slice(1, -1).split('|');
        const tipo = campos[0] || '';
        if (!tipo) continue;
        parsedLinhas.push({ campos, tipo, original: raw });
        registrosPorTipo[tipo] = (registrosPorTipo[tipo] || 0) + 1;
    }

    const tipoSped = detectarTipoSped(new Set(Object.keys(registrosPorTipo)));
    const LAYOUT = layoutDe(tipoSped);

    // 2a passada: indexa + marca editaveis SO quando a contagem de campos do
    // layout BATE com a linha real. REDE DE SEGURANCA: se nao bater (layout
    // errado/versao diferente), o registro vira read-only (round-trip preserva)
    // em vez de corromper na reconstrucao.
    for (const { campos, tipo, original } of parsedLinhas) {
        linhas.push({ idx, tipo, campos, original });
        const layout = LAYOUT[tipo];
        if (layout) {
            const camposReais = campos.length - 1; // exclui o tipo (campo 0)
            if (camposReais === layout.length) {
                const camposNomeados = {};
                for (let i = 0; i < layout.length; i++) {
                    camposNomeados[layout[i]] = campos[i + 1] || '';
                }
                if (!editaveis[tipo]) editaveis[tipo] = [];
                editaveis[tipo].push({ idx, campos: camposNomeados });
            } else {
                // Layout conhecido MAS contagem divergente — fail-safe read-only.
                layoutMismatch[tipo] = { esperado: layout.length, real: camposReais };
            }
        }
        idx++;
    }

    return {
        tipoSped,
        linhas,
        editaveis,
        resumo: { totalLinhas: linhas.length, registrosPorTipo, tipoSped, layoutMismatch },
    };
}

/** Lista de tipos com layout estruturado pra um SPED (pra UI). */
export function tiposEditaveis(tipoSped = 'fiscal') {
    return Object.keys(layoutDe(tipoSped)).sort();
}

/** Layout (colunas nomeadas) de um tipo dentro de um SPED. */
export function colunasDoTipo(tipo, tipoSped = 'fiscal') {
    const L = layoutDe(tipoSped);
    return L[tipo] ? [...L[tipo]] : null;
}
