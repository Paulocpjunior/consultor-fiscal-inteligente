/**
 * services/abrasfAdapterService.ts
 * Cliente HTTP do adapter ABRASF (Cidades nao migradas ao Padrao Nacional).
 */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessao expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

const BASE = '/api/admin/abrasf';

export interface MunicipioAbrasf {
    codIBGE: string;
    nome: string;
    uf: string;
    versao: string;
}

export interface AbrasfStatus {
    beta: boolean;
    municipiosSuportados: number;
    empresasElegiveis: number;
    empresasHabilitadas: number;
    ultimasSincronizacoes: Array<{
        empresaId: string;
        empresaCnpj: string;
        codMunIBGE: string;
        ultimaSync: string | null;
        ultimoPeriodo: { dataInicial: string; dataFinal: string } | null;
    }>;
}

export async function getMunicipios(): Promise<MunicipioAbrasf[]> {
    const res = await fetch(`${BASE}/municipios`, { headers: await authHeader() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return j.municipios;
}

export async function getStatus(): Promise<AbrasfStatus> {
    const res = await fetch(`${BASE}/status`, { headers: await authHeader() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function toggleEmpresa(empresaId: string, ativo: boolean): Promise<void> {
    const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
    const res = await fetch(`${BASE}/toggle/${empresaId}`, {
        method: 'POST', headers, body: JSON.stringify({ ativo }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
}

export async function syncOne(
    empresaId: string, dataInicial: string, dataFinal: string
): Promise<{ ok: boolean; tomado?: any; prestado?: any; erro?: string }> {
    const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
    const res = await fetch(`${BASE}/sync-one`, {
        method: 'POST', headers, body: JSON.stringify({ empresaId, dataInicial, dataFinal }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

export async function syncTodas(
    dataInicial: string, dataFinal: string
): Promise<{ totalEmpresas: number; processadas: number; falhas: number; detalhes: any[] }> {
    const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
    const res = await fetch(`${BASE}/sync-todas`, {
        method: 'POST', headers, body: JSON.stringify({ dataInicial, dataFinal }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

// ─── Diagnostico ─────────────────────────────────────────────────────────

export interface DiagnosticoItem {
    ok: boolean;
    item: string;
    detalhe: string;
}

export interface DiagnosticoResposta {
    cnpj: string;
    cadastrada: boolean;
    empresa?: { id: string; nome: string; colecao: string };
    checklist: DiagnosticoItem[];
    conclusao: string;
}

/**
 * Dado o CNPJ do cliente (tomador), faz checklist completo de por que
 * uma NFSe esperada nao chegou. Cobre Padrao Nacional + ABRASF.
 */
export async function diagnosticarCaptura(cnpj: string): Promise<DiagnosticoResposta> {
    const limpo = (cnpj || '').replace(/\D/g, '');
    const res = await fetch(`${BASE}/diagnostico/${limpo}`, { headers: await authHeader() });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
