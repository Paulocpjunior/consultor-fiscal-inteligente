// ============================================================================
// services/auditoriaDonoService.ts — I/O do relatório de auditoria do DONO.
// A trava REAL é do backend (e-mail do dono); aqui o `tenhoAcesso` só evita
// desenhar um botão que responderia 403 — esconder no front NUNCA é a
// segurança, é a cortesia.
// ============================================================================
import { getAuth } from 'firebase/auth';

async function req<T>(url: string): Promise<T & { ok: boolean; error?: string }> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' } as any;
    const token = await u.getIdToken();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` } as any;
    return data;
}

export interface EventoAuditoria {
    id: string; trilha: string; rotulo: string; peso: 'critico' | 'alto' | 'medio';
    em: string | null; quem: string | null; empresa: string | null; descricao: string;
}

export interface RelatorioAuditoria {
    periodo: { de: string | null; ate: string | null; quem: string | null };
    geradoEm: string; geradoPor: string | null;
    trilhas: { id: string; rotulo: string; peso: string; desde: string }[];
    total: number; semAutor: number; semData: number;
    porPessoa: { quem: string; quantidade: number }[];
    porTrilha: { trilha: string; rotulo: string; quantidade: number }[];
    eventos: EventoAuditoria[];
    eventosMostrados: number;
    naoLidas: { trilha: string; rotulo: string; motivo: string }[];
    ressalvas: string[];
}

/** "Eu vejo este painel?" — a resposta NÃO revela quem são os donos. */
export const tenhoAcessoAuditoria = () =>
    req<{ tenho: boolean }>('/api/admin/auditoria-dono/acesso');

export const carregarAuditoria = (p: { de?: string; ate?: string; quem?: string } = {}) => {
    const q = new URLSearchParams();
    if (p.de) q.set('de', p.de);
    if (p.ate) q.set('ate', p.ate);
    if (p.quem) q.set('quem', p.quem);
    const qs = q.toString();
    return req<RelatorioAuditoria>(`/api/admin/auditoria-dono${qs ? `?${qs}` : ''}`);
};
