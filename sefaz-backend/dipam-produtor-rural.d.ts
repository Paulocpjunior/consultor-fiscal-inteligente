export interface AliquotasFunrural {
    desde: string;
    inss: number;
    gilrat: number;
    senar: number;
    fonte: string;
    revisar: boolean;
}

export interface NaturezaFornecedor {
    ehProdutorRuralPF: boolean;
    confianca: 'confirmada' | 'alta' | 'media' | 'indefinida';
    sinais: string[];
    motivo: string;
}

export interface PendenciaDipam {
    codigo: string;
    mensagem: string;
    acao: string;
}

export interface CalculoFunrural {
    base: number;
    aliquotas: { inss: number; gilrat: number; senar: number };
    percentualTotal: number;
    inss: number;
    gilrat: number;
    senar: number;
    total: number;
    fonte: string;
    revisar: boolean;
}

export const CODIGOS_DIPAM: Record<string, string>;
export const UF_DIPAM: string;
export const CFOPS_COMPRA: Set<string>;
export const CFOPS_DEVOLUCAO: Set<string>;
export const CFOPS_NAO_LANCAR: Record<string, string>;
export const ALIQUOTAS_FUNRURAL_PF: AliquotasFunrural[];
export const ALIQUOTAS_FUNRURAL_SEGURADO_ESPECIAL: AliquotasFunrural[];
export function tabelaDoProdutor(cadastro: any, tabelaPadrao?: AliquotasFunrural[]): AliquotasFunrural[];

export function ehIeProdutorRuralSP(ie: unknown): boolean;
export function ehNcmAgropecuario(ncm: unknown): boolean;
export function ehMunicipioPaulista(codMunIBGE: unknown): boolean;
export function aliquotasFunruralVigentes(competencia: string, tabela?: AliquotasFunrural[]): AliquotasFunrural;
export function parseValorLivre(txt: unknown): number | null;
export function extrairFunruralDeclarado(infAdic: unknown): { percentual: number | null; valor: number | null; trecho: string } | null;
export function calcularFunrural(base: unknown, competencia: string, tabela?: AliquotasFunrural[]): CalculoFunrural;
export function identificarNaturezaFornecedor(participante: any, cadastro?: any): NaturezaFornecedor;
export function classificarNota(doc: any, opts?: { cadastro?: any; empresa?: any; tabelaFunrural?: AliquotasFunrural[] }): any;
export function montarDipamCompetencia(p: {
    documentos?: any[];
    competencia: string;
    empresa?: any;
    fornecedores?: Record<string, any>;
    tabelaFunrural?: AliquotasFunrural[];
}): any;
export function farolDipam(p: { total: number; notas: number; bloqueantes: number; pendencias: number; funruralNotas: number }):
    { cor: 'ok' | 'atencao' | 'falha' | 'neutro'; resumo: string };
export function montarRegistro1400(municipios?: Array<{ codMunIBGE: string; valor: number; registro1400?: string }>):
    Array<{ registro: string; codItemIpm: string; mun: string; valor: number; linha: string }>;
