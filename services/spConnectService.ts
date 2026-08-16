// ============================================================================
// services/spConnectService.ts — I/O do SP Connect (inbox do WhatsApp)
// O backend é o dono do escopo (requireAuth + filas quando existirem);
// aqui é só a chamada, no padrão canônico do rotinaFiscalService.
// ============================================================================
import { getAuth } from 'firebase/auth';
import { ConversaResumo, MensagemInbox } from './spConnect';

async function req<T>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' } as any;
    const token = await u.getIdToken();
    const res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` } as any;
    return data;
}

export const listarConversas = () =>
    req<{ conversas: ConversaResumo[] }>('/api/admin/whatsapp/conversas');

export const listarMensagens = (numero: string) =>
    req<{ mensagens: MensagemInbox[] }>(`/api/admin/whatsapp/conversas/${encodeURIComponent(numero)}/mensagens`);

export const marcarLida = (numero: string) =>
    req<{}>(`/api/admin/whatsapp/conversas/${encodeURIComponent(numero)}/lida`, { method: 'POST' });

/**
 * Inicia conversa por TEMPLATE aprovado (regra da Meta pra fora da janela).
 * Template com documento é recusado pelo backend — guia sai pelas telas de guia.
 */
export const iniciarConversa = (p: {
    para: string; nomeContato?: string; departamento: string;
    template?: string; variaveis?: Record<string, string>;
    /** Template APROVADO direto da Meta (sem cadastro na ⚙️) + valores posicionais {{1}},{{2}}… */
    templateDireto?: { nome: string; idioma: string };
    variaveisPosicionais?: string[];
}) =>
    req<{ numero: string; messageId: string; opcoes?: string[]; faltando?: string[]; acao?: string }>(
        '/api/admin/whatsapp/conversas/iniciar',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });

/** Responde com texto livre (só com a janela de 24h aberta — o backend trava). */
export const responderConversa = (numero: string, texto: string) =>
    req<{ mensagem: MensagemInbox; acao?: string; janelaFechada?: boolean }>(
        `/api/admin/whatsapp/conversas/${encodeURIComponent(numero)}/responder`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texto }),
        });
