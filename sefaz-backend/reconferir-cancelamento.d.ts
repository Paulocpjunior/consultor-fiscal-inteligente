export interface AlvoReconferencia {
    id: string;
    chave: string;
    numero: number | null;
    valorTotal: number;
}

export interface SelecaoReconferencia {
    aConsultar: AlvoReconferencia[];
    total: number;
    cortadas: number;
    jaCanceladas: number;
    semChave: number;
    naoSaida: number;
}

export function selecionarParaReconferir(
    docs: any[],
    opts: {
        /** A régua da casa (`docCancelado`) — nunca uma cópia local. */
        jaCancelado: (d: any) => boolean;
        /** A régua da casa (`direcaoEfetivaDoc`). */
        direcaoEfetiva: (d: any) => string | undefined;
        limite?: number;
    },
): SelecaoReconferencia;

export interface LeituraCancelamento {
    situacao: 'cancelada' | 'nao-cancelada' | 'indeterminado';
    motivo: string;
    cStat?: string;
    evento?: {
        tpEvento: string;
        tipo: string;
        cStat: string;
        dhEvento: string | null;
        nProt: string | null;
        xJust: string | null;
    };
}

export function lerRespostaCancelamento(resp: unknown): LeituraCancelamento;

export function resumirReconferencia(p: {
    selecao: { total: number; cortadas: number; aConsultar: unknown[] } | null | undefined;
    resultados: Array<{ situacao: string; valorTotal?: number }> | null | undefined;
    /** true na PRÉVIA: nenhuma consulta foi feita, então nada se diz no passado. */
    simulado?: boolean;
}): {
    consultadas: number;
    canceladas: number;
    naoCanceladas: number;
    indeterminadas: number;
    valorRemovido: number;
    avisos: string[];
};
