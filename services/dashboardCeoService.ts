/**
 * services/dashboardCeoService.ts
 * Cliente HTTP do Dashboard CEO (KPIs + insights IA).
 */
import type { User, DashboardCeoKpis, DashboardCeoInsights } from '../types';

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
