// Tipos do click-to-call pelo SBC — o dono é o .js.
export const COLECAO_PEDIDOS_LIGACAO: string;
export const DOC_AGENTE_SBC: string;
export const VALIDADE_PEDIDO_MS: number;
export const AGENTE_SILENCIO_MAX_MS: number;
export const ESPERA_RAMAL_S: number;
export const ESPERA_CLIENTE_S: number;
export const CONTEXTO_SAIDA: string;
export const ENDPOINT_HIT: string;

export function validarRamal(bruto: unknown): { ok: true; ramal: string } | { ok: false; erro: string };

export interface RecusaPedido {
    ok: false; status: number; error: string; acao?: string;
    permissao?: string; emConducaoPor?: string; semRamal?: boolean; agenteNaoConfigurado?: boolean;
}
export function avaliarPedidoDeLigacao(args: {
    conversa?: Record<string, any>; numero: string; eu: string | null; ramal: unknown;
    agora?: Date; agenteConfigurado?: boolean;
}): { ok: true; ramal: string } | RecusaPedido;

export function idDoPedido(args: { numero: string; agora?: Date }): string;

export interface PedidoLigacao {
    id: string; numero: string; conversaId: string; ramal: string; canalId: string | null;
    nomeContato: string | null; solicitadoPor: string | null; solicitadoEm: string; expiraEm: string;
    status: 'pendente' | 'pegou' | 'atendida' | 'nao-atendida' | 'ocupado' | 'falhou' | 'expirado';
    pegouEm: string | null; terminouEm: string | null;
    resultado: { disposicao?: string | null; billsec?: number | null; detalhe?: string | null } | null;
}
export function montarPedido(args: {
    id: string; numero: string; conversaId?: string; ramal: string; eu: string | null;
    nomeContato?: string | null; canalId?: string | null; agora?: Date;
}): PedidoLigacao;

export function estadoDoPedido(pedido: Partial<PedidoLigacao> | null | undefined, agora?: Date): string;
export function montarCallFile(args: { ramal: string; numero: string; pedidoId: string; nomeContato?: string | null }): string;
export function lerLinhaCdr(linha: string): Record<string, any> | null;
export function lerResultadoDoCdr(linhasCsv: string, pedidoId: string):
    { encontrado: false } | { encontrado: true; disposicao: string; billsec: number; pernaCliente: boolean; lastdata: string | null };
export function traduzirResultado(r: ReturnType<typeof lerResultadoDoCdr> | null | undefined): { status: string; detalhe: string };
export function resumoDoPedido(pedido: Partial<PedidoLigacao> | null | undefined, agora?: Date): { estado: string; texto: string; final: boolean };
export function situacaoDoAgente(doc: { ultimoContatoEm?: string | null; versao?: string | null } | null | undefined, agora?: Date):
    { vivo: boolean; texto: string; haMs: number | null };
