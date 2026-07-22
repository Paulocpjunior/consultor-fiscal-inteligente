/**
 * ipiVarreduraService.ts — cliente do GET /api/admin/sefaz/ipi-varredura.
 *
 * Varredura de IPI (motivação: Experte 06/2026): quais empresas Lucro têm IPI
 * apurado na competência e se o MIT delas já tem mês-modelo com IPI (transmite
 * sozinha) ou se precisam de 1º lançamento manual no e-CAC.
 */
import { getAuth } from 'firebase/auth';

export type IpiVarreduraStatus =
    | 'pronta' | 'precisa_lancamento' | 'erro_consulta' | 'sem_ipi' | 'verificar_mit';

export interface IpiVarreduraLinha {
    empresaId: string;
    cnpj: string;
    nome: string;
    regime: string;
    temFicha: boolean;
    ipiApurado: number;
    temModeloIpi: boolean | null;
    modeloPeriodo: string | null;
    erroConsulta: string | null;
    status: IpiVarreduraStatus;
    titulo: string;
    acao: string;
    prioridade: number;
}

export interface IpiVarreduraResumo {
    total: number;
    comIpi: number;
    pronta: number;
    precisaLancamento: number;
    erroConsulta: number;
    semIpi: number;
    ipiTotalApurado: number;
    ipiTotalEmRisco: number;
}

export interface IpiVarreduraResposta {
    competencia: string;
    consultouMit: boolean;
    resumo: IpiVarreduraResumo;
    linhas: IpiVarreduraLinha[];
    geradoEm: string;
}

async function getToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return u.getIdToken();
}

export async function getIpiVarredura(
    competencia: string,
    consultarMit: boolean,
): Promise<IpiVarreduraResposta> {
    const token = await getToken();
    const qs = new URLSearchParams({ competencia, ...(consultarMit ? { consultarMit: '1' } : {}) });
    const res = await fetch(`/api/admin/sefaz/ipi-varredura?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}
