/** Serviço de diagnóstico de configurações operacionais. */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

// 'informativo' = env vazia mas codigo tem default funcionando.
// Listado pra admin saber que pode customizar, mas NAO bloqueia produto.
export type CriticidadeConfig = 'critico' | 'alto' | 'medio' | 'informativo';
export type TipoAchado = 'env_vazia' | 'env_via_default' | 'modo_inadequado' | 'flag_indefinida';

export interface AchadoConfig {
    tipo: TipoAchado;
    chave: string;
    categoria: string;
    criticidade: CriticidadeConfig;
    descricao: string;
    impacto: string;
    valorAtual?: string;
}

export interface DiagnosticoConfigResposta {
    ambiente: string;
    resumo: {
        total: number;
        criticos: number;
        altos: number;
        medios: number;
        informativos?: number;
        ambiente: string;
    };
    achados: AchadoConfig[];
    geradoEm: string;
}

export async function getDiagnosticoConfig(): Promise<DiagnosticoConfigResposta> {
    const headers = await authHeader();
    const res = await fetch('/api/admin/diagnostico-config', { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
