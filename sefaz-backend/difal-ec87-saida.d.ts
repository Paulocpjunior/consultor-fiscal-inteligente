// Tipos do dono do DIFAL de SAÍDA (EC 87/2015) — C101 e E300/E310/E316.
//
// ⚠️ `.d.ts` À MÃO ANDA JUNTO DO `.js` NO MESMO PR (lição de 20/08): o tipo e a
// implementação são duas declarações do MESMO fato, e divergem em SILÊNCIO —
// declarar aqui o que o `.js` não exporta estoura em produção no primeiro
// clique; o contrário quebra o `tsc` de quem importar.

export interface DifalDoDocumento {
    vIcmsUfDest: number;
    vIcmsUfRemet: number;
    vFcpUfDest: number;
    temDifal: boolean;
    /** De onde o valor veio: o grupo do ITEM, a reserva dos TOTAIS, ou nada. */
    origem: 'item' | 'total' | null;
}

export interface GrupoDifalUf {
    uf: string;
    difal: number;
    fcp: number;
    parteRemetente: number;
    documentos: number;
    extemporaneos: number;
}

export interface ApuracaoDifalUf {
    uf: string;
    sldCredAntDifal: number;
    totDebitosDifal: number;
    outDebDifal: number;
    totCreditosDifal: number;
    outCredDifal: number;
    sldDevAntDifal: number;
    deducoesDifal: number;
    recolDifal: number;
    sldCredTranspDifal: number;
    debEspDifal: number;
    sldCredAntFcp: number;
    totDebFcp: number;
    outDebFcp: number;
    totCredFcp: number;
    outCredFcp: number;
    sldDevAntFcp: number;
    deducoesFcp: number;
    recolFcp: number;
    sldCredTranspFcp: number;
    debEspFcp: number;
    /** VL_RECOL_DIFAL + DEB_ESP_DIFAL — o E316 do DIFAL. */
    aRecolherDifal: number;
    /** VL_RECOL_FCP + DEB_ESP_FCP — o E316 do FCP (código de receita próprio). */
    aRecolherFcp: number;
    /** VL_RECOL_DIFAL + DEB_ESP_DIFAL + VL_RECOL_FCP + DEB_ESP_FCP (Σ dos E316). */
    aRecolher: number;
    deducoesExcedentes: number;
    documentos?: number;
}

export interface ObrigacaoDifalUf {
    /** ddmmaaaa */
    dtVcto: string;
    /** Código de receita do DIFAL na UF de destino — não se deduz. */
    codRec: string;
    /** Código de receita do FCP — receita própria; sem ele o E316 do FCP não sai. */
    codRecFcp?: string;
}

export declare const COD_OR_DIFAL_NORMAL: string;

export interface CodigoReceitaGnreEc87 {
    codigo: string;
    tributo: 'difal' | 'fcp';
    descricao: string;
}
/** Sugestões para o cadastro (tabela de receitas da GNRE) — nunca default do gerador. */
export declare const CODIGOS_RECEITA_GNRE_EC87: readonly CodigoReceitaGnreEc87[];

export declare function difalDoDocumento(nota: any): DifalDoDocumento;
export declare function documentoLevaC101(nota: any): boolean;
export declare function camposDoC101(nota: any): (string | number)[];

export declare function agruparDifalPorUf(notas: any[], ufEmpresa: string): {
    grupos: GrupoDifalUf[];
    semUf: string[];
    mesmaUf: string[];
    comParteRemetente: string[];
};

export interface NotaDifalDetalhe {
    data: string;
    numero: string;
    modelo: string;
    cnpjCpf: string;
    nome: string;
    difal: number;
    fcp: number;
    chave: string;
}
export interface GrupoDifalDetalhe {
    uf: string;
    difal: number;
    fcp: number;
    documentos: number;
    notas: NotaDifalDetalhe[];
}
/** O "Detalhamento das Notas" por UF — mesma seleção do E300/E310. */
export declare function detalharDifalPorUf(notas: any[], ufEmpresa: string, empresaCnpj?: string): {
    grupos: GrupoDifalDetalhe[];
    totais: { difal: number; fcp: number; documentos: number };
    semUf: string[];
    mesmaUf: string[];
};

export declare function apurarDifalDaUf(p: {
    uf: string;
    difal?: number;
    fcp?: number;
    saldoCredorAnteriorDifal?: number;
    saldoCredorAnteriorFcp?: number;
    ajustes?: Record<string, number>;
}): ApuracaoDifalUf;

export declare function montarLinhasDifalBlocoE(p: {
    notas: any[];
    ufEmpresa: string;
    dtIni: string;
    dtFin: string;
    mesRef: string;
    obrigacoesPorUf?: Record<string, ObrigacaoDifalUf>;
    ajustes?: any[];
    saldosAnteriores?: Record<string, { difal?: number; fcp?: number }>;
}): {
    linhas: (string | number)[][];
    apuracoes: ApuracaoDifalUf[];
    avisos: string[];
};

export declare function avisoDifalNaoCapturado(notas: any[], ufEmpresa: string): string | null;
