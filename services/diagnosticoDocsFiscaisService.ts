/**
 * Serviço de diagnóstico de saúde dos documentos_fiscais.
 */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

export interface AmostraDoc {
    docId: string;
    chave?: string | null;
    competencia?: string | null;
    direcao?: string | null;
    valor?: number;
    empresaCnpj?: string;
    empresaNome?: string;
}
export interface AmostraDuplicada {
    chave: string;
    docIds: string[];
    qtd: number;
}
export interface Problema {
    count: number;
    amostras: (AmostraDoc | AmostraDuplicada)[];
}

export interface DiagnosticoResposta {
    empresaIdFiltro: string | null;
    totalDocs: number;
    totalProblemas: number;
    problemas: {
        sem_chave: Problema;
        sem_competencia: Problema;
        sem_direcao: Problema;
        sem_valor: Problema;
        sem_empresa: Problema;
        duplicada: Problema;
    };
    geradoEm: string;
}

export async function getDiagnosticoDocsFiscais(empresaId?: string): Promise<DiagnosticoResposta> {
    const headers = await authHeader();
    const qs = empresaId ? `?empresaId=${encodeURIComponent(empresaId)}` : '';
    const res = await fetch(`/api/admin/diagnostico-docs-fiscais${qs}`, { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
