export function isResumoSchema(sch: string | null | undefined): boolean;
export function isResumoTipoDoc(td: string | null | undefined): boolean;
export function modeloComItens(chave: string | null | undefined): boolean;

export interface DecisaoGravacaoNFe {
    exists: boolean;
    /** A base tem MENOS que o que chega (resumo/incompleto/digitada → completa). */
    upgrade: boolean;
    incompleto: boolean;
    duplicado: boolean;
    /** Escrita deve preservar os eventos já anexados (merge). */
    merge: boolean;
}

export function decidirGravacaoNFe(p: {
    existingData: object | null | undefined;
    /** tipoDoc do que está CHEGANDO ('NFe', 'resNFe', ...). */
    tipoDoc: string | null;
    /** schema do que está chegando (docZip), quando houver. */
    schema: string | null;
    chave: string | null;
}): DecisaoGravacaoNFe;

/** Os campos que a completa carimba ao completar um resumo (schema/tipoDoc/temItens). */
export function carimboDaCompleta(parsed: { tipo?: string | null; itens?: unknown[] } | null | undefined): { schema: string | null; tipoDoc: string | null; temItens: boolean };
