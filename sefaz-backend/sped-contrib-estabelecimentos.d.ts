export function raizDoCnpj(v: unknown): string;
export function conferirFiliaisContrib(p: {
    matrizCnpj: string;
    filiais: unknown;
    cadastradas: Array<{ cnpj?: string; nome?: string; dadosFiscais?: { uf?: string; codMunIBGE?: string }; _deleted?: boolean; _merged_into?: string }>;
}): { ok: true; filiais: string[] } | { ok: false; erros: string[] };
export function estabelecimentoDoDoc(doc: any, cnpjsDoArquivo: string[], cnpjDaCarga: string): string;
export function repartirPorEstabelecimento(carregados: Array<{ doc: any; cnpjDaCarga: string }>, cnpjsDoArquivo: string[]): Map<string, any[]>;
export function identidadeDoEstabelecimento(matriz: any, filial: any): any;
export function blocoPorEstabelecimento(
    bloco: string, visoes: any[], gerar: (dados: any) => string[], buildLine: (campos: Array<string | number>) => string,
): string[];
export function visoesPorEstabelecimento(dados: any): any[];
