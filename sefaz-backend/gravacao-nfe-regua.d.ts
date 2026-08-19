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
