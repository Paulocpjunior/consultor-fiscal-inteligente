export interface PendenciaEnvio {
    causa: string;
    acao: string;
}

export function pendenciaSharePoint(envio: unknown): PendenciaEnvio | null;
export function pendenciaBaixa(envio: unknown): PendenciaEnvio | null;

/** Envio pelo SERVIDOR prova que saiu: 'email-graph' e 'whatsapp-api'. */
export function canalComprovaEnvio(canal?: string | null): boolean;

export interface PainelEnviosResultado {
    competencia: string | null;
    total: number;
    completos: number;
    incompletos: number;
    /** Envios sem registro das etapas do rito — nem completos, nem pendência. */
    naoConferidos: string[];
    porTipo: Record<string, number>;
    pendencias: Record<string, { qtd: number; acao: string; empresas: string[] }>;
    semGestorEmCopia: string[];
    semProvaDeEnvio: string[];
    enviadosPeloServidor: number;
    valorTotal: number;
    farol: 'ok' | 'atencao' | 'vazio';
    resumo: string;
}

export function montarPainelEnvios(
    envios: unknown[],
    opts?: { competencia?: string | null },
): PainelEnviosResultado;
