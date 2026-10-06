export interface PerfilCfi { role?: string; departamentos?: string[]; acessoCfi?: string; }
export function podeOperarFiscal(user: PerfilCfi | null | undefined): boolean;
export const MENSAGEM_SOMENTE_RELATORIOS: string;
export function exigeOperacaoFiscal(method: string, url: string): boolean;
