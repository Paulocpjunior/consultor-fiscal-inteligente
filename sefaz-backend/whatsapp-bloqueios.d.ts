// Tipos da lista negra (o .js é o dono; acompanha no MESMO PR).
export const COLECAO_BLOQUEIOS: string;
export const MOTIVOS_BLOQUEIO: Array<{ id: string; rotulo: string }>;
export const CACHE_BLOQUEIOS_MS: number;
export const MAX_OBSERVACAO: number;

export interface Bloqueio {
    numero: string; motivo: string; observacao: string | null; ativo: boolean;
    bloqueadoPor: string | null; bloqueadoEm: string;
    desbloqueadoPor: string | null; desbloqueadoEm: string | null;
    descartadas: number; ultimaTentativaEm: string | null; ultimoTexto: string | null;
    meta: { ok: boolean; erro: string | null; em: string } | null;
    nomePerfil?: string | null;
}
export interface RespostaBlockUsers {
    ok: boolean; feitos: string[]; falhas: Array<{ numero: string; erro: string }>;
    erro: string | null; code?: number | null; configuracaoIncompleta?: boolean; indeterminado?: boolean;
}

export function numeroDeBloqueio(bruto: string | null | undefined): string | null;
export function motivoValido(id: string): boolean;
export function validarBloqueio(p: { numero?: string; motivo?: string; observacao?: string | null; por?: string | null; agora?: Date }):
    { ok: true; bloqueio: Bloqueio } | { ok: false; erro: string };
export function conjuntoDeBloqueados(docs: Array<{ data?: () => any } | Record<string, any>>): Set<string>;
export function separarBloqueadas<T extends { de?: string }>(mensagens: T[], bloqueados: Set<string>): { livres: T[]; bloqueadas: T[] };
export function patchDeDescarte(msg: { texto?: string | null; tipo?: string | null }, agora?: Date): { ultimaTentativaEm: string; ultimoTexto: string | null };
export function rotuloDoMotivo(id: string): string;
export function notaDeBloqueio(p: { motivo: string; por?: string | null; observacao?: string | null }): string;
export function notaDeDesbloqueio(p: { por?: string | null }): string;
export function resumoDoBloqueio(d: Partial<Bloqueio> & { numero: string }): Bloqueio & { motivoRotulo: string };
export function montarPedidoBlockUsers(numeros: string[]): { messaging_product: 'whatsapp'; block_users: Array<{ user: string }> };
export function interpretarRespostaBlockUsers(status: number, corpo: any, opts?: { remover?: boolean }): RespostaBlockUsers;
export function bloquearNaMeta(numeros: string[], deps?: Record<string, unknown>): Promise<RespostaBlockUsers>;
export function desbloquearNaMeta(numeros: string[], deps?: Record<string, unknown>): Promise<RespostaBlockUsers>;
