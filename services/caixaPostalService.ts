/**
 * services/caixaPostalService.ts
 *
 * Cliente HTTP para o backend /api/admin/caixa-postal.
 * Endpoints:
 *   GET  /resumo                 -> resumo agregado (dashboard)
 *   GET  /mensagens?{filtros}    -> lista de mensagens
 *   GET  /canais                 -> lista de canais disponíveis
 *   POST /sincronizar            -> sincroniza 1 empresa
 *   POST /sincronizar-todas      -> sincroniza todas
 *   POST /marcar-lida            -> marca como lida
 */
import type { User, CaixaPostalMensagem, CaixaPostalResumo, CaixaPostalSyncStats, CaixaPostalCategoria, CaixaPostalFonte } from '../types';

import { getAuth } from 'firebase/auth';

const BASE = '/api/admin/caixa-postal';

async function authHeaders(_user: User | null): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuario nao autenticado');
    const token = await u.getIdToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

export async function getResumo(user: User | null): Promise<CaixaPostalResumo> {
    const res = await fetch(`${BASE}/resumo`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`getResumo: ${res.status}`);
    return res.json();
}

export interface CanalInfo {
    id: CaixaPostalFonte;
    nome: string;
    descricao: string;
    cor: string;
    portal: string;
}

export async function getCanais(user: User | null): Promise<{ mode: string; canais: CanalInfo[] }> {
    const res = await fetch(`${BASE}/canais`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`getCanais: ${res.status}`);
    return res.json();
}

export interface ListarFilters {
    empresaCnpj?: string;
    categoria?: CaixaPostalCategoria;
    fonte?: CaixaPostalFonte;
    naoLidas?: boolean;
}

export async function listarMensagens(user: User | null, filters: ListarFilters = {}): Promise<CaixaPostalMensagem[]> {
    const qs = new URLSearchParams();
    if (filters.empresaCnpj) qs.set('empresaCnpj', filters.empresaCnpj);
    if (filters.categoria) qs.set('categoria', filters.categoria);
    if (filters.fonte) qs.set('fonte', filters.fonte);
    if (filters.naoLidas) qs.set('naoLidas', 'true');

    const res = await fetch(`${BASE}/mensagens?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`listarMensagens: ${res.status}`);
    return res.json();
}

export async function sincronizarEmpresa(user: User | null, empresaId: string, empresaCnpj: string): Promise<CaixaPostalSyncStats> {
    const res = await fetch(`${BASE}/sincronizar`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify({ empresaId, empresaCnpj }),
    });
    if (!res.ok) throw new Error(`sincronizarEmpresa: ${res.status}`);
    return res.json();
}

export async function sincronizarTodas(user: User | null): Promise<{ totalEmpresas: number; sucesso: number; falha: number }> {
    const res = await fetch(`${BASE}/sincronizar-todas`, {
        method: 'POST',
        headers: await authHeaders(user),
    });
    if (!res.ok) throw new Error(`sincronizarTodas: ${res.status}`);
    return res.json();
}

export async function marcarComoLida(user: User | null, docId: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${BASE}/marcar-lida`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify({ docId }),
    });
    if (!res.ok) throw new Error(`marcarComoLida: ${res.status}`);
    return res.json();
}

// Helpers de display — categorias
export function categoriaLabel(c: CaixaPostalCategoria): string {
    const map: Record<CaixaPostalCategoria, string> = {
        intimacao: 'Intimacao',
        malha: 'Malha Fiscal',
        exclusao: 'Exclusao',
        informativo: 'Informativo',
        det_notificacao: 'Notif. Trabalhista',
        det_auto_infracao: 'Auto de Infracao',
        dec_intimacao: 'Intimacao Estadual',
        dec_comunicado: 'Comunicado SEFAZ',
        dje_citacao: 'Citacao Judicial',
        dje_intimacao: 'Intimacao Judicial',
        emac_notificacao: 'Notif. Agricultura',
    };
    return map[c] || c;
}

export function categoriaColor(c: CaixaPostalCategoria): string {
    const map: Record<CaixaPostalCategoria, string> = {
        intimacao: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
        malha: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
        exclusao: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
        informativo: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
        det_notificacao: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
        det_auto_infracao: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
        dec_intimacao: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
        dec_comunicado: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
        dje_citacao: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
        dje_intimacao: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
        emac_notificacao: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
    };
    return map[c] || 'bg-slate-100 text-slate-700';
}

export function isCritica(c: CaixaPostalCategoria): boolean {
    const criticas: CaixaPostalCategoria[] = [
        'intimacao', 'malha', 'exclusao',
        'det_notificacao', 'det_auto_infracao',
        'dec_intimacao',
        'dje_citacao', 'dje_intimacao',
    ];
    return criticas.includes(c);
}

// Helpers de display — fontes (canais)
export function fonteLabel(f: CaixaPostalFonte | string): string {
    const map: Record<string, string> = {
        ecac: 'e-CAC',
        det: 'DET',
        dec: 'DEC',
        dje: 'DJE',
        emac: 'e-MAC',
        mock: 'e-CAC',
        serpro: 'e-CAC',
    };
    return map[f] || f;
}

export function fonteBadgeColor(f: CaixaPostalFonte | string): string {
    const map: Record<string, string> = {
        ecac: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
        det: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
        dec: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
        dje: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
        emac: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
        mock: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
        serpro: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    };
    return map[f] || 'bg-slate-100 text-slate-700';
}

export function fonteDotColor(f: CaixaPostalFonte | string): string {
    const map: Record<string, string> = {
        ecac: 'bg-blue-500',
        det: 'bg-orange-500',
        dec: 'bg-emerald-500',
        dje: 'bg-violet-500',
        emac: 'bg-amber-600',
    };
    return map[f] || 'bg-slate-400';
}
