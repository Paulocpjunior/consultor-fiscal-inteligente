export interface ParametroNcm {
    ncm: string;
    uf?: string;
    descricao?: string;
    cest?: string;
    aliqInterna?: number | null;
    ivaSt?: number | null;
    ivaJaAjustado?: boolean;
    portariaIvaSt?: string;
    temSt?: boolean | null;
    reducaoBase?: number | null;
    vigenciaInicio?: string;
    vigenciaFim?: string;
    atualizadoPor?: string | null;
    atualizadoEm?: string;
}

export interface ResolucaoNcm {
    achou: boolean;
    ncmCadastrado: string | null;
    aliqInterna: number | null;
    ivaSt: number | null;
    ivaJaAjustado: boolean;
    portariaIvaSt: string | null;
    cest: string | null;
    temSt: boolean | null;
    reducaoBase: number | null;
    descricao: string | null;
    motivo: string | null;
}

export const ALIQ_INTERNA_MAX: number;
export const COLECAO_NCM: string;

export function normalizarNcm(valor: unknown): string;
export function ncmCasa(ncmDoItem: unknown, ncmDoCadastro: unknown): boolean;
export function validarParametroNcm(p: unknown): { ok: boolean; erros: string[]; ncm: string; uf: string };
export function vigenteEm(param: unknown, dataRef?: string): boolean;
export function resolverParametrosNcm(
    ncm: unknown,
    catalogo: ParametroNcm[],
    p?: { uf?: string; dataRef?: string },
): ResolucaoNcm;
export function sugerirIvaPorItem(
    documentosComSt: unknown[],
    catalogo: ParametroNcm[],
    ivaInformado?: Record<string, { ivaSt?: number }>,
): {
    sugerido: Record<string, { ivaSt: number; ivaJaAjustado: boolean; aliqInterna?: number; _origem: string; _ncm: string | null; _portaria: string | null }>;
    usados: Array<{ id: string; ncm: string | null; portaria: string | null }>;
};
export function docIdParametro(p: unknown): string;
