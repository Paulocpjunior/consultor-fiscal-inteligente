/**
 * 🏛️ Cadastro de IE de substituto tributário por UF (08/10).
 *
 * Fixo por empresa: com ele o E250 do ICMS-ST sai sozinho em toda
 * competência. A régua mora em `sefaz-backend/st-cadastro-uf.js` e o servidor
 * confere de novo antes de gravar. Falha volta dita.
 */
import { getAuth } from 'firebase/auth';

export interface LinhaStUf { uf: string; ie: string; codOr: string; codRec: string; diaVencimento: number }
export interface CadastroStUf {
    ufs: Record<string, Omit<LinhaStUf, 'uf'>>;
    atualizadoPor: string | null;
    atualizadoEm: string | null;
}

type Resp<T> = ({ ok: true } & T) | { ok: false; erro: string };

async function chamar<T>(empresaId: string, method: 'GET' | 'PUT', corpo?: unknown): Promise<Resp<T>> {
    try {
        const u = getAuth().currentUser;
        if (!u) return { ok: false, erro: 'Sessão expirada — entre de novo.' };
        const res = await fetch(`/api/sped-st-por-uf/${encodeURIComponent(empresaId)}`, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` },
            ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) return { ok: false, erro: j?.erro || `HTTP ${res.status}` };
        return j as { ok: true } & T;
    } catch (e: any) {
        return { ok: false, erro: e?.message || 'Falha de rede.' };
    }
}

export function lerCadastroStUf(empresaId: string): Promise<Resp<CadastroStUf>> {
    return chamar<CadastroStUf>(empresaId, 'GET');
}

export function gravarCadastroStUf(empresaId: string, linhas: LinhaStUf[]): Promise<Resp<CadastroStUf>> {
    return chamar<CadastroStUf>(empresaId, 'PUT', { linhas });
}
