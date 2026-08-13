export function normalizarAquisicao(n: unknown): Record<string, unknown>;

export function montarPayloadR2055(p?: {
    cnpjAdquirente?: string;
    competencia?: string;
    funrural?: unknown;
    produtores?: Record<string, unknown>;
}): Record<string, any>;

/**
 * De-para PROVADO contra o recibo do R-2099 aceito (VINCENZO 07/2026, MS7001):
 * 1656-01 = INSS · 1646-03 = GILRAT · 1213-06 = SENAR.
 */
export const CODIGOS_RECEITA_FUNRURAL: {
    inss: string;
    gilrat: string;
    senar: string;
};

export interface LinhaTotalizadorR2099 {
    componente: 'inss' | 'gilrat' | 'senar';
    rotulo: string;
    codigoReceita: string;
    apurado: number;
    /** Nulo quando a Receita NÃO totalizou o código — ausente não é zero. */
    totalizado: number | null;
    confere: boolean;
    diferenca: number | null;
}

export function conferirTotalizadorR2099(p?: {
    apurado?: { inss?: number; gilrat?: number; senar?: number };
    totalizador?: Array<{ codigoReceita?: string; valor?: number }>;
}): {
    situacao: 'confere' | 'divergente' | 'nao-conferido';
    linhas: LinhaTotalizadorR2099[];
    codigosDesconhecidos: Array<{ codigoReceita: string; valor: number }>;
    resumo: string;
};
