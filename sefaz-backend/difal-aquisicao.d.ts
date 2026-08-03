export const ALIQ_INTERNA_PADRAO_SP: number;

export function aliqInterestadualDoItem(
    item: { aliqIcms?: number; orig?: string } | null | undefined,
    ufOrigem?: string,
): { aliq: number; derivada: boolean };

export interface LinhaDifal {
    chave: string;
    numero: string;
    dhEmi: string | null;
    fornecedor: string;
    fornecedorDoc: string;
    ufOrigem: string;
    base: number;
    aliqInterna: number;
    aliqInterDerivada: boolean;
    difal: number;
}

export interface DifalMensal {
    linhas: LinhaDifal[];
    totalBase: number;
    totalDifal: number;
    antecipacaoIndividual: LinhaDifal[];
    avisos: string[];
    ressalvas: string[];
}

export function montarDifalMensal(p: {
    docs: Array<Record<string, unknown>>;
    empresa: { cnpj?: string; uf?: string };
    aliqInternaPadrao?: number;
    aliqInternaPorChave?: Record<string, number>;
}): DifalMensal;
