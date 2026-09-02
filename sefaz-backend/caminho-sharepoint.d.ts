export declare const PASTA_RAIZ: string;
export declare const DEPARTAMENTO_FISCAL: string;
export declare const MESES_PT: string[];

/** Tira acento, baixa a caixa e colapsa espaço — para COMPARAR, nunca para gravar. */
export function normalizar(texto?: unknown): string;

/** '9' | '09' → 'Setembro'. Fora de 1..12 devolve `null` (nunca chuta). */
export function nomeDoMes(mes?: unknown): string | null;

/**
 * As formas em que o mês pode APARECER numa pasta escrita à mão — a árvore
 * real tem `Jan`, `Fev` e `Out` ao lado de `Setembro` e `Novembro`.
 */
export function apelidosDoMes(mes?: unknown, ano?: unknown): string[];

/** O código no começo do nome da pasta; `null` quando não há. */
export function codigoDaPasta(nome?: unknown): string | null;

/**
 * Acha a pasta da empresa pelo CÓDIGO. Dois candidatos NÃO viram escolha
 * silenciosa — devolve `'ambigua'` com as duas.
 */
export function acharPastaDaEmpresa(
    pastas?: Array<string | { nome?: string }>,
    codCliente?: unknown,
): {
    situacao: 'ok' | 'nao-encontrada' | 'ambigua' | 'codigo-ausente';
    pasta: string | null;
    candidatas: string[];
};

/** Acha uma pasta por qualquer nome aceito; devolve o nome REAL da pasta. */
export function acharPastaPorNome(
    pastas?: Array<string | { nome?: string }>,
    aceitos?: string[],
): string | null;

/** `Empresas/{pasta}/Departamento Fiscal/{ano}/{Mês}/XML SAÍDA`. */
export function caminhoFiscal(args: {
    pastaEmpresa?: string | null;
    ano?: string | number | null;
    mes?: string | number | null;
    direcao?: 'SAÍDA' | 'ENTRADA';
}): string | null;

/** Uma folha qualquer dentro do mês — dono ÚNICO da árvore. */
export function caminhoDaFolha(args: {
    pastaEmpresa?: string | null;
    ano?: string | number | null;
    mes?: string | number | null;
    folha?: string | null;
}): string | null;

/** A pasta dos RECIBOS da REINF — irmã de IMPOSTOS. */
export function caminhoRecibos(args: {
    pastaEmpresa?: string | null;
    ano?: string | number | null;
    mes?: string | number | null;
}): string | null;

/** A pasta das guias do rito, no mesmo mês do fiscal. */
export function caminhoImpostos(args: {
    pastaEmpresa?: string | null;
    ano?: string | number | null;
    mes?: string | number | null;
}): string | null;
