// ============================================================================
// 🚫 LISTA NEGRA DO SP CONNECT — o núcleo puro (01/10)
// ----------------------------------------------------------------------------
// Paulo, 01/10: "Precisamos criar um modal disponível somente para admins,
// para black list de usuários indesejados, spam, anúncio entre outros".
//
// Bloqueio tem efeito REAL, nas três portas:
//  · ENTRADA: mensagem, chamada e pedido de retorno de número bloqueado NÃO
//    entram no banco, não acordam o bot nem a IA, não avisam ninguém. Só
//    o CONTADOR no registro do bloqueio anda (quantas foram descartadas,
//    quando, o começo da última) — para o admin ver que o spam continua.
//  · SAÍDA: responder, iniciar conversa, agendar, campanha e envio de guia
//    recusam o número bloqueado, nomeado.
//  · META (melhor esforço): a Cloud API tem "block users" — bloqueado lá, a
//    mensagem nem chega ao webhook. A resposta da Meta fica gravada no
//    registro (ok / recusou e por quê); a lista LOCAL é a que manda.
//
// Quem bloqueia é ADMIN. Desbloquear também. Tudo fica com quem, quando e
// por quê — bloquear cliente por engano precisa ter caminho de volta e rastro.
// ============================================================================
import { configWhatsapp, GRAPH_BASE } from './whatsapp-cloud.js';

export const COLECAO_BLOQUEIOS = 'whatsapp_bloqueios';
export const MOTIVOS_BLOQUEIO = [
    { id: 'spam', rotulo: 'Spam' },
    { id: 'anuncio', rotulo: 'Anúncio / propaganda' },
    { id: 'golpe', rotulo: 'Golpe / phishing' },
    { id: 'abuso', rotulo: 'Abuso / ofensa' },
    { id: 'outro', rotulo: 'Outro' },
];
/** Quanto tempo o webhook confia na lista em memória antes de reler o banco. */
export const CACHE_BLOQUEIOS_MS = 30 * 1000;
export const MAX_OBSERVACAO = 300;

/** wa_id da Meta: só dígitos, 8 a 15 (spam vem de fora do Brasil também). */
export function numeroDeBloqueio(bruto) {
    const d = String(bruto || '').replace(/\D/g, '');
    return /^\d{8,15}$/.test(d) ? d : null;
}

export function motivoValido(id) {
    return MOTIVOS_BLOQUEIO.some((m) => m.id === id);
}

export function validarBloqueio({ numero, motivo, observacao, por, agora } = {}) {
    const n = numeroDeBloqueio(numero);
    if (!n) return { ok: false, erro: 'Número inválido — só dígitos, com DDI e DDD (ex.: 5511999990000).' };
    const m = String(motivo || '').trim();
    if (!motivoValido(m)) return { ok: false, erro: `Motivo inválido (use ${MOTIVOS_BLOQUEIO.map((x) => x.id).join(', ')}).` };
    const obs = String(observacao || '').trim();
    if (obs.length > MAX_OBSERVACAO) return { ok: false, erro: `Observação longa demais (máx. ${MAX_OBSERVACAO}).` };
    if (m === 'outro' && !obs) return { ok: false, erro: 'Motivo "outro" pede uma observação — quem desbloquear precisa saber por quê.' };
    const em = (agora instanceof Date ? agora : new Date()).toISOString();
    return {
        ok: true,
        bloqueio: {
            numero: n, motivo: m, observacao: obs || null, ativo: true,
            bloqueadoPor: por || null, bloqueadoEm: em,
            desbloqueadoPor: null, desbloqueadoEm: null,
            descartadas: 0, ultimaTentativaEm: null, ultimoTexto: null,
            meta: null,
        },
    };
}

/** Dos docs da coleção, o conjunto dos números ATIVOS. */
export function conjuntoDeBloqueados(docs = []) {
    const s = new Set();
    for (const d of docs) {
        const x = typeof d?.data === 'function' ? d.data() : d;
        if (x && x.ativo !== false && x.numero) s.add(String(x.numero));
    }
    return s;
}

/** Separa as mensagens do webhook: as que entram e as que são descartadas. */
export function separarBloqueadas(mensagens = [], bloqueados = new Set()) {
    const livres = []; const bloqueadas = [];
    for (const m of mensagens) (m?.de && bloqueados.has(String(m.de)) ? bloqueadas : livres).push(m);
    return { livres, bloqueadas };
}

/** O que anda no registro quando uma mensagem bloqueada é descartada. */
export function patchDeDescarte(msg, agora) {
    const em = (agora instanceof Date ? agora : new Date()).toISOString();
    const texto = String(msg?.texto || '').trim();
    return { ultimaTentativaEm: em, ultimoTexto: texto ? texto.slice(0, 80) : (msg?.tipo ? `[${msg.tipo}]` : null) };
}

export function rotuloDoMotivo(id) {
    return MOTIVOS_BLOQUEIO.find((m) => m.id === id)?.rotulo || id || '?';
}

export function notaDeBloqueio({ motivo, por, observacao }) {
    const quem = por ? String(por).split('@')[0] : 'admin';
    return `🚫 Número BLOQUEADO por ${quem} (${rotuloDoMotivo(motivo)}${observacao ? `: ${observacao}` : ''}). Nada deste número entra ou sai até alguém desbloquear em 🚫 Bloqueios.`;
}

export function notaDeDesbloqueio({ por }) {
    const quem = por ? String(por).split('@')[0] : 'admin';
    return `✅ Número DESBLOQUEADO por ${quem}. A conversa volta a receber e enviar normalmente.`;
}

/** Só o que a tela mostra. */
export function resumoDoBloqueio(d) {
    return {
        numero: d.numero, motivo: d.motivo, motivoRotulo: rotuloDoMotivo(d.motivo), observacao: d.observacao || null, ativo: d.ativo !== false,
        bloqueadoPor: d.bloqueadoPor || null, bloqueadoEm: d.bloqueadoEm || null,
        desbloqueadoPor: d.desbloqueadoPor || null, desbloqueadoEm: d.desbloqueadoEm || null,
        descartadas: Number(d.descartadas || 0), ultimaTentativaEm: d.ultimaTentativaEm || null, ultimoTexto: d.ultimoTexto || null,
        meta: d.meta || null, nomePerfil: d.nomePerfil || null,
    };
}

// ─── Meta: "block users" da Cloud API (melhor esforço) ──────────────────────
// POST   /{phone_number_id}/block_users   {"messaging_product":"whatsapp","block_users":[{"user":"<wa_id>"}]}
// DELETE /{phone_number_id}/block_users   (mesmo corpo) desbloqueia.
// A resposta traz `block_users.added_users` / `removed_users` e
// `block_users.failed_users[{input, errors[{message}]}]`. Leiaute lido com
// tolerância: o que não casar volta NOMEADO no `erro` — e a lista local é
// a que vale, com ou sem a Meta.

export function montarPedidoBlockUsers(numeros = []) {
    return { messaging_product: 'whatsapp', block_users: numeros.map((n) => ({ user: String(n) })) };
}

export function interpretarRespostaBlockUsers(status, corpo, { remover = false } = {}) {
    const bloco = corpo?.block_users || {};
    const okLista = (remover ? bloco.removed_users : bloco.added_users);
    const feitos = Array.isArray(okLista) ? okLista.map((x) => String(x?.input ?? x?.wa_id ?? x?.user ?? x)) : [];
    const falhas = Array.isArray(bloco.failed_users)
        ? bloco.failed_users.map((f) => ({ numero: String(f?.input ?? '?'), erro: (f?.errors || []).map((e) => e?.message || e?.title || JSON.stringify(e)).join('; ') || 'sem detalhe' }))
        : [];
    if (status >= 200 && status < 300 && (feitos.length || !falhas.length)) {
        return { ok: feitos.length > 0 || falhas.length === 0, feitos, falhas, erro: falhas.length ? falhas.map((f) => `${f.numero}: ${f.erro}`).join(' · ') : null };
    }
    const err = corpo?.error || {};
    const detalhe = err.error_data?.details || err.message || (falhas.length ? falhas.map((f) => `${f.numero}: ${f.erro}`).join(' · ') : `HTTP ${status}`);
    return { ok: false, feitos, falhas, erro: detalhe, code: err.code ?? null };
}

async function chamarBlockUsers({ numeros, remover }, deps = {}) {
    const cfg = deps.cfg || configWhatsapp(deps.env);
    if (!cfg.token || !cfg.phoneNumberId) return { ok: false, erro: 'Canal WhatsApp não configurado (token/phoneNumberId).', configuracaoIncompleta: true, feitos: [], falhas: [] };
    const doFetch = deps.fetchImpl || fetch;
    let resp;
    try {
        resp = await doFetch(`${GRAPH_BASE}/${cfg.phoneNumberId}/block_users`, {
            method: remover ? 'DELETE' : 'POST',
            headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(montarPedidoBlockUsers(numeros)),
        });
    } catch (e) {
        return { ok: false, erro: `Rede caiu ao falar com a Meta (${e.message}).`, indeterminado: true, feitos: [], falhas: [] };
    }
    const corpo = await resp.json().catch(() => ({}));
    return interpretarRespostaBlockUsers(resp.status, corpo, { remover });
}

export const bloquearNaMeta = (numeros, deps) => chamarBlockUsers({ numeros, remover: false }, deps);
export const desbloquearNaMeta = (numeros, deps) => chamarBlockUsers({ numeros, remover: true }, deps);
