// Tipos de sefaz-backend/emissao-permissao.js (modulo .js puro) pra
// consumo em testes TS sem allowJs no tsconfig principal.
export const PERM_EMISSAO_TRIBUTOS: string;
export function temPermissaoEmissao(
    role: string | null | undefined,
    modulosPermitidos: string[] | null | undefined,
): boolean;
