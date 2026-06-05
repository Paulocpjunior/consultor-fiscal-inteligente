/**
 * services/pgdasConferirService.ts
 * Cliente HTTP da Conferencia PGDAS-D.
 */
import type { User, PgdasConferirResponse, PgdasDivergencia, PgdasExplicarResponse, PgdasExtraido } from '../types';
import { getAuth } from 'firebase/auth';

async function authHeaders(_user: User | null): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuario nao autenticado');
    const token = await u.getIdToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

export async function conferirPgdas(
    user: User | null,
    empresaId: string,
    base64Pdf: string
): Promise<PgdasConferirResponse> {
    const res = await fetch('/api/admin/pgdas/conferir', {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify({ empresaId, base64Pdf }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `conferirPgdas: ${res.status}`);
    }
    return res.json();
}

export async function explicarDivergencia(
    user: User | null,
    empresaNome: string,
    divergencia: PgdasDivergencia,
    contextoExtraido: PgdasExtraido
): Promise<PgdasExplicarResponse> {
    const res = await fetch('/api/admin/pgdas/conferir-explicar', {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify({ empresaNome, divergencia, contextoExtraido }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `explicarDivergencia: ${res.status}`);
    }
    return res.json();
}

// Helpers
export function severidadeBadge(s: string): string {
    const map: Record<string, string> = {
        alta: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
        media: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
        baixa: 'bg-slate-100 text-slate-700',
    };
    return map[s] || 'bg-slate-100 text-slate-700';
}

export function formatBRL(v: number): string {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
