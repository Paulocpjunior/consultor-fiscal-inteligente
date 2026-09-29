export type PapelCte = 'emitente' | 'tomador' | 'terceiro' | 'sem-tomador' | 'sem-empresa' | 'nao-cte';
export const PAPEIS_CTE: Readonly<Record<string, string>>;
export function ehCteDoc(d: unknown): boolean;
export function papelDaEmpresaNoCte(d: unknown, empresaCnpj?: string): PapelCte;
export function direcaoDoCte(d: unknown, empresaCnpj?: string): 'entrada' | 'saida' | null;
export function cteEntraNaEscrituracao(d: unknown, empresaCnpj?: string): { entra: boolean; papel: PapelCte; motivo: string };
export function selecionarCtes<T>(notas: T[], empresaCnpj?: string): { notas: T[]; foraTerceiro: string[]; semTomador: string[] };
export function avisosDosCtes(sel: { foraTerceiro?: string[]; semTomador?: string[] }): string[];
