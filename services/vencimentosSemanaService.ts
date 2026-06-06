/**
 * Serviço de vencimentos da semana — usa o /vencimentos/resumo existente que
 * já entrega as próximas obrigações em 7 dias, filtradas por carteira do user.
 */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

export interface TarefaProxima {
    id: string;
    titulo: string;
    empresaNome: string;
    empresaCnpj: string;
    obrigacao: string;
    competencia: string;
    vencimento: string | null;
    diasAteVencimento: number;
    responsavel: string;
    responsavelNome: string;
    valorEstimado: number | null;
}

export interface ResumoVencimentos {
    resumo: {
        atrasadas: number; venceHoje: number; venceAmanha: number;
        vence3d: number; vence7d: number; vence30d: number; total: number;
    };
    proximas: TarefaProxima[];
    geradoEm: string;
}

export async function getResumoVencimentos(): Promise<ResumoVencimentos> {
    const headers = await authHeader();
    const res = await fetch('/api/admin/vencimentos/resumo', { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
