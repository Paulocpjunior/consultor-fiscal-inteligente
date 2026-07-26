// Tipos do legalizacao-normalizer.js (consumido pelos testes TS).

export interface JotformAnswer {
    name?: string;
    text?: string;
    type?: string;
    answer?: unknown;
}

export interface JotformSubmission {
    id: string;
    form_id?: string;
    status?: string;
    created_at?: string;
    answers?: Record<string, JotformAnswer>;
}

export interface VencimentoDoc {
    origem: 'jotform';
    formId: string;
    submissionId: string;
    categoria: 'certificado' | 'certidao' | 'parcelamento' | 'procuracao';
    semDocumento: boolean;
    empresaInativa: boolean;
    tipoDetalhe: string;
    empresaNome: string;
    empresaNumero: string | null;
    cnpj: string | null;
    emailCliente: string | null;
    dataEmissao?: string | null;
    dataVencimento: string;
    dataAviso?: string | null;
    numeroProcesso?: string | null;
    numeroParcelas?: string | null;
    valorParcela?: string | null;
    valorTotalDivida?: string | null;
    dataInicio?: string | null;
    responsavel: string | null;
    observacao?: string | null;
    criadoNoJotformEm: string | null;
}

export declare function normalizarTexto(s: unknown): string;
export declare function empresaInativa(nome: unknown): boolean;
export declare function parseDataJotform(answer: unknown): string | null;
export declare function acharResposta(
    answers: Record<string, JotformAnswer> | null | undefined,
    termos: string[],
): unknown;
export declare function normalizarSubmissionCertidao(sub: JotformSubmission | null | undefined): VencimentoDoc | null;
export declare function normalizarSubmissionParcelamento(sub: JotformSubmission | null | undefined): VencimentoDoc | null;
export declare function normalizarLote(
    subs: JotformSubmission[] | null | undefined,
    normalizarUma: (sub: JotformSubmission) => VencimentoDoc | null,
): { docs: Map<string, VencimentoDoc>; ignorados: number };
