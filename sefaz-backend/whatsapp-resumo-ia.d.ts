// Tipos do resumo por IA (o .js é o dono; acompanha no MESMO PR).
export const MAX_MENSAGENS_RESUMO: number;
export const MAX_CHARS_POR_MENSAGEM: number;
export const TEMPO_MAX_RESUMO_MS: number;
export const MAX_CHARS_RESUMO: number;

export interface MensagemParaResumo { quem: 'cliente' | 'SP'; quando: string; texto: string }
export interface ResumoIa { texto: string; pendencias: string[]; assuntos: string[]; tom: 'ok' | 'atencao' }

export function selecionarMensagensParaResumo(
    mensagens: Array<{ direcao?: string | null; tipo?: string | null; texto?: string | null; timestamp?: string | null }>,
    limite?: number,
): MensagemParaResumo[];
export function montarPromptResumo(p: { mensagens: MensagemParaResumo[]; nomeCliente?: string | null; empresaNome?: string | null }): string;
export function interpretarResumo(bruto: string | null | undefined): { ok: true; resumo: ResumoIa } | { ok: false; motivo: string };
export function estadoDoResumo(conversa: {
    resumoIa?: { texto?: string; ateMensagemEm?: string | null } | null;
    ultimaMensagem?: { em?: string | null } | null;
} | null | undefined): 'nenhum' | 'desatualizado' | 'atual';
