export declare const LEIAUTES_BLOCO_K: Record<string, string>;
export declare const IND_EST_VALIDOS: string[];
export declare const TIPOS_ITEM_ESTOQUE: string[];

export function quantidadeInformada(v: unknown): boolean;

export interface ExigenciaBlocoK {
    exige: boolean;
    motivo: 'simples-dispensado' | 'nao-marcado' | 'sem-leiaute' | 'ok';
    leiaute: string | null;
    texto: string | null;
}
export function exigenciaBlocoK(p?: {
    regime?: string;
    entregaBlocoK?: boolean;
    leiauteBlocoK?: string;
}): ExigenciaBlocoK;

export function exigeInsumos(leiaute: unknown): boolean;
export function exigeProducao(leiaute: unknown): boolean;

export interface EstoqueBlocoK {
    codItem: string;
    qtd: number;
    indEst: string;
    codPart: string;
}
export interface InsumoBlocoK {
    dtSaida: string;
    codItem: string;
    qtd: number;
    codInsSubst: string;
}
export interface ProducaoBlocoK {
    dtIniOp: string;
    dtFinOp: string;
    codDocOp: string;
    codItem: string;
    qtdEnc: number;
    insumos: InsumoBlocoK[];
}
export function planejarBlocoK(p?: {
    estoques?: unknown[];
    producao?: unknown[];
    leiaute?: unknown;
    itensDo0200?: Set<string> | string[];
    tipoPorItem?: Record<string, unknown>;
}): {
    estoqueOk: EstoqueBlocoK[];
    producaoOk: ProducaoBlocoK[];
    avisos: string[];
    comDados: boolean;
};

export function montarBlocoK(p?: {
    exigencia?: ExigenciaBlocoK | null;
    estoques?: unknown[];
    producao?: unknown[];
    dtIni?: string;
    dtFin?: string;
    itensDo0200?: Set<string> | string[];
    tipoPorItem?: Record<string, unknown>;
}): {
    linhas: (string | number)[][];
    avisos: string[];
    indMov: '0' | '1';
};

/**
 * Obrigatoriedade de cada registro por leiaute — tabela EXTRAÍDA do Guia 3.2.3
 * (seção do K010). ⚠️ O simplificado NÃO desobriga tudo: K220, K250, K270,
 * K280, K290/K291 e K300/K301 continuam obrigatórios nele.
 */
export declare const OBRIGATORIEDADE_POR_LEIAUTE: Record<
    string,
    { completo: boolean; simplificado: boolean }
>;

/** Os registros que este módulo monta — a espinha. */
export declare const REGISTROS_GERADOS: string[];

/**
 * O que o leiaute escolhido exige e este módulo não monta. Lista VAZIA no
 * leiaute 2 (restrito aos saldos), onde a espinha já é o bloco inteiro.
 */
export function registrosExigidosQueFaltam(leiaute: string | null | undefined): string[];
