/**
 * services/simuladorReformaService.ts
 * Cliente HTTP do Simulador IBS/CBS (Reforma Tributaria 2026-2033).
 */
import type { User, SimulacaoReforma, SimuladorIaResponse, RegimeReforma } from '../types';
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

export async function simular(
    user: User | null,
    faturamentoAnual: number,
    regime: RegimeReforma,
    dasAtualAnual?: number
): Promise<SimulacaoReforma> {
    const res = await fetch('/api/admin/simulador-ibs-cbs', {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify({ faturamentoAnual, regime, dasAtualAnual }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `simular: ${res.status}`);
    }
    return res.json();
}

export async function explicarSimulacao(
    user: User | null,
    simulacao: SimulacaoReforma,
    empresaNome?: string
): Promise<SimuladorIaResponse> {
    const res = await fetch('/api/admin/simulador-ibs-cbs-explicar', {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify({ simulacao, empresaNome }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `explicarSimulacao: ${res.status}`);
    }
    return res.json();
}

export function formatBRL(v: number): string {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
