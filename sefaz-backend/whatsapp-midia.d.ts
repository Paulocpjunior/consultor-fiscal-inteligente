// Tipos do núcleo de anexos do SP Connect — o dono é o .js.
export type TipoMidia = 'image' | 'audio' | 'video' | 'document';

export const LIMITES_META: Record<TipoMidia | 'sticker', number>;
export const LIMITE_CORPO_BYTES: number;

export function tipoDaMidia(mime: unknown): TipoMidia;
export function nomeSeguroDeArquivo(nome: unknown, tipo?: string): string;
export function validarAnexo(p: { mime?: unknown; tamanhoBytes?: unknown; nomeArquivo?: unknown }):
    { ok: true; tipo: TipoMidia; nome: string } | { ok: false; erro: string; acao: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function montarMensagemMidia(p: {
    para: string; tipo: TipoMidia; mediaId: string; nomeArquivo?: string; legenda?: string;
}): Record<string, any>;
export function legendaSeraIgnorada(tipo: string, legenda?: string): boolean;
export function resumoDoAnexo(tipo: string, nome: string, legenda?: string | null): string;
