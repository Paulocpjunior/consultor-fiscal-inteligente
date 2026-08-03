export interface BemCiapEntrada {
    codigo?: string;
    descricao?: string;
    tipo?: 'bem' | 'componente';
    codigoBemPrincipal?: string;
    dataMovimentacao?: string;
    tipoMovimentacao?: string;
    creditoIcmsProprio?: number;
    creditoIcmsSt?: number;
    creditoIcmsFrete?: number;
    creditoIcmsDifal?: number;
    numeroParcela?: number;
    funcao?: string;
}

export interface BemCiapApurado extends BemCiapEntrada {
    creditoTotal: number;
    valorParcela: number;
}

export interface ApuracaoCiap {
    bens: BemCiapApurado[];
    saldoInicial: number;
    somaParcelas: number;
    saidasTributadas: number;
    saidasTotais: number;
    indice: number;
    creditoApropriado: number;
    outrosCreditos: number;
    avisos: string[];
}

export const PARCELAS_CIAP: number;
export const TIPOS_MOVIMENTACAO: Record<string, string>;

export function indiceParticipacao(tributadasEExportacao: number, totalSaidas: number): number;
export function creditoTotalDoBem(bem: BemCiapEntrada): number;
export function parcelaPassivel(bem: BemCiapEntrada): number;
export function classificarSaidasCiap(documentos: unknown[]): {
    tributadasEExportacao: number;
    total: number;
};
export function apurarCiap(p: {
    bens: BemCiapEntrada[];
    saldoInicial: number;
    saidasTributadas: number;
    saidasTotais: number;
    outrosCreditos?: number;
}): ApuracaoCiap;
export function montarLinhasBlocoG(p: {
    apuracao: ApuracaoCiap;
    dtIni: string;
    dtFin: string;
}): string[];
