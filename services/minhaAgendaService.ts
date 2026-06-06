/**
 * Serviço da "minha agenda fiscal" — dashboard consolidado por carteira:
 * pra cada empresa que o colaborador é responsável (admin = todas), traz
 * o risco fiscal real da semana num único JSON.
 */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

export interface ContagemMsg {
    criticas: number;
    altas: number;
    medias: number;
    baixas: number;
    total: number;
}

export interface EmpresaAgenda {
    id: string;
    cnpj: string;
    nome: string;
    regime: 'simples' | 'lucro';
    score: number;
    pendencias: string[];
    pgdas: { gaps: number; gapsCompetencias: string[] } | null;
    dctfweb: { gaps: number; gapsCompetencias: string[] } | null;
    mensagens: ContagemMsg;
}

export interface MinhaAgendaResposta {
    usuario: { uid: string; email: string; role: string };
    mesesAnalisados: number;
    competencias: string[];
    totalEmpresas: number;
    empresasComRisco: number;
    riscoCritico: number;
    empresas: EmpresaAgenda[];
}

export async function getMinhaAgenda(meses = 3): Promise<MinhaAgendaResposta> {
    const headers = await authHeader();
    const res = await fetch(`/api/admin/minha-agenda?meses=${meses}`, { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
