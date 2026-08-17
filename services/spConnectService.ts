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

// ─── 📎 Mídia: abrir a recebida e enviar anexo ──────────────────────────────

/**
 * Baixa o anexo COM o token (o backend valida a visibilidade da fila) e
 * devolve um object URL pra tela. `<img src>` não manda header, então o
 * caminho é fetch → blob — e é isso que permite exigir login pra abrir
 * anexo de cliente, em vez de link assinado que qualquer um repassa.
 */
export async function abrirMidia(numero: string, mensagemId: string): Promise<
    { ok: true; url: string; mime: string } | { ok: false; error: string; acao?: string }
> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' };
    const token = await u.getIdToken();
    const res = await fetch(
        `/api/admin/whatsapp/conversas/${encodeURIComponent(numero)}/midia/${encodeURIComponent(mensagemId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
        const data = await res.json().catch(() => ({} as any));
        return { ok: false, error: data.error || `HTTP ${res.status}`, acao: data.acao };
    }
    const blob = await res.blob();
    return { ok: true, url: URL.createObjectURL(blob), mime: blob.type };
}

/** Envia anexo (dentro da janela de 24h; o backend trava tamanho e tipo). */
export const enviarAnexo = (numero: string, p: { base64: string; nomeArquivo: string; mime: string; legenda?: string }) =>
    req<{ mensagem: MensagemInbox; legendaIgnorada?: boolean; copiaGuardada?: boolean; acao?: string; janelaFechada?: boolean; emConducaoPor?: string }>(
        `/api/admin/whatsapp/conversas/${encodeURIComponent(numero)}/anexo`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });

// ─── F3: config do atendimento + ações de conversa ──────────────────────────
// O escopo (quem vê o quê, quem grava) é do BACKEND; aqui é só a chamada.

const post = <T>(url: string, body?: unknown, metodo: 'POST' | 'PATCH' = 'POST') =>
    req<T>(url, {
        method: metodo,
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

/** Cliente 360 da conversa (pós-vínculo): empresa, responsáveis da carteira
 *  e últimas guias do rito #293 — nenhuma conta nova, só leitura. */
export interface ClienteDaConversa {
    vinculado: boolean;
    empresa?: { id: string; nome: string; cnpj: string | null; regime: string | null; excluida?: boolean; naoEncontrada?: boolean };
    responsaveis?: { nome: string; papel: string }[];
    guias?: { tipo: string | null; competencia: string | null; valor: number | null; canal: string | null; enviadoPor: string | null; enviadoEm: string | null }[];
    totalGuias?: number;
}

export const clienteDaConversa = (numero: string) =>
    req<ClienteDaConversa>(urlConversa(numero, 'cliente'));

export const buscarClientes = (q: string) =>
    req<{ clientes: { id: string; nome: string; cnpj: string; origem: string }[] }>(
        `/api/admin/whatsapp/clientes-busca?q=${encodeURIComponent(q)}`);

// ─── 📞 Canais (2º número / 2ª WABA) ────────────────────────────────────────

export interface CanalWhatsapp {
    id: string; rotulo: string; numeroExibicao: string | null;
    phoneNumberId: string | null; wabaId: string | null; envToken: string | null;
    origem: 'env' | 'cadastro'; ativo?: boolean; pronto: boolean; faltas?: string[];
}

export const listarCanais = () =>
    req<{ canais: CanalWhatsapp[]; multiCanal: boolean; padraoId: string; conflitos: { id: string; motivo: string }[] }>(
        '/api/admin/whatsapp/canais');

/** Cadastra o 2º número. `envToken` é o NOME da variável do Cloud Run. */
export const salvarCanal = (p: {
    id: string; rotulo: string; phoneNumberId: string; envToken: string;
    numeroExibicao?: string; wabaId?: string; ativo?: boolean;
}) => post<{ id: string; canais: CanalWhatsapp[] }>('/api/admin/whatsapp/canais', p);

// ─── 📇 Contatos e 🏷 etiquetas ─────────────────────────────────────────────

export interface Etiqueta {
    id: string; rotulo: string; cor: string; ordem: number;
    finalidade: string; baseLegal: string; origem?: string;
}

export interface PendenciaLgpd {
    etiqueta: string; tipo: string; motivo: string; acao: string;
}

export interface Contato {
    numero: string;
    nomePerfil: string | null;
    empresaId: string | null;
    empresaNome: string | null;
    empresaNomeSugerido: string | null;
    etiquetas: string[];
    consentimentos: Record<string, { em?: string | null; como?: string | null; revogadoEm?: string | null }>;
    origem: string | null;
    criadoEm: string | null;
    observacao: string | null;
    pendenciasLgpd?: PendenciaLgpd[];
}

export const listarContatos = (p: { busca?: string; etiqueta?: string; semEtiqueta?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (p.busca) q.set('busca', p.busca);
    if (p.etiqueta) q.set('etiqueta', p.etiqueta);
    if (p.semEtiqueta) q.set('semEtiqueta', 'true');
    return req<{
        contatos: Contato[]; total: number; totalFiltrado: number; truncado: boolean;
        limiteLeitura: number | null; semEtiquetaTotal: number;
        porEtiqueta: Record<string, number>; etiquetas: Etiqueta[];
    }>(`/api/admin/whatsapp/contatos${q.toString() ? `?${q}` : ''}`);
};

export const criarContato = (p: { numero: string; nome?: string; etiquetas?: string[] }) =>
    post<{ numero: string; jaExiste?: boolean; acao?: string }>('/api/admin/whatsapp/contatos', p);

export const atualizarContato = (numero: string, p: {
    etiquetas?: string[]; nome?: string; observacao?: string;
    consentimento?: { etiqueta: string; como?: string; revogar?: boolean };
}) => post<{ pendenciasLgpd: PendenciaLgpd[] }>(`/api/admin/whatsapp/contatos/${numero}`, p, 'PATCH');

export const listarEtiquetas = () =>
    req<{ etiquetas: Etiqueta[]; basesLegais: Record<string, { rotulo: string; artigo: string; pedeConsentimento: boolean }>; cores: string[] }>(
        '/api/admin/whatsapp/etiquetas');

export const salvarEtiqueta = (p: { rotulo: string; finalidade: string; baseLegal: string; cor?: string; ordem?: number }) =>
    post<{ etiquetas: Etiqueta[] }>('/api/admin/whatsapp/etiquetas', p);

// ─── ☎️ Chamada de voz/vídeo — SONDA, não interruptor ───────────────────────
// Ela pergunta à Meta e relata. Ligar a chamada abre um botão no WhatsApp de
// TODOS os clientes: é decisão do Paulo, com destino de atendimento definido
// antes — não efeito colateral de um clique de diagnóstico.

export interface SondaChamada {
    candidato: string; rotulo: string; hipotese: string;
    situacao: 'ligado' | 'desligado' | 'nao-declarado' | 'nao-reconhecido' | 'sem-permissao' | 'indeterminado';
    motivo: string; acao?: string; campo?: string; bruto?: unknown;
}

export const sondarChamadas = () =>
    req<{
        conclusao: { veredito: SondaChamada['situacao']; motivo: string; acao?: string; respondeuPor?: string | null };
        sondas: SondaChamada[];
        antesDeLigar: { titulo: string; texto: string }[];
    }>('/api/admin/whatsapp/chamadas/sondar');

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
