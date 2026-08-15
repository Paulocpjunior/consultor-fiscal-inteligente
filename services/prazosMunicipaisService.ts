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
