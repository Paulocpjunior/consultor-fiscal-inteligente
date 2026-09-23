/**
 * O OUTRO LADO da mesma chave — a contraparte que também é cliente da casa.
 * O `.d.ts` entra no mesmo PR que o módulo.
 */
export function chaveLegivel(chave: unknown): string;
/** '' quando chave ou CNPJ são ilegíveis — id chutado seria documento órfão. */
export function idDoDocumentoDoLado(chave: unknown, cnpjEmpresa: unknown): string;
export function ehIdDeLado(id: unknown): boolean;
/** A chave a partir de um id nu ou de lado; '' se o id não carrega chave. */
export function chaveDoIdDeDocumento(id: unknown): string;
export interface CarimboDoLado {
    chave: string;
    outroLadoCnpj: string | null;
    outroLadoEmpresaId: string | null;
    em: string;
}
export function carimboDoLado(p: {
    chave: unknown;
    outroLadoCnpj?: unknown;
    outroLadoEmpresaId?: unknown;
    agoraIso?: string;
}): CarimboDoLado | null;
export function ehDocumentoDeLado(doc: any): boolean;
