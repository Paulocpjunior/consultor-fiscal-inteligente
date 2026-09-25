/** Janela de 1 h da rodada completa de captura NF-e — a mesma do lock por CNPJ. */
export declare const JANELA_RODADA_COMPLETA_MS: number;

export interface LogRodada {
    tipo?: string | null;
    fonte?: string | null;
    status?: string | null;
    totalEmpresas?: number | null;
    iniciadoEm?: unknown;
    executadoEm?: unknown;
    [k: string]: unknown;
}

export declare function ehRodadaCompleta(log: LogRodada | null | undefined): boolean;
export declare function ehFonteManual(fonte: unknown): boolean;
export declare function fonteRetomavel(fonte: unknown): boolean;
export declare function ultimaRodadaCompleta(logs: LogRodada[] | null | undefined): { log: LogRodada; inicioMs: number } | null;
export declare function janelaDaRodadaCompleta(p?: { logs?: LogRodada[]; agoraMs?: number; janelaMs?: number }):
    { ok: true } | { ok: false; motivo: string; faltaMin: number; ultimaInicioMs: number; fonte: string };
export declare function classificarResultado(result: { ok?: boolean; locked?: boolean; [k: string]: unknown } | null | undefined): 'sucesso' | 'pulada-janela' | 'falha';
export declare function codigoDoResultado(result: Record<string, unknown> | null | undefined): string | null;

export interface ResumoRodadaEntrada {
    totalEmpresas?: number | null;
    sucessos?: number | null;
    falhas?: number | null;
    puladasJanela?: number | null;
    totalNovosXmls?: number | null;
    totalNovos?: number | null;
    errosResumo?: Array<{ codigo?: string | null; motivo?: string | null }> | null;
}
export declare function resumoDaRodada(r?: ResumoRodadaEntrada): string;
export declare function causaDominante(errosResumo: Array<{ codigo?: string | null; motivo?: string | null }> | null | undefined): string;
