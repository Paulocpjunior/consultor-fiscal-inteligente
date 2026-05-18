/**
 * services/darfService.ts
 * Cliente HTTP pra /api/admin/darf.
 */
import type {
    User, DarfEmitido, DarfResumo, DarfStatusPagamento,
    DarfEmissaoInput, DarfCodigoReceita, DarfRegime, DarfTributo,
    DarfPeriodicidade,
} from '../types';

import { getAuth } from 'firebase/auth';

const BASE = '/api/admin/darf';

async function authHeaders(_user: User | null): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuario nao autenticado');
    const token = await u.getIdToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

export async function getResumoDarf(user: User | null): Promise<DarfResumo> {
    const res = await fetch(`${BASE}/resumo`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`getResumoDarf: ${res.status}`);
    return res.json();
}

export async function listarDarfs(
    user: User | null,
    filters: {
        empresaId?: string;
        competencia?: string;
        tributo?: DarfTributo;
        regime?: DarfRegime;
        status?: DarfStatusPagamento;
    } = {}
): Promise<DarfEmitido[]> {
    const qs = new URLSearchParams();
    if (filters.empresaId)   qs.set('empresaId',   filters.empresaId);
    if (filters.competencia) qs.set('competencia', filters.competencia);
    if (filters.tributo)     qs.set('tributo',     filters.tributo);
    if (filters.regime)      qs.set('regime',      filters.regime);
    if (filters.status)      qs.set('status',      filters.status);

    const res = await fetch(`${BASE}/listar?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`listarDarfs: ${res.status}`);
    return res.json();
}

export async function emitirDarf(user: User | null, payload: DarfEmissaoInput): Promise<DarfEmitido> {
    const res = await fetch(`${BASE}/emitir`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `emitirDarf: ${res.status}`);
    }
    return res.json();
}

export async function marcarDarfPago(
    user: User | null, docId: string, dataPagamento?: string
): Promise<{ ok: boolean }> {
    const res = await fetch(`${BASE}/marcar-pago`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify({ docId, dataPagamento }),
    });
    if (!res.ok) throw new Error(`marcarDarfPago: ${res.status}`);
    return res.json();
}

export async function listarCodigosReceita(user: User | null): Promise<DarfCodigoReceita[]> {
    const res = await fetch(`${BASE}/codigos-receita`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`listarCodigosReceita: ${res.status}`);
    return res.json();
}

export async function sugerirCodigoReceita(
    user: User | null, regime: DarfRegime, tributo: DarfTributo, periodicidade?: DarfPeriodicidade
): Promise<DarfCodigoReceita | null> {
    const qs = new URLSearchParams({ regime, tributo });
    if (periodicidade) qs.set('periodicidade', periodicidade);
    const res = await fetch(`${BASE}/sugerir-codigo?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`sugerirCodigoReceita: ${res.status}`);
    const j = await res.json();
    if (!j || !j.codigo) return null;
    return j;
}
