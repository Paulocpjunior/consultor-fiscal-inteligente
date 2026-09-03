export const CST_COM_ST: Set<string>;

export interface ItemDifal {
    nItem: string;
    cProd: string;
    xProd: string;
    ncm: string;
    cfop: string;
    cst: string;
    orig: string;
    valorProduto: number;
    valorAquisicao: number;
    encargosRateados: boolean;
    vBC: number;
    vICMS: number;
    aliqIcms: number;
    vICMSST: number;
    temSt: boolean;
}

export function itemTemSt(item: unknown): boolean;
export function encargosDoItem(item: unknown, nota: unknown): {
    frete: number; seguro: number; outros: number; ipi: number; rateados: boolean;
};
export function linhasDeItem(nota: unknown): ItemDifal[];
export function classificarItensDifal(nota: unknown): {
    itens: ItemDifal[]; comSt: ItemDifal[]; semSt: ItemDifal[]; mista: boolean;
};

// 03/09 (auditoria): exportações que o .js já entregava e o .d.ts não declarava —
// importador TypeScript não enxergava o símbolo (erro de compilação).
export const UF_INTER_12: Set<string>;
export const ORIG_4PCT: Set<string>;
export function aliqInterestadualDoItem(item: unknown, ufOrigem: unknown): { aliq: number; derivada: boolean };
