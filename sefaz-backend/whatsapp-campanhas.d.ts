// Tipos das campanhas em lote (o .js é o dono; acompanha no MESMO PR).
export const COLECAO_CAMPANHAS: string;
export const TIPOS_PUBLICO: string[];
export const REGIMES_CAMPANHA: string[];
export const STATUS_CAMPANHA: string[];
export const CATEGORIAS_CAMPANHA: string[];
export const LOTE_CAMPANHA: number;
export const MAX_DESTINATARIOS: number;
export const PALAVRAS_OPT_OUT: string[];
export const TOKENS_PERSONALIZACAO: string[];

export type StatusCampanha = 'rascunho' | 'enviando' | 'pausada' | 'concluida';
export type StatusDestinatario = 'pendente' | 'enviado' | 'falhou' | 'pulado';

export interface TemplateDaCampanha {
    nome: string; idioma: string; categoria: string; corpo: string | null; departamento: string | null;
}
export interface PublicoDaCampanha {
    tipo: 'etiqueta' | 'regime' | 'numeros';
    etiqueta: string | null; regime: string | null; numeros: string[] | null;
}
export interface Destinatario {
    numero: string; nome: string | null; empresaId: string | null; empresaNome: string | null;
    origem: string; status: StatusDestinatario; motivo: string | null; messageId: string | null; em: string | null;
}
export interface Pulado { numero: string; motivo: string; detalhe?: string; em?: string }
export interface Campanha {
    id: string; nome: string; status: StatusCampanha; template: TemplateDaCampanha; variaveis: string[];
    publico: PublicoDaCampanha; destinatarios: Destinatario[]; puladosNoPublico: Pulado[];
    criadoPor: string | null; criadoEm: string; iniciadoEm: string | null; concluidoEm: string | null; ultimoLoteEm: string | null;
}
export interface TotaisCampanha { total: number; pendentes: number; enviados: number; falhas: number; pulados: number }

export function ehPedidoDeOptOut(texto: string | null | undefined): boolean;
export function validarCampanha(p: {
    nome?: string;
    template?: { nome?: string; idioma?: string; categoria?: string; variaveis?: number; corpo?: string | null; departamento?: string | null };
    variaveis?: string[];
    publico?: { tipo?: string; etiqueta?: string; regime?: string; numeros?: string[] };
}): { ok: true; campanha: Pick<Campanha, 'nome' | 'template' | 'variaveis' | 'publico'> } | { ok: false; erro: string; acao?: string };
export function montarPublico(p: {
    campanha: Pick<Campanha, 'template' | 'publico'>;
    contatos?: Array<Record<string, any>>;
    catalogoEtiquetas?: Array<{ id: string; baseLegal?: string; rotulo?: string }>;
    empresas?: Map<string, { nome: string | null; regime: string }>;
}): { destinatarios: Destinatario[]; pulados: Pulado[]; truncado: boolean; limite: number };
export function variaveisDoDestinatario(variaveis: string[], dest: Partial<Destinatario>): { ok: true; variaveis: string[] } | { ok: false; motivo: string };
export function proximoLote(destinatarios: Destinatario[], tamanho?: number): number[];
export function totaisDaCampanha(destinatarios: Destinatario[]): TotaisCampanha;
export function campanhaConcluida(destinatarios: Destinatario[]): boolean;
export function resumoDaCampanha(c: Partial<Campanha> & { id: string }): {
    id: string; nome?: string; status?: StatusCampanha; template?: TemplateDaCampanha; variaveis: string[];
    publico?: PublicoDaCampanha; totais: TotaisCampanha; puladosNoPublico: number;
    criadoPor: string | null; criadoEm: string | null; iniciadoEm: string | null; concluidoEm: string | null; ultimoLoteEm: string | null;
};
export function textoDaMensagemDeCampanha(p: { campanha: Partial<Campanha>; corpoRenderizado: string | null }): string;
