// ============================================================================
// sefaz-backend/st-cadastro-store.js
// ----------------------------------------------------------------------------
// Onde mora o cadastro de IE de substituto tributário por UF (08/10): um doc
// por empresa, `empresa_st_por_uf/{empresaId}` → { ufs: { PR: { ie, codOr,
// codRec, diaVencimento } }, atualizadoPor, atualizadoEm, historico[] }.
// A régua (o que vale e como vira E250) é `st-cadastro-uf.js`.
// ============================================================================
export const COLECAO_ST_POR_UF = 'empresa_st_por_uf';
