/**
 * relatoriosService.ts — I/O do menu Relatórios (a agregação vive no backend).
 */
import { getAuth } from 'firebase/auth';

export interface FaturamentoLinha {
    empresaId: string;
    nome: string;
    cnpj: string;
    regime: 'simples' | 'lucro';
    colaborador: string | null;
    entradasQtd: number;
    entradasValor: number;
    saidasQtd: number;
    saidasValor: number;
}

export interface FaturamentoResp {
    ok: boolean;
    error?: string;
    competencia?: string;
    escopo?: 'carteira' | 'todas';
    linhas?: FaturamentoLinha[];
    totais?: { empresas: number; entradasQtd: number; entradasValor: number; saidasQtd: number; saidasValor: number };
    semMovimento?: number;
    ignoradosSemEmpresa?: number;
}

export async function carregarFaturamento(competencia: string): Promise<FaturamentoResp> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' };
    const token = await u.getIdToken();
    const res = await fetch(`/api/admin/relatorios/faturamento?competencia=${encodeURIComponent(competencia)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}

export interface FaturamentoMensalResp {
    ok: boolean;
    error?: string;
    meses?: string[];
    /** competência → { valor apurado, nº de documentos de saída lidos } */
    porMes?: Record<string, { valor: number; docs: number; lidos: number }>;
}

/** Faturamento mês a mês de UMA empresa — fonte da Declaração de Faturamento. */
export async function carregarFaturamentoMensal(
    empresaId: string, de: string, ate: string,
): Promise<FaturamentoMensalResp> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' };
    const token = await u.getIdToken();
    const qs = new URLSearchParams({ empresaId, de, ate }).toString();
    const res = await fetch(`/api/admin/relatorios/faturamento-mensal?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}
