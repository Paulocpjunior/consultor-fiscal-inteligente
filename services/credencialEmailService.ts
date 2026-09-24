/**
 * 🛡️ Vigia da credencial do e-mail (24/09). O backend sonda todo dia e grava
 * o veredito; a tela só EXIBE. Nenhuma régua mora aqui.
 */
import { getAuth } from 'firebase/auth';

export interface FaixaVigia { cor: 'vermelho' | 'amarelo'; titulo: string; detalhe: string; desde: string | null }

export async function lerVigiaCredencialEmail(): Promise<{ ok: boolean; error?: string; faixa?: FaixaVigia | null; vigia?: any }> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada' };
    const token = await u.getIdToken();
    const res = await fetch('/api/admin/credencial-email/vigia', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}
