/** Serviço de diagnóstico de configurações operacionais. */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

// 'informativo' = env vazia mas codigo tem default funcionando.
// 'opcional'    = gate de feature opcional (SharePoint/gateway) — so importa
//                 se a empresa usa aquela integracao. Nao bloqueia.
export type CriticidadeConfig = 'critico' | 'alto' | 'medio' | 'informativo' | 'opcional';
// 'segredo_forma_errada' = a env ESTÁ preenchida e o que está nela tem forma
// que a Microsoft recusa (o Secret ID no lugar do Valor, espaço colado).
// Preenchido é STATUS; a forma é RESULTADO.
export type TipoAchado = 'env_vazia' | 'env_via_default' | 'env_opcional' | 'modo_inadequado'
    | 'flag_indefinida' | 'segredo_forma_errada';

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
        opcionais?: number;
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
