export const MOTIVO_MINIMO: number;
export interface DeclaracaoSemMovimento { comoFoi: string; quando: string; declaradoPor: string }
export function podeDeclararSemMovimento(p?: { documentos?: unknown[]; captura?: any }): boolean;
export function conferirDeclaracaoSemMovimento(p?: { comoFoi?: unknown; quando?: unknown; quem?: unknown; hojeIso?: string }):
    { ok: true; declaracao: DeclaracaoSemMovimento } | { ok: false; erro: string };
export function textoDaDeclaracaoSemMovimento(d: DeclaracaoSemMovimento | null | undefined): string;
export function aplicarSemMovimentoDeclarado(p: { captura: any; validacao: any; documentos?: unknown[]; declaracao?: DeclaracaoSemMovimento | null }):
    { captura: any; validacao: any; aplicada: boolean; caiu: boolean };
