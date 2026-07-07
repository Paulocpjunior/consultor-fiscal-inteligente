export interface ModeloDebitosMit {
    codigoPorFamilia: Record<string, { codigo: string; grupo: string }>;
    totalDebitos: number;
}

export interface MontagemDebitosMit {
    ok: boolean;
    erros: string[];
    debitos: Record<string, { ListaDebitos: Array<{ IdDebito: number; CodigoDebito: string; ValorDebito: number }> }> | null;
    mapeamento: Array<{ familia: string; codigo: string; grupo: string; valor: number }>;
    totalProposto: number;
}

export function extrairModeloDebitosMit(apuracaoModelo: any): ModeloDebitosMit;

export function montarDebitosMit(
    tributosApp: { IRPJ?: number; CSLL?: number; PIS?: number; COFINS?: number } | null | undefined,
    modelo: ModeloDebitosMit | null | undefined,
): MontagemDebitosMit;
