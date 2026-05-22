/**
 * services/agentesA3Service.ts
 * Cliente HTTP pra /api/admin/agent (gestão de API keys + tipoCert).
 */
import { getAuth } from 'firebase/auth';

const BASE = '/api/admin/agent';

async function authHeaders(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada — faça login novamente');
    const token = await u.getIdToken();
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };
}

export interface AgentKey {
    keyId: string;
    ownerUid: string;
    ownerEmail: string | null;
    label: string;
    createdAt: number | null;
    lastUsedAt: number | null;
    revoked: boolean;
    revokedAt: number | null;
}

/**
 * Lista todas as keys (sem hashes). Admin vê todas.
 */
export async function listarAgentKeys(): Promise<AgentKey[]> {
    const res = await fetch(`${BASE}/agent-keys`, { headers: await authHeaders() });
    if (!res.ok) throw new Error(`listarAgentKeys: HTTP ${res.status}`);
    const json = await res.json();
    return json.keys || [];
}

/**
 * Gera uma key nova. Retorna a key crua UMA VEZ — o admin precisa copiar imediatamente.
 */
export async function gerarAgentKey(ownerUid: string, label: string): Promise<{ keyId: string; apiKey: string }> {
    const res = await fetch(`${BASE}/agent-keys`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ ownerUid, label }),
    });
    if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `gerarAgentKey: HTTP ${res.status}`);
    }
    const json = await res.json();
    return { keyId: json.keyId, apiKey: json.apiKey };
}

/**
 * Revoga uma key. Irreversível — depois disso o agente perde acesso.
 */
export async function revogarAgentKey(keyId: string): Promise<void> {
    const res = await fetch(`${BASE}/agent-keys/${encodeURIComponent(keyId)}`, {
        method: 'DELETE',
        headers: await authHeaders(),
    });
    if (!res.ok) throw new Error(`revogarAgentKey: HTTP ${res.status}`);
}

/**
 * Marca uma empresa como A1 ou A3. A3 faz a empresa sair do cron noturno
 * (só captura pelo agente local cfi-a3).
 */
export async function marcarTipoCert(empresaId: string, tipoCert: 'A1' | 'A3'): Promise<void> {
    const res = await fetch(`${BASE}/cert-empresa/tipo`, {
        method: 'PATCH',
        headers: await authHeaders(),
        body: JSON.stringify({ empresaId, tipoCert }),
    });
    if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `marcarTipoCert: HTTP ${res.status}`);
    }
}
