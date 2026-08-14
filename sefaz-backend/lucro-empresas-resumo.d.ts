/**
 * Lista LEVE das empresas do Lucro — cadastro, sem a ficha financeira.
 *
 * O `.d.ts` entra NO MESMO PR que o módulo: foi a falta dele que derrubou o
 * deploy 487 (o teste importava a função e o typecheck do CI não a conhecia).
 */

/** Campos pedidos no `.select()` da rota. */
export const CAMPOS_RESUMO: string[];

export interface LucroEmpresaResumoItem {
    id: string;
    nome: string | null;
    cnpj: string | null;
    uf: string | null;
    regimePadrao: 'Presumido' | 'Real' | null;
    codCliente: string | null;
    /** CONTAGEM de fichas — é ela que o selo de duplicata usa. Nunca o array. */
    fichas: number;
    capturarSefaz: boolean;
}

export interface LucroResumoMontado {
    empresas: LucroEmpresaResumoItem[];
    total: number;
    ocultas: { excluidas: number; fundidas: number };
    semFichaFinanceira: true;
}

export function lapideDaEmpresa(
    d: { _deleted?: unknown; _merged_into?: unknown } | null | undefined,
): 'excluida' | 'fundida' | null;

export function montarResumoLucro(
    docs?: Array<{ id: string; data: Record<string, unknown> }>,
): LucroResumoMontado;
