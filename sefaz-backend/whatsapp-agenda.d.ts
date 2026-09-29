// Tipos da agenda de mensagens (o .js é o dono; este arquivo acompanha no
// MESMO PR — regra de 20/08).
export const COLECAO_AGENDAMENTOS: string;
export const TIPOS_AGENDAMENTO: string[];
export const STATUS_AGENDAMENTO: string[];
export const MAX_DIAS_AGENDAMENTO: number;
export const MAX_HORAS_FOLLOW_UP: number;
export const MIN_ANTECEDENCIA_MS: number;
export const LOTE_TICK_AGENDA: number;
export const FUSO_SP: string;

export type TipoAgendamento = 'mensagem' | 'follow-up';
export type StatusAgendamento = 'agendado' | 'enviado' | 'cancelado' | 'dispensado' | 'falhou';

export interface Agendamento {
    id: string;
    conversaId: string;
    tipo: TipoAgendamento;
    texto: string;
    enviarEm: string;
    aposHoras: number | null;
    status: StatusAgendamento;
    criadoEm: string;
    criadoPor: string | null;
    tentativas: number;
    ultimoErro: string | null;
    enviadoEm: string | null;
    messageId: string | null;
    desfecho: string | null;
}

export interface DecisaoAgendamento {
    acao: 'nada' | 'esperar' | 'dispensar' | 'falhar' | 'enviar';
    motivo: string;
    detalhe?: string;
}

export function validarAgendamento(p: {
    conversaId: string; texto: string; tipo?: TipoAgendamento; enviarEm?: string | null;
    aposHoras?: number | null; agora: Date | string; criadoPor?: string | null;
}): { ok: true; agendamento: Agendamento } | { ok: false; erro: string };
export function idDoAgendamento(conversaId: string, enviarEmIso: string): string;
export function janelaAberta(conversa: { janela24hAte?: string | null } | null | undefined, agora: Date | string | number): boolean;
export function decidirAgendamento(
    ag: Partial<Agendamento> | null | undefined,
    conversa: { janela24hAte?: string | null; status?: string | null; ultimaMensagem?: { direcao?: string; em?: string } | null } | null | undefined,
    agora: Date | string | number,
): DecisaoAgendamento;
export function formatarQuando(iso: string | null | undefined, fuso?: string): string;
export function notaDoAgendamento(ag: Partial<Agendamento>, fuso?: string): string;
export function notaDoDesfecho(ag: Partial<Agendamento>, decisao: DecisaoAgendamento, fuso?: string): string;
export function resumoDoAgendamento(ag: Partial<Agendamento> & { id: string }): {
    id: string; tipo: string; texto: string; enviarEm: string; aposHoras: number | null; status: string;
    criadoPor: string | null; criadoEm: string | null; desfecho: string | null; ultimoErro: string | null;
};
