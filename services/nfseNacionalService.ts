/**
 * services/nfseNacionalService.ts
 * Cliente HTTP pra /api/admin/nfse-nacional.
 */
import type { User, NfseNacionalEmitida, NfseNacResumo, NfseNacStatus, NbsCodigo } from '../types';

const BASE = '/api/admin/nfse-nacional';

function authHeaders(user: User | null): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'X-User-Role': user?.role || 'colaborador',
    };
}

export async function getResumoNfse(user: User | null): Promise<NfseNacResumo> {
    const res = await fetch(`${BASE}/resumo`, { headers: authHeaders(user) });
    if (!res.ok) throw new Error(`getResumoNfse: ${res.status}`);
    return res.json();
}

export async function listarNfse(
    user: User | null,
    filters: { empresaId?: string; status?: NfseNacStatus; dataInicio?: string; dataFim?: string } = {}
): Promise<NfseNacionalEmitida[]> {
    const qs = new URLSearchParams();
    if (filters.empresaId) qs.set('empresaId', filters.empresaId);
    if (filters.status) qs.set('status', filters.status);
    if (filters.dataInicio) qs.set('dataInicio', filters.dataInicio);
    if (filters.dataFim) qs.set('dataFim', filters.dataFim);

    const res = await fetch(`${BASE}/listar?${qs}`, { headers: authHeaders(user) });
    if (!res.ok) throw new Error(`listarNfse: ${res.status}`);
    return res.json();
}

export async function getNbsCodigos(): Promise<NbsCodigo[]> {
    const res = await fetch(`${BASE}/nbs`);
    if (!res.ok) throw new Error(`getNbsCodigos: ${res.status}`);
    return res.json();
}

export interface EmitirNfseRequest {
    empresaId: string;
    prestador: { cnpj: string; im?: string; nome?: string };
    tomador: { cnpj?: string; cpf?: string; nome: string; endereco?: any };
    servico: {
        codigoNbs: string;
        descricao: string;
        valor: number;
        aliquotaIss: number;
        issRetido?: boolean;
        municipioPrestacao?: string;
    };
    dataEmissao?: string;
}

export async function emitirNfse(user: User | null, payload: EmitirNfseRequest): Promise<NfseNacionalEmitida> {
    const res = await fetch(`${BASE}/emitir`, {
        method: 'POST',
        headers: authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `emitirNfse: ${res.status}`);
    }
    return res.json();
}

export async function cancelarNfse(user: User | null, chave: string, motivo?: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${BASE}/cancelar`, {
        method: 'POST',
        headers: authHeaders(user),
        body: JSON.stringify({ chave, motivo }),
    });
    if (!res.ok) throw new Error(`cancelarNfse: ${res.status}`);
    return res.json();
}

// Helpers
export function formatBRL(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatChave(chave: string): string {
    if (!chave || chave.length < 50) return chave;
    return chave.match(/.{1,4}/g)?.join(' ') || chave;
}

export function statusBadgeClass(status: string): string {
    const map: Record<string, string> = {
        autorizada: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
        cancelada: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    };
    return map[status] || 'bg-slate-100 text-slate-700';
}
