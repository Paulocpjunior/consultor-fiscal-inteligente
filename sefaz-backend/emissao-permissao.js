// ============================================================================
// sefaz-backend/emissao-permissao.js
// Regra pura de autorizacao pra emissao de tributos (DAS/DARF/Central).
//
// Separada do require-admin.js (que importa firebase-admin) pra ser
// testavel em unit test sem mockar o SDK.
// ============================================================================

/**
 * Valor gravado em users/{uid}.modulosPermitidos que libera a emissao de
 * tributos a um colaborador. E o mesmo string de SearchType.EMISSAO_TRIBUTOS
 * no front (types.ts) — o modal Gerenciar Usuarios grava exatamente esse
 * valor. Mudou la, muda aqui.
 */
export const PERM_EMISSAO_TRIBUTOS = 'Central de Emissões';

/**
 * Admin sempre pode emitir; colaborador precisa da permissao
 * PERM_EMISSAO_TRIBUTOS em modulosPermitidos (liberada por um admin via
 * Gerenciar Usuarios). Qualquer outro role (ou doc ausente) nega.
 */
export function temPermissaoEmissao(role, modulosPermitidos) {
    if (role === 'admin') return true;
    return role === 'colaborador'
        && Array.isArray(modulosPermitidos)
        && modulosPermitidos.includes(PERM_EMISSAO_TRIBUTOS);
}
