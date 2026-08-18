// Tipos da importação em LOTE do backup da Ultra Fox — o dono é o .js.
export const ARQUIVO_CONVERSA: string;
export const ARQUIVO_ATENDIMENTO: string;
export const MENSAGENS_POR_ENVIO: number;

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
}

export function mapearArquivosDoBackup(caminhos?: string[]): MapaDoBackup;

export function resumoDaVarredura(mapa: MapaDoBackup | null | undefined): {
    contatos: number;
    arquivosParaLer: number;
    atendimentosIgnorados: number;
    foraDoPadrao: number;
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
    /** Ordenados por VOLUME — é o que torna a escolha de direção possível. */
    autores: { autor: string; total: number }[];
};

export function dividirEmBlocos(
    conversas?: ConversaLida[], teto?: number,
): { numero: string; mensagens: MensagemLida[] }[][];
