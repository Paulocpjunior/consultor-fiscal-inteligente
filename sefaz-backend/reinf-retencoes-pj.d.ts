/**
 * Tipos mínimos para o frontend importar a régua ÚNICA das retenções federais
 * nas DUAS formas de gravação (achatada do portal × objeto do XML).
 */

export interface RetencoesFederaisDoDoc {
    ir?: number;
    pis?: number;
    cofins?: number;
    /** No export do portal este campo é o TOTAL das três (CSRF), não a CSLL. */
    csllOuTotal?: number;
    inss?: number;
}

/** Lê as duas formas; campo ausente em ambas volta undefined (ausente ≠ zero). */
export function lerRetencoesFederaisDoDoc(d: unknown): RetencoesFederaisDoDoc;

// Retornos `any` de propósito: os consumidores existentes (testes e rotas)
// acessam o payload livremente — o tipo forte aqui é só o do leitor novo.
export function normalizarNotaTomada(d: unknown): any;

export function montarPayloadReinfPJ(p?: {
    cnpjTomador?: string;
    competencia?: string;
    documentos?: unknown[];
}): any;
