/** Serviço de monitoramento de certificados digitais. */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

export type FaixaCert = 'expirado' | '1' | '3' | '7' | '15' | '30' | null;
export type SeveridadeCert = 'critica' | 'alta' | 'media' | 'baixa';

export interface CertItem {
    escopo: 'sefaz_global' | 'empresa';
    empresaId?: string;
    cnpj: string | null;
    titular: string;
    notAfter: string;
    diasRestantes: number | null;
    faixa: FaixaCert;
    severidade: SeveridadeCert;
    labelUrgencia: string;
    afeta: string;
}

export interface CertMonitorResposta {
    resumo: {
        total: number;
        expirados: number;
        criticos: number;
        urgentes: number;
        atencao: number;
        ok: number;
    };
    certs: CertItem[];
    geradoEm: string;
}

export async function getCertMonitor(): Promise<CertMonitorResposta> {
    const headers = await authHeader();
    const res = await fetch('/api/admin/cert-monitor', { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
