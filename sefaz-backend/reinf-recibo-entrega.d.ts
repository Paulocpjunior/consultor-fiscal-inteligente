export function competenciaHumana(comp: string): string;

export interface SituacaoEntrega {
    situacao: 'entregue' | 'recusado' | 'sem-recibo';
    detalhe: string;
}

/** Protocolo = lote RECEBIDO. Recibo = evento PROCESSADO. Não são a mesma coisa. */
export function situacaoDaEntrega(e: unknown): SituacaoEntrega;

export interface LinhaEntrega extends SituacaoEntrega {
    evento: string;
    tipo: string | null;
    recibo: string | null;
    protocolo: string | null;
    transmitidoEm: string | null;
}

export interface ExtratoEntregas {
    competencia: string | null;
    competenciaHumana: string;
    empresa: { nome: string | null; cnpj: string | null };
    fechamento: { recibo: string | null; processadoEm: string | null } | null;
    linhas: LinhaEntrega[];
    resumo: { total: number; entregues: number; recusados: number; semRecibo: number };
    conferencia: any;
    farol: { cor: 'ok' | 'atencao' | 'falha'; resumo: string };
}

export function montarExtratoEntregas(p?: {
    competencia?: string;
    empresa?: { nome?: string; cnpj?: string };
    entregas?: unknown[];
    conferencia?: any;
    fechamento?: { recibo?: string; processadoEm?: string } | null;
}): ExtratoEntregas;

export function montarEmailFechamento(extrato: unknown): { assunto: string; corpo: string };
export function nomeArquivoExtrato(extrato: unknown): string;
export function totalConferido(conferencia: unknown): string | null;
