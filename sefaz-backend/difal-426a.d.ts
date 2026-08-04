export interface ResultadoAntecipacao426A {
    calculavel: boolean;
    motivo: string | null;
    va: number;
    ic: number;
    aliqInterna: number;
    aliqInterestadual: number;
    ivaSt: number;
    ivaAplicado: number;
    ivaFoiAjustado?: boolean;
    baseSt: number;
    antecipacao: number;
}

export interface LinhaAntecipacao426A extends ResultadoAntecipacao426A {
    chave: string;
    numero: string;
    dhEmi: string | null;
    fornecedor: string;
    ufOrigem: string;
}

export interface ApuracaoAntecipacoes426A {
    calculadas: LinhaAntecipacao426A[];
    pendentes: LinhaAntecipacao426A[];
    totalAntecipacao: number;
    resumo: { documentos: number; calculados: number; pendentes: number };
    ressalvas: string[];
}

export function valorAquisicao(doc: unknown): number;
export function impostoCobradoAnterior(doc: unknown): number;
export function ivaStAjustado(ivaStOriginal: number, aliqInter: number, aliqIntra: number): number;
export function calcularAntecipacao426A(doc: unknown, p?: {
    ivaSt?: number;
    ivaJaAjustado?: boolean;
    aliqInterna?: number;
    aliqInterestadual?: number;
}): ResultadoAntecipacao426A;
export function apurarAntecipacoes426A(
    documentos: unknown[],
    parametrosPorChave?: Record<string, { ivaSt?: number; ivaJaAjustado?: boolean; aliqInterna?: number; aliqInterestadual?: number }>,
    aliqInternaPadrao?: number,
): ApuracaoAntecipacoes426A;

export interface ItemAntecipacao426A extends ResultadoAntecipacao426A {
    nItem: string;
    cProd: string;
    xProd: string;
    ncm: string;
    cfop: string;
    cst: string;
    encargosRateados: boolean;
}

export interface DocumentoAntecipacao426A {
    chave: string;
    numero: string;
    dhEmi: string | null;
    fornecedor: string;
    ufOrigem: string;
    notaMista: boolean;
    itens: ItemAntecipacao426A[];
    itensPendentes: number;
    guiaLiberada: boolean;
    antecipacaoDocumento: number;
}

export function apurarAntecipacoes426APorItem(
    linhasComSt: unknown[],
    ivaPorItem?: Record<string, { ivaSt?: number; ivaJaAjustado?: boolean; aliqInterna?: number }>,
    aliqInternaPadrao?: number,
): {
    documentos: DocumentoAntecipacao426A[];
    totalAntecipacao: number;
    resumo: {
        documentos: number; documentosCompletos: number;
        itensCalculados: number; itensPendentes: number;
    };
    ressalvas: string[];
};
