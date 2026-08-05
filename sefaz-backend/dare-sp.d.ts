export interface CodigoDareIcms {
    codigoServico: string;
    codigoReceita: string;
    sefaz: string;
    descricao: string;
    derivacao: 'proprio' | 'st' | 'difal';
    regimes: string[];
}

/** Catálogo ÚNICO dos códigos de serviço do DARE-SP (a tela lê daqui). */
export const CODIGOS_DARE_ICMS: Record<string, CodigoDareIcms>;

export function derivacoesDisponiveis(regime: string): CodigoDareIcms[];

export interface DarePayloadSp {
    contribuinte: { cnpj: string; razaoSocial: string };
    codigoServico: string;
    codigoReceita: string;
    sefaz: string;
    descricao: string;
    derivacao: 'proprio' | 'st' | 'difal';
    referencia: string;
    valor: number;
    vencimento: string;
    portalUrl: string;
}

export function montarDare(input: {
    cnpj: string;
    razaoSocial: string;
    codigoServico: string;
    referencia: string;
    valor: number;
    vencimento: string;
    /** Serviços conhecidos além da tabela fixa (antecipação 426-A, do banco). */
    codigosExtras?: Record<string, unknown> | null;
}): DarePayloadSp;

export function montarLinhaLoteTxt(input: {
    cnpj: string;
    razaoSocial?: string;
    codigoServico: string;
    referencia: string;
    valor: number;
    vencimento: string;
}): string;
