// Tipos da presença (o .js é o dono; este arquivo anda junto — regra de
// 20/08: `.d.ts` à mão e implementação são duas declarações do mesmo fato e
// divergem em silêncio se andarem separadas).
export const JANELA_NO_AR_MS: number;
export const INTERVALO_SINAL_MS: number;

export type SituacaoPresenca = 'no-ar' | 'sem-sinal' | 'sem-registro';

export interface LeituraDaPresenca {
    situacao: SituacaoPresenca;
    /** Frase pronta — "no ar agora", "sem sinal há 20 min". NUNCA "offline". */
    texto: string;
    minutos: number | null;
}

export interface AtendenteDaFila {
    email: string | null;
    nome?: string | null;
    /** `null` = vê TODAS as filas (gestor, Recepção, dono). */
    filas: string[] | null;
}

export interface PresencaDaFila {
    fila: string;
    total: number;
    noAr: number;
    pessoas: (LeituraDaPresenca & { email: string | null; nome: string })[];
    /** Só existe quando há o que avisar — fila coberta não ganha alarme. */
    aviso: string | null;
}

export function situacaoDaPresenca(
    ultimoSinal: string | { toMillis(): number } | null | undefined,
    agora?: number,
    janela?: number,
): LeituraDaPresenca;

export function quemDaFilaEstaNoAr(p: {
    fila: string;
    atendentes?: AtendenteDaFila[];
    /** e-mail (minúsculo) → carimbo do último sinal. */
    presencas?: Record<string, string | null | undefined>;
    agora?: number;
}): PresencaDaFila;
