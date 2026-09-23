export function federaisDoRelatorio(d: any, base: number, ajuste?: any): {
    fed: any; efetiva: any; ajustada: boolean; csllEhTotal: boolean; daOperacao: boolean;
    valores: { pis: number; cofins: number; csll: number; ir: number; inss: number;
        pccAgregado: number; contribuicoesAgregadas: boolean; origem: string; situacao: string };
};
