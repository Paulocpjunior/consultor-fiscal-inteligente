export interface MovimentoFiscalCfiNota {
    idOrigem: string;
    numero: string | null;
    data: string;
    participanteNome: string | null;
    participanteDocumento: string | null;
    valor: number;
    baseCalculoIss: number;
    aliquotaIss: number;
    valorIss: number;
    issRetido: number;
    pisRetido: number;
    cofinsRetido: number;
    irRetido: number;
    inssRetido: number;
    csllOuTotalRetido: number;
    codigoServico: string;
    discriminacao: string;
    origemDocumento: string;
}

export interface MovimentoFiscalCfiPayload {
    contrato: 'movimento_fiscal_cfi_v1';
    cnpjEmpresa: string;
    competencia: string;
    movimento: 'servicos_prestados' | 'servicos_tomados';
    notas: MovimentoFiscalCfiNota[];
    resumo: { notas: number; total: number; semDocumentoContraparte: number };
    ressalvas: string[];
}

export function montarMovimentoFiscalContabil(params?: {
    cnpjEmpresa?: string;
    competencia?: string;
    movimento?: string;
    documentos?: unknown[];
}): MovimentoFiscalCfiPayload;
