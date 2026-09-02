export type FormaDoSegredo = 'vazio' | 'id-secreto' | 'com-espaco-ou-quebra' | 'nao-reconhecida';

/**
 * Que forma tem o segredo gravado. O valor NUNCA sai daqui — só a forma, o
 * comprimento e o diagnóstico.
 *
 * ⚠️ `'nao-reconhecida'` não é aprovação: segredo com a forma certa e do app
 * ERRADO recusa igual, e isso nenhuma medição de forma alcança.
 */
export function formaDoClientSecret(valor?: unknown): {
    forma: FormaDoSegredo;
    caracteres: number;
    ehProblema: boolean;
    diagnostico: string | null;
};

/** As envs de client secret do Azure, achadas por VARREDURA (`*_CLIENT_SECRET`). */
export function segredosDeClientSecret(env?: Record<string, unknown>): string[];
