import type { ConferenciaBaseInss } from './reinf-servicos-tomados';

export interface AjusteDeclaradoR2020 {
    autor: string | null;
    motivo: string | null;
    em: string | null;
}

/**
 * Uma NFS-e PRESTADA com INSS retido, no eixo do R-2020 (tomador).
 * Espelho do R-2010, sem `indCPRB` — o R-2020 não tem esse campo.
 */
export interface NotaR2020Normalizada {
    numero: string | null;
    serie: string | null;
    dtEmissao: string | null;
    chave: string | null;
    competencia: string | null;
    prestadorCnpj: string;
    tomadorCnpj: string;
    tomadorNome: string | null;
    vlrBruto: number | null;
    inssRetido: number | null;
    inssOrigem: 'documento' | 'ajuste-declarado' | null;
    ajuste: AjusteDeclaradoR2020 | null;
    baseRetencao: number | null;
    baseOrigem: 'bruto-sem-deducao' | 'derivada-da-retencao' | null;
    conferencia: ConferenciaBaseInss;
    tpServico: null;
    indObra: null;
    discriminacao: string | null;
    codigoServicoMunicipal: string | null;
}

export function normalizarServicoPrestado(d: unknown, ajuste?: unknown): NotaR2020Normalizada;
export function montarPayloadR2020(p: {
    cnpjPrestador?: string;
    competencia?: string;
    documentos?: unknown[];
    ajustes?: Record<string, unknown>;
}): any;
