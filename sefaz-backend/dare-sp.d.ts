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

// 03/09 (auditoria): exportações que o .js já entregava e o .d.ts não declarava —
// importador TypeScript não enxergava o símbolo (erro de compilação).
export function montarLoteTxt(...args: any[]): any;
export function codigoGnreParaDareSp(codigo: unknown): any;
export function normalizarReferencia(v: unknown): string;
export const CONVERSAO_GNRE_DARE_SP: Record<string, any>;
export const MAX_DOCS_LOTE_DARE: number;
export const PORTAL_DARE_URL: string;
export const SERVICOS_BLOQUEADOS_LOTE: readonly string[];
