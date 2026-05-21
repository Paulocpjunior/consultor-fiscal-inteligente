/**
 * services/nfseTomadaService.ts
 * Cliente HTTP pra /api/admin/nfse-nacional/tomadas/*
 *
 * Captura de NFSe TOMADAS via API Sefin Nacional / ADN.
 * Cada empresa usa SEU PRÓPRIO certificado A1 ICP-Brasil pra autenticar mTLS.
 */
import type {
    User,
    NfseTomada,
    NfseTomadaResumo,
    NfseTomadaSincSumario,
} from '../types';

import { getAuth } from 'firebase/auth';

const BASE = '/api/admin/nfse-nacional/tomadas';

async function authHeaders(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuario nao autenticado');
    const token = await u.getIdToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

export interface NfseTomadaStatus {
    mode: 'mock' | 'restrita' | 'producao';
    ok: boolean;
}

export async function getNfseTomadaStatus(): Promise<NfseTomadaStatus> {
    const res = await fetch(`${BASE}/status`);
    if (!res.ok) throw new Error(`getNfseTomadaStatus: ${res.status}`);
    return res.json();
}

export async function listarNfseTomadas(
    _user: User | null,
    params: { empresaId?: string; periodo?: string; limit?: number } = {},
): Promise<NfseTomada[]> {
    const qs = new URLSearchParams();
    if (params.empresaId) qs.set('empresaId', params.empresaId);
    if (params.periodo) qs.set('periodo', params.periodo);
    if (params.limit) qs.set('limit', String(params.limit));

    const res = await fetch(`${BASE}/listar?${qs.toString()}`, {
        headers: await authHeaders(),
    });
    if (!res.ok) throw new Error(`listarNfseTomadas: ${res.status}`);
    return res.json();
}

export async function resumoNfseTomadas(
    _user: User | null,
    params: { empresaId?: string; periodo?: string } = {},
): Promise<NfseTomadaResumo> {
    const qs = new URLSearchParams();
    if (params.empresaId) qs.set('empresaId', params.empresaId);
    if (params.periodo) qs.set('periodo', params.periodo);

    const res = await fetch(`${BASE}/resumo?${qs.toString()}`, {
        headers: await authHeaders(),
    });
    if (!res.ok) throw new Error(`resumoNfseTomadas: ${res.status}`);
    return res.json();
}

export async function sincronizarNfseTomadaEmpresa(
    _user: User | null,
    empresaId: string,
    cnpjTomador: string,
): Promise<NfseTomadaSincSumario> {
    const res = await fetch(`${BASE}/sincronizar/${encodeURIComponent(empresaId)}`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ cnpjTomador }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `sincronizar: ${res.status}`);
    }
    return res.json();
}

// ─── Helpers de UI ────────────────────────────────────────────────────────
export function formatBRL(v: number): string {
    return (v || 0).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL',
    });
}

export function formatChave(chave: string): string {
    if (!chave) return '';
    return chave.replace(/(.{4})/g, '$1 ').trim();
}

export function modoBadgeClass(modo: string): string {
    switch (modo) {
        case 'producao': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
        case 'restrita': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
        case 'mock':     return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
        default:         return 'bg-blue-100 text-blue-800';
    }
}

export function manifestacaoBadgeClass(m: string): string {
    switch (m) {
        case 'aceite':    return 'bg-green-100 text-green-800';
        case 'ciencia':   return 'bg-blue-100 text-blue-800';
        case 'rejeicao':  return 'bg-red-100 text-red-800';
        case 'pendente':
        default:          return 'bg-gray-100 text-gray-800';
    }
}
