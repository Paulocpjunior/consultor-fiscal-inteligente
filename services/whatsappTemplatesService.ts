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

/** Um template APROVADO na Meta, como ele é lá (não como foi digitado aqui). */
export interface TemplateDaMeta {
    nome: string;
    idioma: string;
    status: string;
    categoria: string;
    temDocumento: boolean;
    formatoCabecalho: string;
    /** Contagem de {{n}} no corpo — é ela que tem de bater com o schema. */
    variaveis: number;
    corpo: string;
}

/**
 * Lista os templates aprovados direto na Meta, para ESCOLHER em vez de digitar.
 * Nome de template aprovado não é opinião — e digitar o que dá pra escolher foi
 * o que custou três recusas seguidas em 13/08 (`_impostos` × `_imposto` ×
 * `_guia_imposto`).
 */
export const listarTemplatesDaMeta = () =>
    req<{ templates: TemplateDaMeta[]; acao?: string; faltas?: string[] }>(
        '/api/admin/whatsapp/templates-meta');

// ─── Webhook (F1 do 💬 Comunicação) ─────────────────────────────────────────

export interface WebhookStatusEntrega {
    messageId: string;
    numero: string | null;
    status: string | null;   // enviado · entregue · lido · falhou
    em: string | null;
    erro: { codigo: number | null; detalhe: string | null; acao: string } | null;
}

export interface WebhookMensagemRecebida {
    numero: string | null;
    tipo: string | null;
    texto: string | null;
    temMidia: boolean;
    em: string | null;
}

export interface WebhookStatus {
    configurado: boolean;
    faltas: string[];
    caminhoWebhook: string;
    /** Apps assinados na WABA — a 2ª amarração: sem o nosso app aqui, evento real não chega. */
    assinaturaWaba: { ok: boolean; wabaId?: string; apps?: { id: string | null; nome: string | null }[]; erro?: string } | null;
    ultimoEventoEm: string | null;
    ultimosStatus: WebhookStatusEntrega[];
    ultimasMensagens: WebhookMensagemRecebida[];
}

/** Painel do webhook: config, últimos status de entrega e mensagens recebidas. */
export const statusWebhook = () =>
    req<WebhookStatus>('/api/admin/whatsapp/webhook-status');

/** Assina o app do CFI na WABA (subscribed_apps) — liga o fluxo real de eventos. */
export const assinarWabaWebhook = () =>
    req<{ wabaId: string }>('/api/admin/whatsapp/webhook-assinar-waba', { method: 'POST' });
