export interface ProntidaoLinha {
    empresaId: string;
    nome: string;
    cnpj: string;
    regime: string | null;
    uf: string;
    industriaCadastro: boolean;
    docs: number;
    emiteProprio: number;
    stSaidas: number;
    stEntradas: number;
    ipiSaidas: number;
    entradasInterestaduais: number;
    /** Vendas interestaduais a não contribuinte (EC 87/15 → E310/E316).
     *  null = NÃO APURADO (a leitura não trouxe itens) — nunca confundir com 0. */
    saidasNaoContribuinte: number | null;
    /** Documentos que a ponte .FML não leva ao E-Fiscal (CT-e + NFS-e). */
    foraDaPonte: number;
    porTipo: Record<string, number>;
    bloqueios: string[];
    atencoes: string[];
    candidataPiloto: boolean;
}

export interface ProntidaoResultado {
    linhas: ProntidaoLinha[];
    resumo: {
        comMovimento: number;
        candidatasPiloto: number;
        comStSaida: number;
        comIpiOuIndustria: number;
        comInterestadual: number;
        comVendaNaoContribuinte: number | null;
        vendaNaoContribuinteApurada: boolean;
        comCte: number;
        comNfse: number;
        docsForaDaPonte: number;
    };
    perguntasEquipe: string[];
}

export function montarProntidaoMigracao(
    docs: Array<Record<string, unknown>>,
    empresas: Array<{ id: string; nome?: string; cnpj?: string; regime?: string; uf?: string; industriaCadastro?: boolean }>,
): ProntidaoResultado;
