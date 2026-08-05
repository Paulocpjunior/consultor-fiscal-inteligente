export function dominiosPermitidos(env?: Record<string, string | undefined>): string[];

export function escolherRemetente(p?: {
    emailColaborador?: string | null;
    padrao?: string | null;
    dominios?: string[];
}): { remetente: string; fonte: 'colaborador' | 'padrao'; motivo: string | null };

export function ehErroDeCaixaInexistente(erro?: string | null): boolean;
