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
    resumo: {
        notas: number;
        total: number;
        semDocumentoContraparte: number;
        /**
         * Notas que PERTENCIAM a este movimento e ficaram de fora por lacuna de
         * captura (sem valor ou sem data legível). Zero é a RESPOSTA, não o
         * default de quem não olhou — antes elas sumiam caladas e o Contábil
         * recebia um mês menor do que houve.
         */
        foraPorLacuna: number;
    };
    /** O que ficou de fora, NOMEADO pelo número da nota — a ação é procurar AQUELA nota. */
    lacunas: { semValor: string[]; semData: string[] };
    ressalvas: string[];
}

export function montarMovimentoFiscalContabil(params?: {
    cnpjEmpresa?: string;
    competencia?: string;
    movimento?: string;
    documentos?: unknown[];
}): MovimentoFiscalCfiPayload;
