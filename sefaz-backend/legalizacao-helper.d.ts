// Tipos do legalizacao-helper.js (consumido pelos testes TS e pelo espelho
// frontend services/legalizacaoLogic.ts).

export declare const FAIXAS_ALERTA: number[];
export declare const DIAS_VENCIDO_HISTORICO: number;
export declare const CATEGORIA_LABEL: Record<string, string>;

export declare function classificarVencimento(
    diasRestantes: number | null | undefined,
): 'sem_data' | 'vencido' | 'critico' | 'atencao' | 'ok';

export declare function faixaAlertaDevida(
    diasRestantes: number | null | undefined,
    faixas?: number[],
): number | 'vencido' | null;

export declare function acaoPratica(categoria: string): string;
export declare function fmtCnpj(cnpj: string | null | undefined): string;
export declare function fmtDataBr(iso: string | null | undefined): string;

export declare function montarEmailAlerta(p: {
    categoria: string;
    tipoDetalhe?: string | null;
    empresaNome: string;
    cnpj?: string | null;
    dataVencimento: string;
    diasRestantes: number;
}): { assunto: string; corpoHtml: string };

export declare function resumirPorFarol(
    itens: Array<{ categoria?: string; diasRestantes: number | null }>,
): Record<string, { total: number; vencido: number; critico: number; atencao: number; ok: number; sem_data: number }>;
