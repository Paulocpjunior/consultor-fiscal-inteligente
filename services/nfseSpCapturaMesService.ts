/**
 * 🔁 Captura de NFS-e SP de UMA empresa num mês encerrado (09/10).
 *
 * A rodada automática só alcança os últimos ~40 dias. Esta chamada baixa o
 * mês inteiro pedido, só da empresa, e é isso que prova o "zero NFS-e" de um
 * mês antigo. Admin. Falha volta dita.
 */
import { getAuth } from 'firebase/auth';

export interface CapturaNfseSpMes {
    ok: boolean;
    anoMes?: string;
    prestadas?: number | null;
    tomadas?: number | null;
    erroPrestadas?: string | null;
    erroTomadas?: string | null;
    erro?: string;
}

export async function capturarNfseSpDoMes(p: { empresaId: string; anoMes: string }): Promise<CapturaNfseSpMes> {
    try {
        const u = getAuth().currentUser;
        if (!u) return { ok: false, erro: 'Sessão expirada — entre de novo.' };
        const res = await fetch('/api/admin/sefaz/nfsesp-capturar-empresa-mes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` },
            body: JSON.stringify(p),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok && !j?.anoMes) return { ok: false, erro: j?.erro || `HTTP ${res.status}` };
        return j as CapturaNfseSpMes;
    } catch (e: any) {
        return { ok: false, erro: e?.message || 'Falha de rede.' };
    }
}
