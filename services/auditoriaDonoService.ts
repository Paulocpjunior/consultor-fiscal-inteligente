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
    porPessoa: { quem: string; quantidade: number; porque?: string | null }[];
    porTrilha: { trilha: string; rotulo: string; quantidade: number }[];
    eventos: EventoAuditoria[];
    eventosMostrados: number;
    naoLidas: { trilha: string; rotulo: string; motivo: string }[];
    foraDoEscopo?: ForaDoEscopoCfi;
    ressalvas: string[];
}

/** O que ficou FORA do recorte "só o CFI" — contado por autor, com motivo. */
export interface ForaDoEscopoCfi {
    eventos: number;
    autores: Array<{ quem: string; quantidade: number; motivo: string | null }>;
}

export interface EmpresaDesempenho {
    empresaId: string; empresaNome: string; total: number; porTipo: Record<string, number>;
    ultimoEm: string | null; naCarteira: boolean;
}
export interface ColaboradorDesempenho {
    chave: string; nome: string; email: string | null; pessoa: boolean;
    /** Por que conta como CFI (departamento Fiscal, admin, carteira…). */
    porque?: string | null;
    /** Por tipo: quantos atos saíram em rajada de 10+ no mesmo minuto (ação em lote). */
    emLote?: Record<string, number>;
    total: number; porTipo: Record<string, number>;
    empresasComAto: number; empresasDaCarteira: number;
    empresasDaCarteiraSemAto: Array<{ empresaId: string; empresaNome: string; papel: string | null }>;
    empresas: EmpresaDesempenho[];
}
export interface RelatorioDesempenho {
    geradoEm: string; geradoPor: string | null;
    tipos: Array<{ id: string; rotulo: string; grupo: string; desde: string | null; carimbaQuem: boolean }>;
    periodo: { de: string | null; ate: string | null };
    totalAtos: number; semData: number;
    totaisPorTipo: Record<string, number>;
    colaboradores: ColaboradorDesempenho[];
    naoLidas: Array<{ tipo: string; rotulo: string; motivo: string }>;
    foraDoEscopo?: ForaDoEscopoCfi;
    ressalvas: string[];
}

/** 📊 Desempenho por colaborador × empresa (dono). Sem `de/ate`, últimos 2 meses. */
export const carregarDesempenho = (p: { de?: string; ate?: string } = {}) => {
    const q = new URLSearchParams();
    if (p.de) q.set('de', p.de);
    if (p.ate) q.set('ate', p.ate);
    const qs = q.toString();
    return req<RelatorioDesempenho>(`/api/admin/auditoria-dono/desempenho${qs ? `?${qs}` : ''}`);
};

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
