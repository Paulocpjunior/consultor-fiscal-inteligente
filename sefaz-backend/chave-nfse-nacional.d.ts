export interface ChaveNfseNacional {
    /** Município emissor (7 dígitos IBGE). */
    cMun: string;
    /** 1 = produção · 2 = homologação. */
    ambiente: string;
    /** 1 = CPF · 2 = CNPJ. */
    tpInsc: string;
    /** CNPJ (14) ou CPF (11), só dígitos — quem EMITIU (o prestador). */
    inscricaoEmitente: string;
    /** Número da NFS-e sem os zeros à esquerda. */
    numero: string;
}

export function lerChaveNfseNacional(chave: unknown): ChaveNfseNacional | null;
