export function normalizarCompetencia(mes: unknown): string | null;

export function calcularIpiApuradoFicha(ficha: { ipiRecolher?: number; saldoCredorIpi?: number } | null | undefined): number;

export function acharFichaCompetencia<T extends { mesReferencia?: string }>(
    fichaFinanceira: T[] | null | undefined,
    competencia: string,
): T | null;

export interface ClassificacaoIpiEmpresa {
    status: 'pronta' | 'precisa_lancamento' | 'erro_consulta' | 'sem_ipi';
    titulo: string;
    acao: string;
    prioridade: number;
}

export function classificarIpiEmpresa(args: {
    ipiApurado: number;
    temModeloIpi: boolean;
    erroConsulta?: string | null;
}): ClassificacaoIpiEmpresa;

export interface ResumoVarreduraIpi {
    total: number;
    comIpi: number;
    pronta: number;
    precisaLancamento: number;
    erroConsulta: number;
    semIpi: number;
    ipiTotalApurado: number;
    ipiTotalEmRisco: number;
}

export function resumirVarreduraIpi(linhas: Array<{ status: string; ipiApurado?: number }>): ResumoVarreduraIpi;
