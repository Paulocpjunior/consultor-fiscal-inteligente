export const CODIGOS_OBRIGACAO_ST: Readonly<Record<string, string>>;
export const UFS_BRASIL: readonly string[];
export const DIA_MAXIMO_VENCIMENTO: number;
export type FormaRecolhimentoSt = 'mensal' | 'operacao';
export const FORMAS_RECOLHIMENTO_ST: Readonly<{ MENSAL: 'mensal'; OPERACAO: 'operacao' }>;
export const CODIGOS_RECEITA_GNRE_ST: ReadonlyArray<{ codigo: string; forma: FormaRecolhimentoSt; descricao: string }>;
export function formaDoCodigoReceitaSt(codigo: unknown): FormaRecolhimentoSt | '';
export function codigoReceitaStPorOperacao(codigo: unknown): boolean;
export interface LinhaStUfCadastro {
    uf: string; ie: string; codOr: string; codRec: string; forma: FormaRecolhimentoSt; diaVencimento: number | null;
}
export function validarLinhaStUf(l: any): { ok: true; linha: LinhaStUfCadastro } | { ok: false; erros: string[] };
export function validarCadastroStUf(linhas: any[]): { ok: true; ufs: Record<string, Omit<LinhaStUfCadastro, 'uf'>> } | { ok: false; erros: string[] };
export function vencimentoNoMesSeguinte(competencia: string, dia: number): string;
export function obrigacoesStDoCadastro(cadastro: any, competencia: string): {
    obrigacoes: Record<string, { dtVcto: string; codRec: string; codOr: string; origem: 'cadastro'; porOperacao?: true }>;
    erros: string[];
};
export function mesclarObrigacoesSt(daCompetencia: any, doCadastro: any): Record<string, any>;
