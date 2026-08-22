// Tipos do relatório de atendimento — o dono é o .js.
export interface RelatorioFila {
    fila: string;
    conversas: number;
    recebidas: number;
    enviadasHumanas: number;
    enviadasBot: number;
    respondidas: number;
    semRespostaHumana: number;
    tempoMedio1aRespostaMin: number | null;
}

export interface RelatorioAtendimento {
    conversasComMovimento: number;
    recebidas: number;
    enviadasHumanas: number;
    enviadasBot: number;
    semRespostaHumana: number;
    porFila: RelatorioFila[];
    porAtendente: { atendente: string; enviadas: number; conversas: number }[];
}

export function montarRelatorioAtendimento(p?: {
    mensagens?: Array<{
        conversaId?: string | null;
        direcao?: string | null;
        timestamp?: string | null;
        enviadoPor?: string | null;
    }>;
    filaPorConversa?: Map<string, string | null> | Record<string, string | null>;
}): RelatorioAtendimento;
