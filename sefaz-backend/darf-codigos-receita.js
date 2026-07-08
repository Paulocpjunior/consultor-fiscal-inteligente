// ============================================================================
// sefaz-backend/darf-codigos-receita.js
// Tabela de códigos de receita DARF mais comuns para Lucro Presumido e Real.
//
// Fonte: Tabela de Códigos de Receita SRF (RFB) — consulta:
//   https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/pagamentos-e-parcelamentos/codigos-de-receita
//
// Não é exaustiva — cobre os tributos federais usuais que o módulo emite.
// Para tributos não listados, frontend permite código custom.
// ============================================================================

// extensao = Código de Extensão da Receita (Tabela de Receitas RFB) — o
// SICALC (CONSOLIDARGERARDARF51) exige código + extensão. Conferido em DARF
// real emitido pela DCTFWeb (08/07/2026): 2089-01, 2372-01, 8109-02, 2172-01.
// '01' é a extensão-padrão da maioria das receitas PJ.
export const CODIGOS_RECEITA = {
    // ── IRPJ ────────────────────────────────────────────────────────────────
    IRPJ_PRESUMIDO_TRIMESTRAL: { codigo: '2089', extensao: '01', descricao: 'IRPJ - Lucro Presumido - Trimestral' },
    IRPJ_REAL_TRIMESTRAL:      { codigo: '0220', extensao: '01', descricao: 'IRPJ - Lucro Real - Trimestral' },
    IRPJ_REAL_ESTIMATIVA:      { codigo: '2362', extensao: '01', descricao: 'IRPJ - Lucro Real - Estimativa Mensal' },
    IRPJ_REAL_AJUSTE_ANUAL:    { codigo: '2430', extensao: '01', descricao: 'IRPJ - Lucro Real - Ajuste Anual' },

    // ── CSLL ────────────────────────────────────────────────────────────────
    CSLL_PRESUMIDO_TRIMESTRAL: { codigo: '2372', extensao: '01', descricao: 'CSLL - Lucro Presumido - Trimestral' },
    CSLL_REAL_TRIMESTRAL:      { codigo: '6012', extensao: '01', descricao: 'CSLL - Lucro Real - Trimestral' },
    CSLL_REAL_ESTIMATIVA:      { codigo: '2484', extensao: '01', descricao: 'CSLL - Lucro Real - Estimativa Mensal' },
    CSLL_REAL_AJUSTE_ANUAL:    { codigo: '6773', extensao: '01', descricao: 'CSLL - Lucro Real - Ajuste Anual' },

    // ── PIS ─────────────────────────────────────────────────────────────────
    PIS_CUMULATIVO:            { codigo: '8109', extensao: '02', descricao: 'PIS/PASEP - Faturamento (cumulativo, Presumido)' },
    PIS_NAO_CUMULATIVO:        { codigo: '6912', extensao: '01', descricao: 'PIS/PASEP - Não-cumulativo (Lucro Real)' },

    // ── COFINS ──────────────────────────────────────────────────────────────
    COFINS_CUMULATIVO:         { codigo: '2172', extensao: '01', descricao: 'COFINS - Faturamento (cumulativo, Presumido)' },
    COFINS_NAO_CUMULATIVO:     { codigo: '5856', extensao: '01', descricao: 'COFINS - Não-cumulativo (Lucro Real)' },

    // ── IRRF (Imposto Retido na Fonte) ──────────────────────────────────────
    IRRF_SERVICOS_PJ:          { codigo: '1708', extensao: '02', descricao: 'IRRF - Serviços PJ (1,5%)' },
    IRRF_TRABALHO_ASSALARIADO: { codigo: '0561', extensao: '07', descricao: 'IRRF - Rendimentos do Trabalho' },
};

/**
 * Sugere código de receita baseado em regime + tributo.
 * @param {string} regime  'Presumido' | 'Real'
 * @param {string} tributo 'IRPJ' | 'CSLL' | 'PIS' | 'COFINS'
 * @param {string} [periodicidade] 'mensal' | 'trimestral'
 * @returns {{codigo:string, descricao:string}|null}
 */
export function sugerirCodigoReceita(regime, tributo, periodicidade = 'trimestral') {
    const r = String(regime || '').toLowerCase();
    const t = String(tributo || '').toUpperCase();
    const isReal = r.includes('real');
    const isMensal = periodicidade === 'mensal';

    if (t === 'IRPJ') {
        if (!isReal) return CODIGOS_RECEITA.IRPJ_PRESUMIDO_TRIMESTRAL;
        return isMensal ? CODIGOS_RECEITA.IRPJ_REAL_ESTIMATIVA : CODIGOS_RECEITA.IRPJ_REAL_TRIMESTRAL;
    }
    if (t === 'CSLL') {
        if (!isReal) return CODIGOS_RECEITA.CSLL_PRESUMIDO_TRIMESTRAL;
        return isMensal ? CODIGOS_RECEITA.CSLL_REAL_ESTIMATIVA : CODIGOS_RECEITA.CSLL_REAL_TRIMESTRAL;
    }
    if (t === 'PIS') {
        return isReal ? CODIGOS_RECEITA.PIS_NAO_CUMULATIVO : CODIGOS_RECEITA.PIS_CUMULATIVO;
    }
    if (t === 'COFINS') {
        return isReal ? CODIGOS_RECEITA.COFINS_NAO_CUMULATIVO : CODIGOS_RECEITA.COFINS_CUMULATIVO;
    }
    if (t === 'IRRF') return CODIGOS_RECEITA.IRRF_SERVICOS_PJ;
    return null;
}

/**
 * Lista os códigos disponíveis pra UI (selector).
 */
export function listarCodigos() {
    return Object.entries(CODIGOS_RECEITA).map(([key, v]) => ({ key, ...v }));
}
