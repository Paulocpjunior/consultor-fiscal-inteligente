/**
 * 💳 Crédito de IPI / ICMS-ST lançado em "Outras despesas" (08/10).
 *
 * Grava ou desfaz o ajuste carimbado no documento — a régua (o que pode e o
 * que não pode) mora em `sefaz-backend/credito-outras-despesas.js` e o
 * servidor confere de novo antes de gravar. Falha volta dita.
 */
import { getAuth } from 'firebase/auth';

export interface AjusteCreditoOutras {
    itens: Array<{ indice: number; ipi: number; st: number }>;
    motivo: string;
    total: number;
    autor?: { uid: string | null; email: string | null };
    em?: string;
}

type Resposta = { ok: true; ajuste?: AjusteCreditoOutras } | { ok: false; erro: string };

async function chamar(docId: string, method: 'POST' | 'DELETE', corpo: unknown): Promise<Resposta> {
    try {
        const u = getAuth().currentUser;
        if (!u) return { ok: false, erro: 'Sessão expirada — entre de novo.' };
        const res = await fetch(`/api/credito-outras-despesas/${encodeURIComponent(docId)}`, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` },
            body: JSON.stringify(corpo),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) return { ok: false, erro: j?.erro || `HTTP ${res.status}` };
        return { ok: true, ajuste: j.ajuste };
    } catch (e: any) {
        return { ok: false, erro: e?.message || 'Falha de rede.' };
    }
}

export function gravarCreditoOutrasDespesas(
    docId: string,
    p: { itens: Array<{ indice: number; ipi: number; st: number }>; motivo: string },
): Promise<Resposta> {
    return chamar(docId, 'POST', p);
}

export function desfazerCreditoOutrasDespesas(docId: string, motivo?: string): Promise<Resposta> {
    return chamar(docId, 'DELETE', { motivo: motivo || '' });
}
