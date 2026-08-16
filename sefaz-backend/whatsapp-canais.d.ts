// Tipos do catálogo de canais do WhatsApp — o dono é o .js.
export interface CanalWhatsapp {
    id: string;
    rotulo: string;
    numeroExibicao: string | null;
    phoneNumberId: string | null;
    wabaId: string | null;
    /** NOME da variável do Cloud Run que guarda o token — nunca o valor. */
    envToken: string | null;
    origem: 'env' | 'cadastro';
    ativo?: boolean;
    pronto: boolean;
    faltas?: string[];
}

export interface CatalogoCanais {
    canais: CanalWhatsapp[];
    conflitos: { id: string; phoneNumberId: string; motivo: string }[];
    multiCanal: boolean;
    padraoId: string;
}

type Env = Record<string, string | undefined>;

export const CANAL_PADRAO_ID: string;
export function canalDoEnv(env?: Env): CanalWhatsapp;
export function normalizarCanalCadastrado(id: string, d?: Record<string, unknown>): CanalWhatsapp;
export function montarCatalogoCanais(p?: {
    env?: Env;
    cadastrados?: { id: string; dados?: Record<string, unknown> }[];
}): CatalogoCanais;
export function canalDoEvento(catalogo: CatalogoCanais, phoneNumberId: unknown):
    { canalId: string | null; conhecido: boolean; phoneNumberId?: string; motivo: string | null };
export function canalDaConversa(catalogo: CatalogoCanais, conversa?: Record<string, unknown>): CanalWhatsapp | null;
export function credenciaisDoCanal(canal: CanalWhatsapp | null | undefined, env?: Env):
    { pronto: boolean; faltas: string[]; cfg?: { token: string; phoneNumberId: string | null; wabaId: string | null } };
export function validarCanal(d?: Record<string, unknown>):
    { ok: true; id: string; envToken: string } | { ok: false; erros: string[] };
