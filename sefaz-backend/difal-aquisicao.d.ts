export const ALIQ_INTERNA_PADRAO_SP: number;

export function aliqInterestadualDoItem(
    item: { aliqIcms?: number; orig?: string } | null | undefined,
    ufOrigem?: string,
): { aliq: number; derivada: boolean };

/** Detalhe POR ITEM — nada é aglutinado (Paulo, 04/08). */
export interface ItemLinhaDifal {
    nItem: string;
    cProd: string;
    xProd: string;
    ncm: string;
    cfop: string;
    cst: string;
    /** consolidado */
    base?: number;
    aliqInterestadual?: number;
    aliqInterDerivada?: boolean;
    difal?: number;
    /** 426-A */
    valorAquisicao?: number;
    icmsPago?: number;
    aliqIcms?: number;
    orig?: string;
    encargosRateados?: boolean;
}

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
    /** Itens que ENTRARAM nesta linha (sem ST no consolidado, com ST no 426-A). */
    itens: ItemLinhaDifal[];
    itensConsiderados: number;
    itensTotal: number;
    /** A nota tem itens COM e SEM ST — aparece nas duas listas, e não é duplicidade. */
    notaMista: boolean;
    /** ST no total da nota sem destaque por item — foi inteira ao 426-A, confira. */
    stSemDetalhePorItem?: boolean;
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
