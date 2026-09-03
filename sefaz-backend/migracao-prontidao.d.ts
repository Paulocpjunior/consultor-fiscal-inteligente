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
    /** BLOCO K: vendas de produção DO ESTABELECIMENTO (CFOP 5101/6101). */
    producaoPropria: number;
    /** BLOCO K: industrialização por encomenda (5124/5125/6124/6125, 590x/690x). */
    industrializacao: number;
    /** Documentos que a ponte .FML não leva ao E-Fiscal (CT-e + NFS-e). */
    foraDaPonte: number;
    porTipo: Record<string, number>;
    /** Tem IE (≠ ISENTO) → entrega EFD ICMS/IPI. Sem isso, fora do escopo. */
    contribuinteIcms: boolean;
    /** Contribuinte E Lucro — só quem entrega EFD ICMS/IPI é bloqueado por bloco. */
    entregaEfdIcms: boolean;
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
        /** Resposta do F0 pro bloco K: 0 = bloco descartável; >0 = alvo nomeado. */
        comProducaoParaBlocoK: number;
        comInterestadual: number;
        comVendaNaoContribuinte: number | null;
        vendaNaoContribuinteApurada: boolean;
        contribuintesIcms: number;
        semInscricaoEstadual: number;
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

/**
 * A empresa apura ICMS? O CADASTRO (`contribuinteIcms`, sim/não) vence a
 * dedução pela inscrição estadual — ter IE não é apurar ICMS (28/08, as
 * empresas de serviço de Brasília). Lê a forma achatada e a aninhada.
 */
export function contribuinteIcms(empresa: unknown): boolean;

// 03/09 (auditoria): exportações que o .js já entregava e o .d.ts não declarava —
// importador TypeScript não enxergava o símbolo (erro de compilação).
export function entregaEfdIcms(empresa: unknown): boolean;
