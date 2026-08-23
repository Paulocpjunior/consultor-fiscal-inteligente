// Tipos da sonda de chamada de voz/vídeo — o dono é o .js.
export interface SituacaoSonda {
    situacao: 'ligado' | 'desligado' | 'nao-declarado' | 'nao-reconhecido' | 'sem-permissao' | 'indeterminado';
    campo?: string;
    candidato?: string;
    motivo: string;
    acao?: string;
    bruto?: unknown;
}

export const CANDIDATOS_SONDA: {
    id: string; rotulo: string; caminho: (phoneNumberId: string) => string; hipotese: string;
}[];
export const ANTES_DE_LIGAR: { titulo: string; texto: string }[];

export function acharBlocoDeChamada(corpo: unknown): { caminho: string; valor: unknown }[];
export function interpretarSondaChamadas(status: number | null | undefined, corpo: unknown): SituacaoSonda;
export function concluirSonda(resultados?: SituacaoSonda[]): {
    veredito: SituacaoSonda['situacao'];
    motivo: string;
    acao?: string;
    respondeuPor?: string | null;
};

// ── Configuração (Paulo, 23/08): payloads e conferências — a escrita é da rota.
export interface CallHoursMeta {
    status: 'ENABLED';
    timezone_id: string;
    weekly_operating_hours: { day_of_week: string; open_time: string; close_time: string }[];
}
export function montarCallHoursDoAtendimento(horario: unknown):
    { ok: true; callHours: CallHoursMeta } | { ok: false; erro: string };
export function validarSipDestino(entrada: { hostname?: string; porta?: number | string } | null | undefined):
    { ok: true; hostname: string; porta: number } | { ok: false; erro: string };
export function montarPayloadChamadas(mudanca?: {
    callHours?: CallHoursMeta; iconeVisivel?: boolean; sip?: { hostname: string; porta: number };
}): { ok: true; payload: { calling: Record<string, unknown> } } | { ok: false; erro: string };
export function lerCallingDasSettings(corpo: unknown): Record<string, unknown> | null;
export function conferirCallHours(callingGravado: unknown, horario: unknown):
    { situacao: 'igual' | 'diverge' | 'sem-call-hours' | 'horario-ilegivel'; motivo: string };
