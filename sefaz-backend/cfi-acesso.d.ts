export interface PerfilCfi { role?: string; departamentos?: string[]; acessoCfi?: string; permissoesCfi?: PermissoesCfi; }
export function podeOperarFiscal(user: PerfilCfi | null | undefined): boolean;
export const MENSAGEM_SOMENTE_RELATORIOS: string;
export function exigeOperacaoFiscal(method: string, url: string): boolean;

export type AcaoCfi = 'editar' | 'importar' | 'calcular' | 'emitir' | 'fechar' | 'excluir';
export type NivelCfi = 'consulta' | 'edicao' | 'operacao';
export interface PermissoesCfi { versao: 1; nivel: NivelCfi; acoes: Record<AcaoCfi, boolean>; }
export const ACOES_CFI: AcaoCfi[];
export const NIVEIS_CFI: NivelCfi[];
export function criarPermissoesCfi(nivel: NivelCfi): PermissoesCfi;
export function validarPermissoesCfi(p: unknown): boolean;
export function permissoesEfetivasCfi(user: PerfilCfi | null | undefined): PermissoesCfi;
export function podeAcaoFiscal(user: PerfilCfi | null | undefined, acao: AcaoCfi | 'operar'): boolean;
export function acaoFiscalDaRota(method: string, url: string): AcaoCfi | 'operar' | null;
