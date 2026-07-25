/**
 * empresasMergeService.ts — mesclagem de empresas DUPLICADAS (admin).
 * Preview obrigatório → confirmação → executar (o servidor remonta tudo).
 * Vencedor mantém tudo; do perdedor entram só meses/lançamentos que faltam;
 * perdedor vira lápide _merged_into (enumeradores já pulam).
 */
import { getAuth } from 'firebase/auth';

export interface MergeResumo {
    fichasCopiadas: number;
    mesesFaturamentoCopiados: number;
    mesesDetalhadoCopiados: number;
    mesesFolhaCopiados: number;
    calculosCopiados: number;
    camposCadastroPreenchidos: number;
}

export interface MergeResposta {
    ok: boolean;
    error?: string;
    resumo?: MergeResumo;
    conflitos?: string[];
    vencedor?: { id: string; nome: string };
    perdedor?: { id: string; nome: string };
    logId?: string | null;
}

async function post(path: string, body: unknown): Promise<MergeResposta> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    const token = await u.getIdToken();
    const res = await fetch(path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}

export const previewMesclagem = (regime: 'lucro' | 'simples', vencedorId: string, perdedorId: string) =>
    post('/api/admin/empresas-merge/preview', { regime, vencedorId, perdedorId });

export const executarMesclagem = (regime: 'lucro' | 'simples', vencedorId: string, perdedorId: string) =>
    post('/api/admin/empresas-merge/executar', { regime, vencedorId, perdedorId });

/** Descreve o resumo do preview em português pro confirm() do admin. */
export function descreverResumo(r: MergeResumo | undefined, conflitos: string[] | undefined): string {
    if (!r) return '';
    const partes = [
        r.fichasCopiadas > 0 && `${r.fichasCopiadas} ficha(s) financeira(s)`,
        r.mesesFaturamentoCopiados > 0 && `${r.mesesFaturamentoCopiados} mês(es) de faturamento`,
        r.mesesDetalhadoCopiados > 0 && `${r.mesesDetalhadoCopiados} mês(es) de faturamento detalhado`,
        r.mesesFolhaCopiados > 0 && `${r.mesesFolhaCopiados} mês(es) de folha`,
        r.calculosCopiados > 0 && `${r.calculosCopiados} cálculo(s) do histórico`,
        r.camposCadastroPreenchidos > 0 && `${r.camposCadastroPreenchidos} campo(s) de cadastro preenchido(s)`,
    ].filter(Boolean);
    const oQue = partes.length > 0 ? `Será copiado pro cadastro mantido: ${partes.join(', ')}.` : 'Nada novo a copiar (o mantido já tem tudo).';
    const conf = (conflitos || []).length > 0
        ? `\n\nATENÇÃO — ${conflitos!.length} conflito(s) (mantido o valor do cadastro vencedor):\n• ${conflitos!.slice(0, 6).join('\n• ')}`
        : '';
    return `${oQue}${conf}`;
}
