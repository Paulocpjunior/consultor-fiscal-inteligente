export interface ModeloDebitosMit {
    // cnpjEstabelecimento só vem para IPI (apurado por estabelecimento).
    codigoPorFamilia: Record<string, { codigo: string; grupo: string; cnpjEstabelecimento?: string }>;
    totalDebitos: number;
}

export interface MontagemDebitosMit {
    ok: boolean;
    erros: string[];
    // CnpjEstabelecimento presente apenas nos débitos de IPI.
    debitos: Record<string, { ListaDebitos: Array<{ IdDebito: number; CodigoDebito: string; ValorDebito: number; CnpjEstabelecimento?: string }> }> | null;
    mapeamento: Array<{ familia: string; codigo: string; grupo: string; valor: number; cnpjEstabelecimento?: string }>;
    totalProposto: number;
}

export function extrairModeloDebitosMit(apuracaoModelo: any): ModeloDebitosMit;

export function montarDebitosMit(
    tributosApp: { IRPJ?: number; CSLL?: number; PIS?: number; COFINS?: number; IPI?: number } | null | undefined,
    modelo: ModeloDebitosMit | null | undefined,
    opts?: { apenasFamilias?: string[]; idInicial?: number; empresaCnpj?: string },
): MontagemDebitosMit;

export function maiorIdDebitoMit(debitos: any): number;

export function mesclarDebitosMit(existentes: any, novos: any): Record<string, { ListaDebitos: any[] }>;

// 03/09 (auditoria): exportações que o .js já entregava e o .d.ts não declarava —
// importador TypeScript não enxergava o símbolo (erro de compilação).
export function montarDebitosRetificacaoMit(...args: any[]): any;
export const ORDEM_DEBITOS_MIT: readonly string[];
export const FAMILIAS: Record<string, any>;
export function sufixoEstabelecimento(...args: any[]): string;
