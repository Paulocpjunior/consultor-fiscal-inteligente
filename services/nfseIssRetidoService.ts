/**
 * 🔁 Releitura da retenção do ISS no XML guardado (05/10).
 *
 * O leitor do padrão nacional gravava a retenção INVERTIDA (tpRetISSQN 1 é
 * "não retido"). A aba de ISS chama isto quando vê nota sem o carimbo de
 * conferida — falha volta dita, nunca como "tudo certo".
 */
import { getAuth } from 'firebase/auth';

export interface ReleituraIssRetido {
    ok: boolean;
    relidas: number;
    corrigidas: number;
    falhas: Array<{ id: string; numero: string | null; erro: string }>;
    naoLidasPorTeto: number;
    erro?: string;
}

export async function relerIssRetidoDoXml(p: { empresaId: string; competencia: string }): Promise<ReleituraIssRetido> {
    const vazio = { relidas: 0, corrigidas: 0, falhas: [], naoLidasPorTeto: 0 };
    try {
        const u = getAuth().currentUser;
        if (!u) return { ok: false, ...vazio, erro: 'Sessão expirada — entre de novo.' };
        const res = await fetch('/api/admin/nfse-iss-retido/reler', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` },
            body: JSON.stringify(p),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) return { ok: false, ...vazio, erro: j?.erro || `HTTP ${res.status}` };
        return { ok: true, relidas: j.relidas || 0, corrigidas: j.corrigidas || 0, falhas: j.falhas || [], naoLidasPorTeto: j.naoLidasPorTeto || 0 };
    } catch (e: any) {
        return { ok: false, ...vazio, erro: e?.message || String(e) };
    }
}
