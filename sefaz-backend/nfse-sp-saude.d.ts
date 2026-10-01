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

export const LIMITE_ERROS_RESUMO: number;

export function periodoCobreMesInteiro(periodo: { anoMes?: string; dataInicio?: string; dataFim?: string } | null | undefined): boolean;

export interface ZeroDaEmpresa {
    confiavel: boolean;
    via: 'falhou-na-rodada' | 'periodo-com-erro' | 'periodo-da-empresa' | 'rodada-geral' | 'sem-prova' | 'rodada-cobriu-a-empresa';
    motivo: string | null;
}

export function zeroConfiavelDaEmpresa(p?: {
    saude?: SaudeNfseSp | null;
    logs?: unknown[];
    state?: any;
    cnpj?: string;
    competencia?: string;
}): ZeroDaEmpresa;

export function zeroConfiavelParaCompetencia(p?: {
    saude?: SaudeNfseSp | null;
    logs?: unknown[];
    estados?: Map<string, any>;
    competencia?: string;
}): (cnpj: string) => ZeroDaEmpresa;
