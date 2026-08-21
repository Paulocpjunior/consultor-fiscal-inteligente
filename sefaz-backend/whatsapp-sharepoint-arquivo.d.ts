// Tipos do arquivador de mídia do SP Connect no SharePoint — o dono é o .js.
export const RAIZ_SP_CONNECT: string;

export function sanitizarComponenteSp(texto: unknown): string | null;

export function competenciaDaMensagem(timestampIso: string | null | undefined):
    { ano: string; mes: string } | null;

export function pastaArquivoWhatsapp(p?: {
    numero?: string | null;
    nomePerfil?: string | null;
    empresaNome?: string | null;
    timestamp?: string | null;
}): string | null;

export function elegivelParaArquivoWhatsapp(doc: {
    spArquivadoEm?: unknown;
    direcao?: string | null;
    midia?: { storagePath?: string | null } | null;
    conversaId?: string | null;
    timestamp?: string | null;
} | null | undefined): { ok: boolean; motivo?: string };

export function nomeArquivoSp(storagePath: string | null | undefined): string | null;

export interface ResultadoArquivoWhatsappSp {
    ok: boolean;
    escopo: string;
    lidos: number;
    candidatos: number;
    arquivados: number;
    semMidia: number;
    notasInternas: number;
    outrosSkip: number;
    erros: number;
    errosDetalhe: string[];
    cicloCompleto: boolean;
    pausadoPorTeto: boolean;
    duracaoMs?: number;
}

export function arquivarMidiasWhatsappNoSharePoint(p?: {
    maxDocs?: number;
    maxLeituras?: number;
}): Promise<ResultadoArquivoWhatsappSp>;
