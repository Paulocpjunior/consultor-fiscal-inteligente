// ============================================================================
// services/spConnectService.ts — I/O do SP Connect (inbox do WhatsApp)
// O backend é o dono do escopo (requireAuth + filas quando existirem);
// aqui é só a chamada, no padrão canônico do rotinaFiscalService.
// ============================================================================
import { getAuth } from 'firebase/auth';
import { ConfigAtendimento, ConversaResumo, FilaAtendimento, MensagemInbox } from './spConnect';

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
    req<{ conversas: ConversaResumo[]; filas: FilaAtendimento[]; minhasFilas: string[] | null; papel: 'admin' | 'gestor' | 'colaborador' }>(
        '/api/admin/whatsapp/conversas');

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

/** Responde com texto livre (janela de 24h aberta E conversa não conduzida
 *  por OUTRO — o backend trava as duas; responder sem dono auto-assume). */
export const responderConversa = (numero: string, texto: string) =>
    req<{ mensagem: MensagemInbox; acao?: string; janelaFechada?: boolean; autoAssumida?: boolean; emConducaoPor?: string }>(
        `/api/admin/whatsapp/conversas/${encodeURIComponent(numero)}/responder`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texto }),
        });

// ─── F3: config do atendimento + ações de conversa ──────────────────────────
// O escopo (quem vê o quê, quem grava) é do BACKEND; aqui é só a chamada.

const post = <T>(url: string, body?: unknown) =>
    req<T>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
    });

const urlConversa = (numero: string, acao: string) =>
    `/api/admin/whatsapp/conversas/${encodeURIComponent(numero)}/${acao}`;

/** Config do atendimento (bot, horário, mensagens, menu) — leitura de qualquer logado. */
export const atendimentoConfig = () =>
    req<{ config: ConfigAtendimento; filas: FilaAtendimento[] }>('/api/admin/whatsapp/atendimento-config');

/** Gravação SÓ admin (o backend recusa o resto). */
export const salvarAtendimentoConfig = (config: ConfigAtendimento) =>
    post<{ config: ConfigAtendimento }>('/api/admin/whatsapp/atendimento-config', { config });

/** Transferir de fila: limpa o dono, grava nota automática (recado opcional)
 *  e — se a chave estiver ligada — avisa o cliente (só com janela aberta). */
export const transferirFila = (numero: string, fila: string, recado?: string) =>
    post<{ numero: string; fila: string; transferidaDe: string; avisoCliente: string; nota: MensagemInbox }>(
        urlConversa(numero, 'fila'), { fila, recado });

/** Assumir a conversa (liberar=true devolve pra fila). */
export const assumirConversa = (numero: string, liberar = false) =>
    post<{ numero: string }>(urlConversa(numero, 'assumir'), { liberar });

/** Encerrar/reabrir: admin e gestor qualquer; colaborador só o que conduz.
 *  Encerrando com a pesquisa ligada, a resposta diz se o convite saiu. */
export const mudarSituacao = (numero: string, situacao: 'aberta' | 'resolvida') =>
    post<{ numero: string; situacao: string; avaliacao?: string }>(urlConversa(numero, 'situacao'), { situacao });

/** Nota interna: entra na thread mas NUNCA sai pro cliente. */
export const criarNota = (numero: string, texto: string) =>
    post<{ mensagem: MensagemInbox }>(urlConversa(numero, 'nota'), { texto });

/** Vincular contato ↔ cliente do cadastro (empresaId vazio DESVINCULA). */
export const vincularCliente = (numero: string, empresaId: string, empresaNome?: string) =>
    post<{}>(urlConversa(numero, 'vincular'), { empresaId, empresaNome });

export const buscarClientes = (q: string) =>
    req<{ clientes: { id: string; nome: string; cnpj: string; origem: string }[] }>(
        `/api/admin/whatsapp/clientes-busca?q=${encodeURIComponent(q)}`);

// ─── Atendentes ↔ filas (admin) ─────────────────────────────────────────────

export interface Atendente {
    uid: string; email: string | null; nome: string | null; role: string;
    papelAtendimento: string;
    departamentos: string[]; filasAtendimento: string[];
}

export const listarAtendentes = () =>
    req<{ atendentes: Atendente[]; filas: FilaAtendimento[] }>('/api/admin/whatsapp/atendentes');

export const salvarFilasAtendente = (uid: string, filas: string[]) =>
    post<{ uid: string; filas: string[] }>(`/api/admin/whatsapp/atendentes/${encodeURIComponent(uid)}/filas`, { filas });

/** Papel do atendimento (colaborador/gestor) — só admin grava. */
export const salvarPapelAtendente = (uid: string, papel: 'colaborador' | 'gestor') =>
    post<{ uid: string; papel: string }>(`/api/admin/whatsapp/atendentes/${encodeURIComponent(uid)}/papel`, { papel });

// ─── 📊 Avaliações (admin/gestor: todas · colaborador: as próprias) ─────────

export interface AvaliacaoAtendimento {
    id: string; numero: string; nota: number; em: string;
    atendente: string | null; encerradaPor: string | null; fila: string; protocolo: string | null;
}

export const listarAvaliacoes = () =>
    req<{
        escopo: 'todas' | 'minhas'; total: number; media: number | null;
        porNota: { nota: number; quantidade: number }[];
        avaliacoes: AvaliacaoAtendimento[];
    }>('/api/admin/whatsapp/avaliacoes');

// ─── 📥 Importar backup da Ultra Fox (admin; preview antes de gravar) ───────

export interface ImportPreview {
    preview?: boolean; tipo: string; total: number;
    amostra?: unknown[]; autores?: string[]; avisos?: string[];
    descartados?: { linha?: number; valor?: string; motivo: string }[];
    descartadas?: { linha?: number; trecho?: string; motivo: string }[];
    totalDescartados?: number; totalDescartadas?: number;
    criados?: number; jaExistiam?: number; gravadas?: number; conversas?: number;
}

export const importarUltrafox = (p: {
    tipo: 'contatos' | 'mensagens-txt' | 'mensagens-csv';
    conteudo: string; confirmar: boolean;
    numero?: string; autoresEscritorio?: string[];
}) => post<ImportPreview>('/api/admin/whatsapp/importar-ultrafox', p);
