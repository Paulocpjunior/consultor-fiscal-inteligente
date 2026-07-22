/**
 * backlogEntradaService.ts — cliente do GET /api/admin/sefaz/backlog-entrada.
 *
 * Backlog de entrada por empresa: completas × resumos pendentes de ciência ×
 * travadas (NSU) — o termômetro do "substituir a SIEG" na captura de entrada.
 */
import { getAuth } from 'firebase/auth';

export type BacklogEntradaStatus =
    | 'ok' | 'sem-captura' | 'aguardando-completa' | 'pendente-ciencia' | 'travada';

export interface BacklogEntradaLinha {
    empresaId: string;
    cnpj: string;
    nome: string;
    regime: string;
    totalEntradas: number;
    completas: number;
    resumosManifestados: number;
    resumosPendentes: number;
    resumosForaPrazo: number;
    ultimaSyncMs: number | null;
    cStatUltimaSync: string | null;
    pendenciaNSU: number;
    nsuTravado: string | null;
    travada: boolean;
    status: BacklogEntradaStatus;
    pctCompleta: number | null;
}

export interface BacklogEntradaResumo {
    totalEmpresas: number;
    comEntradas: number;
    travadas: number;
    pendentesCiencia: number;
    aguardandoCompleta: number;
    semCaptura: number;
    ok: number;
    totalDocs: number;
    totalCompletas: number;
    totalResumosPendentes: number;
    totalResumosManifestados: number;
    totalResumosForaPrazo: number;
    docsSemEmpresa: number;
}

export interface BacklogEntradaResposta {
    resumo: BacklogEntradaResumo;
    linhas: BacklogEntradaLinha[];
    geradoEm: string;
}

export async function getBacklogEntrada(): Promise<BacklogEntradaResposta> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    const token = await u.getIdToken();
    const res = await fetch('/api/admin/sefaz/backlog-entrada', {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}
