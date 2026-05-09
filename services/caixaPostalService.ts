/**
 * services/caixaPostalService.ts
 *
 * Cliente HTTP para o backend /api/admin/caixa-postal.
 * Endpoints:
 *   GET  /resumo                 -> resumo agregado (dashboard)
 *   GET  /mensagens?{filtros}    -> lista de mensagens
 *   POST /sincronizar            -> sincroniza 1 empresa
 *   POST /sincronizar-todas      -> sincroniza todas
 *   POST /marcar-lida            -> marca como lida
 */
import type { User, CaixaPostalMensagem, CaixaPostalResumo, CaixaPostalSyncStats, CaixaPostalCategoria } from '../types';

const BASE = '/api/admin/caixa-postal';

function authHeaders(user: User | null): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'X-User-Role': user?.role || 'colaborador',
    };
}

export async function getResumo(user: User | null): Promise<CaixaPostalResumo> {
    const res = await fetch(`${BASE}/resumo`, { headers: authHeaders(user) });
    if (!res.ok) throw new Error(`getResumo: ${res.status}`);
    return res.json();
}

export interface ListarFilters {
    empresaCnpj?: string;
    categoria?: CaixaPostalCategoria;
    naoLidas?: boolean;
}

export async function listarMensagens(user: User | null, filters: ListarFilters = {}): Promise<CaixaPostalMensagem[]> {
    const qs = new URLSearchParams();
    if (filters.empresaCnpj) qs.set('empresaCnpj', filters.empresaCnpj);
    if (filters.categoria) qs.set('categoria', filters.categoria);
    if (filters.naoLidas) qs.set('naoLidas', 'true');

    const res = await fetch(`${BASE}/mensagens?${qs}`, { headers: authHeaders(user) });
    if (!res.ok) throw new Error(`listarMensagens: ${res.status}`);
    return res.json();
}

export async function sincronizarEmpresa(user: User | null, empresaId: string, empresaCnpj: string): Promise<CaixaPostalSyncStats> {
    const res = await fetch(`${BASE}/sincronizar`, {
        method: 'POST',
        headers: authHeaders(user),
        body: JSON.stringify({ empresaId, empresaCnpj }),
    });
    if (!res.ok) throw new Error(`sincronizarEmpresa: ${res.status}`);
    return res.json();
}

export async function sincronizarTodas(user: User | null): Promise<{ totalEmpresas: number; sucesso: number; falha: number }> {
    const res = await fetch(`${BASE}/sincronizar-todas`, {
        method: 'POST',
        headers: authHeaders(user),
    });
    if (!res.ok) throw new Error(`sincronizarTodas: ${res.status}`);
    return res.json();
}

export async function marcarComoLida(user: User | null, docId: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${BASE}/marcar-lida`, {
        method: 'POST',
        headers: authHeaders(user),
        body: JSON.stringify({ docId }),
    });
    if (!res.ok) throw new Error(`marcarComoLida: ${res.status}`);
    return res.json();
}

// Helpers de display
export function categoriaLabel(c: CaixaPostalCategoria): string {
    const map: Record<CaixaPostalCategoria, string> = {
        intimacao: 'Intimação',
        malha: 'Malha Fiscal',
        exclusao: 'Exclusão',
        informativo: 'Informativo',
    };
    return map[c] || c;
}

export function categoriaColor(c: CaixaPostalCategoria): string {
    const map: Record<CaixaPostalCategoria, string> = {
        intimacao: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
        malha: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
        exclusao: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
        informativo: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    };
    return map[c] || 'bg-slate-100 text-slate-700';
}

export function isCritica(c: CaixaPostalCategoria): boolean {
    return c === 'intimacao' || c === 'malha' || c === 'exclusao';
}
