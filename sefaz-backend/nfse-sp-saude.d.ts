export const MAX_IDLE_HORAS: number;

export interface SaudeNfseSp {
    farol: 'ok' | 'atencao' | 'quebrado';
    motivo: string;
    acao: string | null;
    /** Só é seguro concluir "não houve nota" quando true. */
    zeroConfiavel: boolean;
    ultimaExecucaoMs: number;
    ultimoSucessoMs: number;
    horasSemRodar: number | null;
    erroDominante?: string | null;
}

export function saudeNfseSp(logs: unknown[], agora?: number): SaudeNfseSp;

export function empresaComFalhaNaCaptura(
    logs: unknown[], cnpj: string,
): { erro: string; ccm: string | null } | null;
