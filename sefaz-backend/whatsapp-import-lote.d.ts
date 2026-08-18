// Tipos da importação em LOTE do backup da Ultra Fox — o dono é o .js.
export const ARQUIVO_CONVERSA: string;
export const ARQUIVO_ATENDIMENTO: string;
export const MENSAGENS_POR_ENVIO: number;
export const PASTA_MIDIA: string;
export const MARCADORES_ANEXO: RegExp[];

/**
 * A mensagem carregava anexo? `arquivo` é null quando o export escondeu a
 * mídia — anexo sem nome ainda é anexo, mas inventar um nome faria alguém
 * procurar no SharePoint um arquivo que não existe.
 */
export function detectarAnexo(texto?: string | null): { temAnexo: boolean; arquivo: string | null };

/** Aviso da decisão "texto no app, anexo no SharePoint" (null = nada a dizer). */
export function avisoDeAnexos(p?: { midias?: number; comAnexo?: number }): { grave: boolean; texto: string } | null;

export interface ArquivoDeConversa { numero: string; caminho: string }
export interface ArquivoDeAtendimento { numero: string | null; protocolo: string | null; caminho: string }
export interface ArquivoIgnorado { caminho: string; motivo: string }

export interface MapaDoBackup {
    /** `<numero>/_full-chat.txt` — o que se importa. */
    conversas: ArquivoDeConversa[];
    /** `<numero>/<protocolo>/_chat.txt` — mesmas mensagens, não se importa. */
    atendimentos: ArquivoDeAtendimento[];
    /** `_chat.txt` sem full-chat na linhagem: entra, mas é suposição declarada. */
    semDono: ArquivoDeConversa[];
    ignorados: ArquivoIgnorado[];
    /** Quantos arquivos há na pasta `_files` (a mídia não entra no app). */
    midias: number;
}

export function mapearArquivosDoBackup(caminhos?: string[]): MapaDoBackup;

export function resumoDaVarredura(mapa: MapaDoBackup | null | undefined): {
    contatos: number;
    arquivosParaLer: number;
    atendimentosIgnorados: number;
    foraDoPadrao: number;
    midias: number;
    avisos: string[];
};

export interface MensagemLida { em: string; autor: string; texto: string }
export interface ConversaLida {
    numero: string;
    mensagens: MensagemLida[];
    autores?: string[];
    descartadas?: unknown[];
}

export function consolidarPrevia(lidos?: ConversaLida[]): {
    conversas: number;
    mensagens: number;
    descartadas: number;
    arquivosSemMensagem: number;
    /** Mensagens que DIZEM ter tido anexo (o arquivo fica no SharePoint). */
    comAnexo: number;
    /** Ordenados por VOLUME — é o que torna a escolha de direção possível. */
    autores: { autor: string; total: number }[];
};

export function dividirEmBlocos(
    conversas?: ConversaLida[], teto?: number,
): { numero: string; mensagens: MensagemLida[] }[][];
