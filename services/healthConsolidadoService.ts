/** Serviço do health consolidado — saúde geral do sistema. */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

export type StatusGlobal = 'ok' | 'medio' | 'alto' | 'critico' | 'degraded';

export interface SecaoCadastros {
    total: number; criticos: number; altos: number; medios: number; ok: number;
}
export interface SecaoDocumentos {
    total: number;
    semChave: number; semCompetencia: number; semDirecao: number; semValor: number; semEmpresa: number;
    duplicadas: number;
}
export interface SecaoCertificados {
    total: number; expirados: number; criticos: number; urgentes: number; atencao: number; ok: number;
}
export interface SecaoConfiguracoes {
    total: number; criticos: number; altos: number; medios: number;
}

export interface HealthConsolidadoResposta {
    status: StatusGlobal;
    totais: { critico: number; alto: number };
    secoes: {
        cadastros: SecaoCadastros | null;
        documentos: SecaoDocumentos | null;
        certificados: SecaoCertificados | null;
        configuracoes: SecaoConfiguracoes | null;
    };
    _erros: { secao: string; erro: string }[];
    geradoEm: string;
}

export async function getHealthConsolidado(): Promise<HealthConsolidadoResposta> {
    const headers = await authHeader();
    const res = await fetch('/api/admin/health-consolidado', { headers });
    // Aceita 200 e 503 — 503 = "rodou ok mas tem problema crítico"
    if (!res.ok && res.status !== 503) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
