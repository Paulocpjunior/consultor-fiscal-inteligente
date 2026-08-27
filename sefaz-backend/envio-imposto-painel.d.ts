export interface PendenciaEnvio {
    causa: string;
    acao: string;
}

export function pendenciaSharePoint(envio: unknown): PendenciaEnvio | null;
export function pendenciaBaixa(envio: unknown): PendenciaEnvio | null;

/** Envio pelo SERVIDOR prova que saiu: 'email-graph' e 'whatsapp-api'. */
export function canalComprovaEnvio(canal?: string | null): boolean;

export interface RitoDoEnvio {
    completo: boolean;
    naoConferido: boolean;
    pendencias: PendenciaEnvio[];
    /** Outro envio da MESMA obrigação já deu a baixa (reenvio da mesma guia). */
    baixaJaFeitaNaObrigacao: boolean;
}

export function envioCompletoPeloRito(
    envio: unknown,
    opts?: { baixaJaFeitaNaObrigacao?: boolean },
): RitoDoEnvio;

/** A obrigação a que o envio se refere: empresa + tipo + competência. */
export function chaveDaObrigacao(envio: unknown): string;

/**
 * A BAIXA é da OBRIGAÇÃO, o ARQUIVO é do ENVIO — reenvio da mesma guia não é
 * pendência (não há segunda baixa a dar), mas pendência de SharePoint continua
 * sendo, porque cada envio tem o seu arquivo.
 */
export function conferirRitoDosEnvios(
    envios: unknown[],
): Array<RitoDoEnvio & { envio: unknown; chave: string }>;

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
    /** Reenvios da mesma guia — a baixa já estava dada por outro envio. */
    reenvios: number;
    valorTotal: number;
    farol: 'ok' | 'atencao' | 'vazio';
    resumo: string;
}

export function montarPainelEnvios(
    envios: unknown[],
    opts?: { competencia?: string | null },
): PainelEnviosResultado;
