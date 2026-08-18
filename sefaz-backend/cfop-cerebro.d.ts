/**
 * O "cérebro" do CFOP — a decisão humana numa nota vira parâmetro para as
 * próximas. O `.d.ts` entra no mesmo PR que o módulo.
 */
export interface ParametroCfop {
    cnpjFornecedor: string;
    nomeFornecedor?: string | null;
    /** null = vale para QUALQUER CFOP daquele fornecedor (escopo amplo). */
    cfopOrigem?: string | null;
    cfopDestino: string;
    /** 'AAAA-MM' — não retroage. */
    vigenciaInicio: string;
    ativo?: boolean;
    criadoPor?: string | null;
    criadoEm?: string | null;
    id?: string;
}

/** 'CNPJ|CFOP' ou 'CNPJ|*' — o mais específico vence. */
export function chaveParametro(cnpjFornecedor: unknown, cfopOrigem: unknown): string;

export function parametroAplicavel(
    parametros: ParametroCfop[] | null | undefined,
    p: { cnpjFornecedor?: string | null; cfopOrigem?: string | null; competencia?: string | null },
): ParametroCfop | null;

export function sugerirParametro(p: {
    cnpjFornecedor?: string | null;
    nomeFornecedor?: string | null;
    cfopOrigem?: string | null;
    cfopDestino?: string | null;
    competencia?: string | null;
}): { pode: false; motivo: string }
 | { pode: true; chave: string; pergunta: string; detalhe: string; parametro: ParametroCfop };

/** Rótulo do parâmetro para a tela — origem sem carimbo não se confere. */
export function rotuloParametro(p: ParametroCfop | null | undefined): string;
