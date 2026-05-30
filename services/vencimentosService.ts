/**
 * vencimentosService.ts
 * Cliente do endpoint /api/admin/vencimentos/resumo + ações de cron-now.
 */

import { getAuth } from 'firebase/auth';

export interface ResumoVencimentos {
    atrasadas: number;
    venceHoje: number;
    venceAmanha: number;
    vence3d: number;
    vence7d: number;
    vence30d: number;
    total: number;
}

export interface ProximaObrigacao {
    id: string;
    titulo: string;
    empresaNome: string;
    empresaCnpj: string;
    obrigacao: string;
    competencia: string;
    vencimento: string | null;
    diasAteVencimento: number;
    responsavel: string | null;
    responsavelNome: string | null;
    valorEstimado: number | null;
}

export interface VencimentosResponse {
    resumo: ResumoVencimentos;
    proximas: ProximaObrigacao[];
    geradoEm: string;
}

async function getToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return u.getIdToken();
}

export async function fetchResumoVencimentos(): Promise<VencimentosResponse> {
    const token = await getToken();
    const res = await fetch('/api/admin/vencimentos/resumo', {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

export async function dispararCronVencimentos(): Promise<{ ok: boolean; motivo?: string; error?: string }> {
    const token = await getToken();
    const res = await fetch('/api/admin/vencimentos/cron-now', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, motivo: data.motivo };
}
