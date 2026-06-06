/**
 * Serviço de cobertura PGDAS-D.
 *
 * Pra cada empresa Simples ativa, lista as competências dos últimos N meses
 * onde NÃO há das_emitidos. Esse é o gap clássico: contador esquece de
 * transmitir o PGDAS-D de uma empresa e a Receita autua automaticamente.
 */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

export interface MesCobertura {
    competencia: string;
    transmitido: boolean;
    valor?: number;
    statusPagamento?: 'pago' | 'pendente' | 'vencido';
}

export interface EmpresaCoberturaPgdas {
    id: string;
    cnpj: string;
    nome: string;
    gaps: number;
    vencidos: number;
    meses: MesCobertura[];
}

export interface CoberturaPgdasResposta {
    mesesAnalisados: number;
    competencias: string[];
    totalEmpresas: number;
    empresasComGap: number;
    totalGaps: number;
    totalVencidos: number;
    /** true se algum chunk Firestore falhou — evita "falso vermelho" na UI */
    degraded?: boolean;
    competenciasIncompletas?: string[];
    empresas: EmpresaCoberturaPgdas[];
}

export async function getCoberturaPgdas(meses = 6): Promise<CoberturaPgdasResposta> {
    const headers = await authHeader();
    const res = await fetch(`/api/admin/das/cobertura-pgdas?meses=${meses}`, { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
