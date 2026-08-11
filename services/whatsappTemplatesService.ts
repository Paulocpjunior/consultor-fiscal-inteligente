// ============================================================================
// services/whatsappTemplatesService.ts
// ----------------------------------------------------------------------------
// Front do cadastro de TEMPLATES do WhatsApp (Cloud API oficial da Meta).
// O backend (`/api/admin/whatsapp/templates`) valida nome/idioma/variáveis
// pela regra da Meta e é o dono da verdade — aqui é só a caixa. Um template por
// par (departamento, nome); variáveis são {{1}},{{2}}… na ORDEM da lista.
// ============================================================================
import { getAuth } from 'firebase/auth';

export interface TemplateVariavel {
    chave: string;   // nome lógico usado no envio ({cliente, competencia, ...})
    rotulo: string;  // rótulo humano ({{1}} = "Nome do cliente")
}

export interface WhatsappTemplate {
    id: string;
    departamento: string;
    nome: string;
    idioma: string;
    descricao?: string;
    temDocumento?: boolean;
    variaveis: TemplateVariavel[];
    ativo?: boolean;
    atualizadoEm?: string;
    atualizadoPor?: string | null;
}

async function req<T>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' } as any;
    const token = await u.getIdToken();
    const res = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init?.headers || {}),
        },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}`, ...(data || {}) } as any;
    return data;
}

/** Status do canal (a tela só mostra o formulário de envio se estiver pronto). */
export const statusWhatsapp = () =>
    req<{ pronto: boolean }>('/api/admin/whatsapp/status');

export const listarTemplates = (departamento?: string) =>
    req<{ departamentos: string[]; templates: WhatsappTemplate[] }>(
        `/api/admin/whatsapp/templates${departamento ? `?departamento=${encodeURIComponent(departamento)}` : ''}`);

/** Cadastra/edita — o backend recusa nome/idioma/variável fora do padrão Meta. */
export const salvarTemplate = (t: Partial<WhatsappTemplate>) =>
    req<{ template: WhatsappTemplate; detalhes?: string[] }>('/api/admin/whatsapp/templates', {
        method: 'POST',
        body: JSON.stringify(t),
    });

/** Desativa (soft — ativo:false; o envio nunca escolhe template inativo). */
export const desativarTemplate = (id: string) =>
    req<{}>(`/api/admin/whatsapp/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
