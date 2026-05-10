/**
 * services/dashboardCeoService.ts
 * Cliente HTTP do Dashboard CEO (KPIs + insights IA).
 */
import type { User, DashboardCeoKpis, DashboardCeoInsights, AcoesResponse } from '../types';

function authHeaders(user: User | null): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'X-User-Role': user?.role || 'colaborador',
    };
}

export async function getKpis(user: User | null): Promise<DashboardCeoKpis> {
    const res = await fetch('/api/admin/dashboard-ceo/kpis', { headers: authHeaders(user) });
    if (!res.ok) throw new Error(`getKpis: ${res.status}`);
    return res.json();
}

export async function getInsights(user: User | null, kpis: DashboardCeoKpis): Promise<DashboardCeoInsights> {
    const res = await fetch('/api/admin/dashboard-ceo/insights', {
        method: 'POST',
        headers: authHeaders(user),
        body: JSON.stringify({ kpis }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `getInsights: ${res.status}`);
    }
    return res.json();
}

// Helpers
export function formatBRL(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}


export async function getAcoes(user: User | null): Promise<AcoesResponse> {
    const res = await fetch('/api/admin/dashboard-ceo/acoes', { headers: authHeaders(user) });
    if (!res.ok) throw new Error(`getAcoes: ${res.status}`);
    return res.json();
}

export function urgenciaBadgeClass(u: string): string {
    const map: Record<string, string> = {
        alta: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
        media: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
        baixa: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
    };
    return map[u] || 'bg-slate-100 text-slate-700';
}

export function urgenciaIcon(u: string): string {
    return u === 'alta' ? '🔴' : u === 'media' ? '🟡' : '⚪';
}

export function tipoIcon(t: string): string {
    const map: Record<string, string> = {
        'caixa-postal': '📬',
        'das-vencido': '💸',
        'apuracao-pendente': '📊',
    };
    return map[t] || '📌';
}
