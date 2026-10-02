/**
 * prazosMunicipaisService — os calendários municipais, para quem precisa
 * resolver o ISS no NAVEGADOR.
 *
 * Existe porque a geração de tarefas tem DOIS caminhos: o cron do dia 1 (que
 * já carrega os calendários no backend) e o auto-gerar da tela de Tarefas.
 * Sem este serviço, o segundo caminho ficaria para trás — que é exatamente o
 * defeito que o cron teve por algumas horas hoje.
 */
import { getAuth } from 'firebase/auth';

/** Falha NÃO derruba a geração: sem calendário o ISS volta a ser pendência. */
export async function carregarCalendariosMunicipais(): Promise<any[]> {
    try {
        const u = getAuth().currentUser;
        if (!u) return [];
        const res = await fetch('/api/admin/prazos-municipais', {
            headers: { Authorization: `Bearer ${await u.getIdToken()}` },
        });
        if (!res.ok) return [];
        const j = await res.json();
        return Array.isArray(j?.cadastros) ? j.cadastros : [];
    } catch {
        return [];
    }
}

export type VencimentoDaGuia =
    | { achou: true; data: string; dataBr: string; baseLegal: string | null; municipio: string | null; ajuste: string }
    | { achou: false; situacao?: string; motivo: string };

/**
 * 📅 O vencimento da guia pelo CALENDÁRIO do município da empresa (02/10) — a
 * mesma régua dos Vencimentos (dia + mês seguinte + antecipa dia não útil).
 * Falha de leitura NÃO vira data: volta `achou:false` com o motivo.
 */
export async function vencimentoDaGuia(p: { empresaId: string; competencia: string; obrigacao?: string }): Promise<VencimentoDaGuia> {
    try {
        const u = getAuth().currentUser;
        if (!u) return { achou: false, motivo: 'Sessão expirada — entre de novo para consultar o vencimento.' };
        const qs = new URLSearchParams({ empresaId: p.empresaId, competencia: p.competencia, obrigacao: p.obrigacao || 'ISS' });
        const res = await fetch(`/api/admin/prazos-municipais/vencimento?${qs.toString()}`, {
            headers: { Authorization: `Bearer ${await u.getIdToken()}` },
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) return { achou: false, motivo: `Não consegui consultar o calendário de vencimentos (${j?.erro || `HTTP ${res.status}`}).` };
        return j.achou
            ? { achou: true, data: j.data, dataBr: j.dataBr, baseLegal: j.baseLegal ?? null, municipio: j.municipio ?? null, ajuste: j.ajuste || 'antecipa' }
            : { achou: false, situacao: j.situacao, motivo: j.motivo || 'Calendário do município não encontrado.' };
    } catch (e: any) {
        return { achou: false, motivo: `Não consegui consultar o calendário de vencimentos (${e?.message || e}).` };
    }
}
