/**
 * rotinaFiscalService.ts — a LINHA do mês (Paulo, 28/07/2026).
 *
 * A rotina do departamento tem ordem: captura → validação das notas →
 * apuração → entrega das obrigações → emissão e envio das guias. O app tinha
 * todas as telas, mas nenhuma dizia ONDE cada cliente está. Esta é a leitura
 * do trilho — o backend deriva cada etapa de dado real (nada se marca como
 * feito na mão).
 */
import { getAuth } from 'firebase/auth';

export type StatusEtapa = 'pendente' | 'atencao' | 'concluida' | 'na';

export interface EtapaRotina {
    id: 'captura' | 'validacao' | 'apuracao' | 'obrigacoes' | 'guias';
    ordem: number;
    nome: string;
    onde: string;
    status: StatusEtapa;
    resumo: string;
    acao: string | null;
    /** extras por etapa (entradas/saidas, resumos, concluidas/total, envios…) */
    [k: string]: any;
}

export interface RotinaEmpresa {
    empresa: { id: string; nome: string; cnpj: string; regime: 'simples' | 'lucro' } | null;
    competencia: string;
    etapas: EtapaRotina[];
    proximoPasso: { id: string; ordem: number; nome: string; onde: string; acao: string | null; resumo: string } | null;
    progresso: { concluidas: number; total: number };
    farol: 'ok' | 'atencao' | 'pendente';
}

export interface FunilRotina {
    total: number;
    completos: number;
    etapas: { id: string; ordem: number; nome: string; qtd: number; empresas: string[] }[];
    resumo: string;
}

export interface PainelRotina {
    ok: boolean;
    error?: string;
    competencia?: string;
    escopo?: 'carteira' | 'todas';
    funil?: FunilRotina;
    rotinas?: RotinaEmpresa[];
    lidos?: { documentos: number; tarefas: number; envios: number };
    geradoEm?: string;
}

export async function carregarRotinaFiscal(competencia: string): Promise<PainelRotina> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' };
    const token = await u.getIdToken();
    const res = await fetch(`/api/admin/rotina-fiscal/painel?competencia=${encodeURIComponent(competencia)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}
