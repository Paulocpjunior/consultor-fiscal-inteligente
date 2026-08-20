export interface AlvoReconferencia {
    id: string;
    chave: string;
    numero: number | null;
    valorTotal: number;
    /** 0 = nunca perguntada; senão, epoch ms da última pergunta à SEFAZ. */
    conferidaEm: number;
}

export interface SelecaoReconferencia {
    aConsultar: AlvoReconferencia[];
    total: number;
    /** Quantas ainda não foram perguntadas NENHUMA vez — o que falta de verdade. */
    nuncaConferidas: number;
    cortadas: number;
    jaCanceladas: number;
    semChave: number;
    naoSaida: number;
    naoMod55: number;
}

export function selecionarParaReconferir(
    docs: any[],
    opts: {
        /** A régua da casa (`docCancelado`) — nunca uma cópia local. */
        jaCancelado: (d: any) => boolean;
        /** A régua da casa (`direcaoEfetivaDoc`). */
        direcaoEfetiva: (d: any) => string | undefined;
        limite?: number;
        /** Epoch ms da última pergunta a esta nota, ou 0/null se nunca perguntada. */
        conferidaEm?: (d: any) => number | null;
    },
): SelecaoReconferencia;

export interface LeituraCancelamento {
    situacao: 'cancelada' | 'nao-cancelada' | 'nao-cancelada-por-recusa' | 'indeterminado';
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
    selecao: {
        total: number; cortadas?: number; aConsultar?: unknown[]; nuncaConferidas?: number; naoMod55?: number;
    } | null | undefined;
    resultados: Array<{ situacao: string; valorTotal?: number }> | null | undefined;
    /** true na PRÉVIA: nenhuma consulta foi feita, então nada se diz no passado. */
    simulado?: boolean;
    /**
     * 'cert-escritorio': a pergunta saiu com o certificado do ESCRITÓRIO (empresa
     * sem A1 próprio) — 653 ainda prova cancelamento, mas nota válida da qual o
     * escritório não é parte fica indeterminada, nunca "tudo certo".
     */
    modo?: 'distdfe' | 'cert-escritorio';
}): {
    consultadas: number;
    canceladas: number;
    naoCanceladas: number;
    /** Prova NEGATIVA (cStat 640) — contada à parte da prova positiva (`naoCanceladas`). */
    naoCanceladasPorRecusa: number;
    indeterminadas: number;
    valorRemovido: number;
    avisos: string[];
};
