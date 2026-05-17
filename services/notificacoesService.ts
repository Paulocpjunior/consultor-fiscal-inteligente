/**
 * notificacoesService — cliente HTTP para o backend /api/admin/notificacoes.
 * Por ora expõe o teste de e-mail via Microsoft Graph.
 */
import { getAuth } from 'firebase/auth';

const BASE = '/api/admin/notificacoes';

async function authHeaders(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuário não autenticado');
    const token = await u.getIdToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

/** Dispara um e-mail de teste. Sem remetente/para, o backend usa o e-mail do admin logado. */
export async function testarEmailGraph(): Promise<{ ok: boolean; error?: string; para?: string }> {
    try {
        const res = await fetch(`${BASE}/teste-email`, {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
            return { ok: true, para: data.para };
        }
        return { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (err: any) {
        return { ok: false, error: err?.message || 'Falha na chamada' };
    }
}

/** Dispara o resumo diário de capturas (coleta + envia e-mail). Backend usa o e-mail do admin logado. */
export async function testarResumoDiario(): Promise<{ ok: boolean; error?: string; resumo?: any }> {
    try {
        const res = await fetch(`${BASE}/teste-resumo`, {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
            return { ok: true, resumo: data.resumo };
        }
        return { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (err: any) {
        return { ok: false, error: err?.message || 'Falha na chamada' };
    }
}
