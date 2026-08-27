export interface MensagemComOrigem {
    direcao?: string | null;
    enviadoPor?: string | null;
    texto?: string | null;
    midia?: unknown;
}

export function saiuPorOutraPlataforma(mensagem: MensagemComOrigem | null | undefined): boolean;
