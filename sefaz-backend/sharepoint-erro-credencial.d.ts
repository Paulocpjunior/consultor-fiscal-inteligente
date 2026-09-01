/**
 * Assinatura de uma falha de CREDENCIAL do SharePoint (o proxy não consegue
 * falar com a Microsoft) — ela pede ação DIFERENTE de um erro de pasta.
 */
export declare const ASSINATURA_CREDENCIAL: RegExp;

export function ehFalhaDeCredencial(motivo?: unknown): boolean;

/** A ação de uma falha de credencial, dita para quem está no fim de mês. */
export declare const ACAO_CREDENCIAL_ENVIO: string;

export function pendenciaDeGravacaoSharePoint(motivo?: unknown): {
    causa: string;
    acao: string;
    /** 'casa' = credencial do proxy · 'empresa' = pasta/caminho do cliente. */
    deQuem: 'casa' | 'empresa';
};
