/**
 * services/anomaliasService.ts
 * Cliente HTTP do detector de anomalias DAS.
 */
import { getAuth } from 'firebase/auth';
import type { User, AnomaliasGlobalResponse, AnomaliaDetectada, AnomaliaIaResponse } from '../types';

async function authHeaders(_user: User | null): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada — faça login novamente');
    const token = await u.getIdToken();
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };
}

export async function getAnomaliasTodas(user: User | null): Promise<AnomaliasGlobalResponse> {
    const res = await fetch('/api/admin/das/anomalias-todas', { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`getAnomaliasTodas: ${res.status}`);
    return res.json();
}

export async function explicarAnomaliaIa(
    user: User | null,
    empresaNome: string,
    empresaAnexo: string | undefined,
    anomalia: AnomaliaDetectada
): Promise<AnomaliaIaResponse> {
    const res = await fetch('/api/admin/das/anomalia-explicar', {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify({ empresaNome, empresaAnexo, anomalia }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `explicarAnomaliaIa: ${res.status}`);
    }
    return res.json();
}

export function tipoLabel(t: string): string {
    const map: Record<string, string> = {
        'salto_faturamento': '📈 Salto/Queda de Faturamento',
        'mudanca_anexo': '🔄 Mudança de Anexo',
        'das_abaixo_esperado': '⚠️ DAS Abaixo do Esperado',
    };
    return map[t] || t;
}

export function severidadeBadge(s: string): string {
    const map: Record<string, string> = {
        alta: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
        media: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
        baixa: 'bg-slate-100 text-slate-700',
    };
    return map[s] || 'bg-slate-100 text-slate-700';
}
