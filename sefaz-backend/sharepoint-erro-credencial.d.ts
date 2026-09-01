/**
 * Assinatura de uma falha de CREDENCIAL do SharePoint (o proxy não consegue
 * falar com a Microsoft) — ela pede ação DIFERENTE de um erro de pasta.
 */
export declare const ASSINATURA_CREDENCIAL: RegExp;

export function ehFalhaDeCredencial(motivo?: unknown): boolean;

/**
 * Qual é a causa da recusa, quando a resposta da Microsoft permite dizer.
 * `'indeterminada'` é resposta legítima — o app não deduz o motivo.
 */
export function causaDaFalhaDeCredencial(motivo?: unknown):
    'segredo-id-em-vez-do-valor' | 'segredo-expirado' | 'tenant-inexistente' | 'indeterminada';

/** A instrução da causa — dono único, lida pelo card E pelo painel de envios. */
export function instrucaoDaCredencial(motivo?: unknown): string;

/** A ação de uma falha de credencial, dita para quem está no fim de mês. */
export declare const ACAO_CREDENCIAL_ENVIO: string;

/** `ACAO_CREDENCIAL_ENVIO` + a instrução da causa que a Microsoft respondeu. */
export function acaoCredencialEnvio(motivo?: unknown): string;

export function pendenciaDeGravacaoSharePoint(motivo?: unknown): {
    causa: string;
    acao: string;
    /** 'casa' = credencial do proxy · 'empresa' = pasta/caminho do cliente. */
    deQuem: 'casa' | 'empresa';
};
