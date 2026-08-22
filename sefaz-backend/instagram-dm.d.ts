// Tipos do instagram-dm.js — o .d.ts anda com a implementação NO MESMO PR
// (lição de 20/08: .d.ts à mão é a armadilha das duas formas com outra roupa).

export const ID_PREFIXO_IG: string;

export interface MensagemInstagram {
  metaMessageId: string;
  igsid: string;
  conversaId: string | null;
  direcao: 'entrada' | 'saida';
  texto: string | null;
  anexos: Array<{ tipo: string; url: string | null }>;
  timestamp: string;
}

export interface ExtracaoInstagram {
  valido: boolean;
  motivo?: string;
  mensagens: MensagemInstagram[];
}

export function ehConversaInstagram(id: unknown): boolean;
export function idConversaInstagram(igsid: unknown): string | null;
export function idConversaDoParam(param: unknown): string;
export function extrairEventosInstagram(payload: unknown): ExtracaoInstagram;
export function resumoDaMensagemIg(m: {
  texto?: string | null;
  anexos?: Array<{ tipo?: string }>;
}): string;

export interface PaginaInstagram {
  pageId: string;
  nome: string | null;
  pageToken: string | null;
  igId: string;
  igUsername: string | null;
}

export function paginaDoInstagram(
  deps?: Record<string, unknown>
): Promise<{ ok: boolean; pagina?: PaginaInstagram; erro?: string }>;

export interface ResultadoLigarRecebimento {
  ok: boolean;
  appId?: string;
  callback?: string;
  pageId?: string;
  igId?: string;
  igUsername?: string | null;
  erro?: string;
}

export function ligarRecebimentoInstagram(
  deps?: Record<string, unknown>
): Promise<ResultadoLigarRecebimento>;

export interface AssinaturaDoApp {
  objeto: string;
  ativa: boolean;
  callback: string | null;
  campos: string[];
}

export function assinaturasDoApp(
  deps?: Record<string, unknown>
): Promise<{
  ok: boolean;
  erro?: string;
  appId?: string;
  doApp?: AssinaturaDoApp[];
  daPagina?: Array<{ appId: string; campos: string[] }> | null;
}>;

export interface EnvioInstagram {
  ok: boolean;
  messageId?: string;
  janelaFechada?: boolean;
  erro?: string;
}

export function enviarTextoInstagram(
  entrada: { para: string; texto: string },
  deps?: Record<string, unknown>
): Promise<EnvioInstagram>;

export const _internals: {
  tsMsParaIso(ts: unknown): string;
};
