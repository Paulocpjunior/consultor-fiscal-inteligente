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

// ── Varredura da carteira inteira (admin) ────────────────────────────────────

export interface NotaCorrigida {
    id: string; empresaId: string | null; empresaNome: string | null; empresaCnpj: string | null;
    competencia: string | null; numero: string | null; direcao: string | null; antes: boolean; depois: boolean;
}

export interface ProgressoVarredura {
    examinadas: number; relidas: number; corrigidas: NotaCorrigida[];
    falhas: Array<{ id: string; numero: string | null; empresaNome?: string | null; erro: string }>;
    concluida: boolean; erro?: string;
}

async function postAdmin(caminho: string, body: unknown): Promise<any> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada — entre de novo.');
    const res = await fetch(`/api/admin/nfse-iss-retido/${caminho}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` },
        body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) throw new Error(j?.erro || `HTTP ${res.status}`);
    return j;
}

/**
 * Varre todas as NFS-e gravadas, em lotes, relendo a retenção do XML. Chama
 * `aoAvancar` a cada lote. Parar no meio não perde nada: o que foi relido
 * sai da fila, e uma nova varredura continua do que falta.
 */
export async function varrerCarteiraIssRetido(aoAvancar: (p: ProgressoVarredura) => void): Promise<ProgressoVarredura> {
    const acc: ProgressoVarredura = { examinadas: 0, relidas: 0, corrigidas: [], falhas: [], concluida: false };
    let cursor: string | null = null;
    try {
        do {
            const j = await postAdmin('varrer', { cursor });
            acc.examinadas += j.examinadas || 0;
            acc.relidas += j.relidas || 0;
            acc.corrigidas.push(...(j.corrigidas || []));
            acc.falhas.push(...(j.falhas || []));
            cursor = j.proximoCursor || null;
            aoAvancar({ ...acc });
        } while (cursor);
        acc.concluida = true;
    } catch (e: any) {
        acc.erro = e?.message || String(e);
    }
    aoAvancar({ ...acc });
    return acc;
}

export interface EnviosIssDoPar {
    empresaCnpj: string; competencia: string;
    envios: Array<{ tipo: string | null; valor: number | null; enviadoEm: string | null; para: string | null }>;
}

/** As guias de ISS que JÁ saíram para as empresas × competências afetadas. */
export async function enviosIssDosPares(pares: Array<{ empresaCnpj: string; competencia: string }>): Promise<{ resultado: EnviosIssDoPar[]; falhas: any[] }> {
    const j = await postAdmin('envios-iss', { pares });
    return { resultado: j.resultado || [], falhas: j.falhas || [] };
}
