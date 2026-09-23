/**
 * O CSV de NFS-e do portal de **Barueri** (ISO-8859-1, 34 colunas nomeadas).
 * O `.d.ts` entra no mesmo PR que o módulo — lição do deploy 487.
 */
export interface NotaBarueri {
    identificador: string;
    numero: string;
    /** ISO `aaaa-mm-dd` — a data em que a nota foi emitida. */
    dataEmissao: string | null;
    /** ISO `aaaa-mm-dd` — a `Data Base NF`, que é quem RECORTA O MÊS. */
    dataFatoGerador: string | null;
    dataRps: string | null;
    serieRps: string;
    numeroRps: string;
    chaveAcesso: string;
    /** Quem EMITIU — sai da chave; este arquivo não tem coluna de prestador. */
    prestadorCnpj: string;
    codMunIBGE: string;
    numeroDaChave: string;
    tomadorDoc: string;
    tomadorNome: string;
    tomadorEndereco: {
        logradouro: string; numero: string; complemento: string; bairro: string;
        cidade: string; uf: string; pais: string; cep: string;
    };
    codigoServico: string;
    aliquota: number | null;
    /** O código cru da coluna "ISSQN Retido" — o significado NÃO está provado. */
    issRetidoBruto: string;
    discriminacao: string;
    /** `null` quando ilegível — campo de valor não recebe zero por default. */
    valorServicos: number | null;
    issDevido: number | null;
    totalNota: number | null;
    valorFatura: number | null;
    valorNaoIncluso: number | null;
    irRetido: number | null;
    pisRetido: number | null;
    cofinsRetida: number | null;
    csllRetida: number | null;
    /** `null` quando o rótulo de "Nf Ativa" não é conhecido — não se afirma. */
    situacao: 'ativa' | 'cancelada' | null;
    cancelada: boolean;
    situacaoBruta: string;
    substituidaPor: string;
    codigoAutenticidade: string;
}

export interface CsvBarueriLido {
    layout: 'barueri-csv';
    colunasLidas: number;
    linhasComConteudo: number;
    totalNotas: number;
    canceladas: number;
    valorSomaCalculada: number;
    semValor: number;
    periodo: { inicio: string | null; fim: string | null };
    notas: NotaBarueri[];
    recusadas: Array<{ linha: number; motivo: string }>;
    avisos: string[];
}

export function valorPtBr(bruto: unknown): number | null;

export function situacaoDaColunaAtiva(bruto: unknown): {
    situacao: 'ativa' | 'cancelada' | null;
    cancelada: boolean;
    rotulo: string;
};

export function ehCsvNfseBarueri(input: Buffer | string): boolean;
export function ehTxtLoteBarueri(input: Buffer | string): boolean;
export function parseCsvNfseBarueri(input: Buffer | string): CsvBarueriLido;
