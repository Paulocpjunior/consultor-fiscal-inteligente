/**
 * Serviço de cobertura DCTFWeb — mesma idéia do dasCoberturaService, mas pra
 * Lucro Presumido/Real. Lista quais empresas não transmitiram a DCTFWeb
 * (situação ATIVA) nas últimas competências. Risco: autuação automática.
 */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

export interface MesCoberturaDctfweb {
    competencia: string;
    transmitido: boolean;
    situacao?: 'ATIVA' | 'EM_ANDAMENTO';
    valor?: number;
}

export interface EmpresaCoberturaDctfweb {
    id: string;
    cnpj: string;
    nome: string;
    gaps: number;
    emAndamento: number;
    meses: MesCoberturaDctfweb[];
}

export interface CoberturaDctfwebResposta {
    mesesAnalisados: number;
    competencias: string[];
    totalEmpresas: number;
    empresasComGap: number;
    totalGaps: number;
    totalEmAndamento: number;
    /** true se algum ano Firestore falhou — evita "falso vermelho" na UI */
    degraded?: boolean;
    anosFalhos?: number[];
    empresas: EmpresaCoberturaDctfweb[];
}

export async function getCoberturaDctfweb(meses = 6): Promise<CoberturaDctfwebResposta> {
    const headers = await authHeader();
    const res = await fetch(`/api/admin/dctfweb/cobertura?meses=${meses}`, { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
