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

/**
 * Resultado da releitura de campos de item a partir do XML no Storage.
 *
 * Cada contador é uma CAUSA com ação diferente — "0 recuperadas" sem dizer o
 * quê foi exatamente o alarme sem ação de 13/08.
 */
export interface RelerItensResposta {
    ok: boolean;
    competencia: string;
    examinadas: number;
    /** Documentos que ganharam campo novo. */
    atualizadas: number;
    /** Sem o XML guardado — buraco de captura, não de leitura. */
    semXml: number;
    /** Já passaram por esta versão do extrator: clicar de novo não faz nada. */
    jaRelidas: number;
    semItens: number;
    /** Itens não pareáveis: ficam INTACTAS e nomeadas, para conferência humana. */
    naoPareadas: number;
    /** Relidas e o XML realmente não tinha o campo — não adianta reclicar. */
    semDadoNoXml: number;
    porCampo: Record<string, number>;
    naoPareadasDetalhe: Array<{ chave: string; numero: string | null; motivo: string }>;
    error?: string;
}

/** Relê do XML-fonte os campos de item que o extrator aprendeu depois. */
export async function relerItensFiscais(
    empresaId: string,
    competencia: string,
): Promise<RelerItensResposta> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/reler-itens-fiscais', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId, competencia }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}
