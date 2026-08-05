export interface PendenciaEnvio {
    causa: string;
    acao: string;
}

export function pendenciaSharePoint(envio: unknown): PendenciaEnvio | null;
export function pendenciaBaixa(envio: unknown): PendenciaEnvio | null;

/** Só 'email-graph' (envio pelo servidor) prova que a mensagem saiu. */
export function canalComprovaEnvio(canal?: string | null): boolean;

export interface PainelEnviosResultado {
    competencia: string | null;
    total: number;
    completos: number;
    incompletos: number;
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
