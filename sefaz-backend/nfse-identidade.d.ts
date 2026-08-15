/**
 * Identidade do documento de NFS-e — num lugar só (a fórmula do id é o que
 * faz a nota capturada substituir a digitada em vez de duplicá-la).
 * O `.d.ts` entra no mesmo PR que o módulo — lição do deploy 487.
 */
export function idDocumentoNfseSp(p: {
    prestadorCnpj?: string | null;
    tomadorCnpj?: string | null;
    numero: string | number;
}): string;

export function ehDigitada(existente: { origem?: string } | null | undefined): boolean;

/** `{}` quando não havia digitada — nada a limpar. */
export function patchSubstituiuDigitada(
    existente: { origem?: string; digitadaPorEmail?: string } | null | undefined,
    agoraIso?: string,
): Record<string, unknown>;
