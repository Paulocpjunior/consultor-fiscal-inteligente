// ============================================================================
// sefaz-backend/instagram-dm.js — DMs do Instagram no MESMO inbox (fase 2)
// ----------------------------------------------------------------------------
// A sonda (instagram-sonda.js) provou em 22/08: Página "SP Assessoria
// Contábil" + @spassessoriacontabil vinculado, token com `pages_*` e
// `instagram_*` (rotacionado pelo Paulo no mesmo dia). Este módulo é a fase
// que a própria sonda anunciava: RECEBER a DM no inbox e RESPONDER texto.
//
// DECISÕES QUE MANDAM:
// - A conversa do Instagram vive na MESMA coleção das do WhatsApp, com id
//   `ig_{IGSID}` e `canal: 'instagram'` — fila, assumir, transferir, nota
//   interna, encerrar e relatório funcionam DE GRAÇA, porque leem a conversa,
//   não o telefone.
// - O BOT NÃO RODA no Instagram, de propósito: a triagem por menu numérico é
//   contrato do WhatsApp (protocolo, imagens por fila, `#sair`). Ligar o bot
//   num canal onde ele nunca foi ensaiado seria o dia do corte de novo.
//   DM entra na triagem da Recepção (fila null) e gente conduz.
// - RECEBIMENTO nasce DESLIGADO (mesma régua do botAtivo): o botão 📡 na ⚙️
//   → 📷 é quem assina o webhook na Meta. Antes do clique, nada muda.
// - `is_echo` (mensagem que a PÁGINA mandou — por nós ou pelo Business Suite)
//   entra como SAÍDA com enviadoPor null: é a mesma honestidade do
//   "enviada por outra plataforma" do WhatsApp; sumir com ela deixaria a
//   thread com buraco.
// - Token NUNCA vai ao banco (regra dos canais): o token de PÁGINA usado no
//   envio é derivado na hora do token do sistema e cacheado só em memória.
// ============================================================================

import { GRAPH_BASE, configWhatsapp } from './whatsapp-cloud.js';
import { configWebhook } from './whatsapp-webhook.js';

/** Prefixo do id de conversa/contato do Instagram na coleção compartilhada. */
export const ID_PREFIXO_IG = 'ig_';

/** É um id de conversa do Instagram? (`ig_` + IGSID numérico) */
export function ehConversaInstagram(id) {
    return /^ig_\d{5,32}$/.test(String(id || ''));
}

/** id de conversa a partir do IGSID (o "número" do cliente no Instagram). */
export function idConversaInstagram(igsid) {
    const d = String(igsid || '').replace(/\D/g, '');
    return d ? `${ID_PREFIXO_IG}${d}` : null;
}

/**
 * O parâmetro de rota `:numero` das rotas de conversa, resolvido: id do
 * Instagram passa INTEIRO; o resto continua sendo telefone (só dígitos).
 * É a régua que TODAS as rotas de conversa usam — sem ela, o
 * `replace(/\D/g,'')` de sempre transformaria `ig_178...` no número cru e a
 * rota abriria a conversa errada.
 */
export function idConversaDoParam(param) {
    const bruto = String(param || '').trim();
    if (ehConversaInstagram(bruto)) return bruto;
    return bruto.replace(/\D/g, '');
}

/** ts em ms (o Instagram manda epoch ms; o WhatsApp manda segundos) → ISO. */
function tsMsParaIso(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
    return new Date(n).toISOString();
}

/**
 * Extrai as mensagens de UM payload de webhook `object: "instagram"`.
 * Forma (docs + evento cru guardado): entry[].messaging[] com sender.id,
 * recipient.id, timestamp (ms) e message {mid, text, attachments[], is_echo}.
 */
export function extrairEventosInstagram(payload) {
    if (!payload || payload.object !== 'instagram') {
        return { valido: false, motivo: `object "${payload?.object}" não é instagram`, mensagens: [] };
    }
    const mensagens = [];
    for (const entry of (Array.isArray(payload.entry) ? payload.entry : [])) {
        for (const m of (Array.isArray(entry.messaging) ? entry.messaging : [])) {
            const msg = m?.message;
            if (!msg?.mid || !m?.sender?.id) continue;   // sem mid não há idempotência
            const eco = Boolean(msg.is_echo);
            // No eco, o "cliente" é o RECIPIENT (a página mandou); na entrada
            // normal é o SENDER. A conversa é sempre a do cliente.
            const igsid = String(eco ? m.recipient?.id || '' : m.sender.id);
            if (!/^\d{5,32}$/.test(igsid)) continue;
            const anexos = (Array.isArray(msg.attachments) ? msg.attachments : [])
                .map((a) => ({ tipo: String(a?.type || 'file'), url: a?.payload?.url || null }))
                .filter((a) => a.url);
            mensagens.push({
                metaMessageId: String(msg.mid),
                igsid,
                conversaId: idConversaInstagram(igsid),
                direcao: eco ? 'saida' : 'entrada',
                texto: msg.text != null ? String(msg.text) : null,
                anexos,
                timestamp: tsMsParaIso(m.timestamp),
            });
        }
    }
    return { valido: true, mensagens };
}

/** Rótulo curto da mensagem pra "última mensagem" (espelha resumoParaConversa). */
export function resumoDaMensagemIg(m) {
    if (m.texto) return String(m.texto).slice(0, 140);
    const rotulos = { image: '🖼️ imagem', video: '🎬 vídeo', audio: '🎙️ áudio', file: '📎 arquivo', share: '🔗 conteúdo compartilhado', story_mention: '📣 menção em story' };
    const t = m.anexos?.[0]?.tipo;
    return rotulos[t] || '📷 mensagem do Instagram';
}

// ─── I/O com a Graph API ────────────────────────────────────────────────────

const CACHE_MS = 45 * 60 * 1000;
let cachePagina = { em: 0, pagina: null };

/**
 * A Página (id, nome, token de página, IG vinculado) que o token do sistema
 * gerencia — é a identidade de quem RESPONDE a DM. Cache em memória (45min):
 * o token de página derivado não pode ir ao banco.
 */
export async function paginaDoInstagram(deps = {}) {
    const agora = Date.now();
    if (!deps.semCache && cachePagina.pagina && agora - cachePagina.em < CACHE_MS) {
        return { ok: true, pagina: cachePagina.pagina };
    }
    const cfg = deps.cfg || configWhatsapp(deps.env);
    const doFetch = deps.fetchImpl || fetch;
    if (!cfg.token) return { ok: false, erro: 'Canal sem token (WHATSAPP_CLOUD_TOKEN).' };
    const r = await doFetch(
        `${GRAPH_BASE}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}`,
        { headers: { Authorization: `Bearer ${cfg.token}` } },
    );
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, erro: corpo?.error?.message || `HTTP ${r.status}` };
    const comIg = (corpo.data || []).find((p) => p?.instagram_business_account?.id);
    if (!comIg) {
        return { ok: false, erro: 'Nenhuma Página com Instagram vinculado ao alcance do token — rode a sonda 📷 pra diagnosticar.' };
    }
    const pagina = {
        pageId: String(comIg.id),
        nome: comIg.name || null,
        pageToken: comIg.access_token || null,
        igId: String(comIg.instagram_business_account.id),
        igUsername: comIg.instagram_business_account.username || null,
    };
    cachePagina = { em: agora, pagina };
    return { ok: true, pagina };
}

/**
 * 📡 LIGA o recebimento: assina o webhook do objeto `instagram` no APP (a
 * MESMA callback e verify token do WhatsApp — um endpoint só) e a Página no
 * app (`subscribed_apps`). Idempotente: religar só re-afirma as assinaturas.
 * Quem persiste o "ligado" (whatsapp_config/instagram) é a ROTA.
 */
export async function ligarRecebimentoInstagram(deps = {}) {
    const cfg = deps.cfg || configWhatsapp(deps.env);
    const web = deps.web || configWebhook(deps.env);
    const doFetch = deps.fetchImpl || fetch;
    if (!cfg.token) return { ok: false, erro: 'Canal sem token (WHATSAPP_CLOUD_TOKEN).' };
    if (!web.appSecret || !web.verifyToken) {
        return { ok: false, erro: 'Webhook sem config (WHATSAPP_APP_SECRET / WHATSAPP_WEBHOOK_VERIFY_TOKEN).' };
    }

    // 1) Qual é o APP deste token? (o id não se crava — pergunta-se)
    const rApp = await doFetch(`${GRAPH_BASE}/app?fields=id,name`, { headers: { Authorization: `Bearer ${cfg.token}` } });
    const app = await rApp.json().catch(() => ({}));
    if (!rApp.ok || !app.id) return { ok: false, erro: `Não deu pra identificar o app do token: ${app?.error?.message || `HTTP ${rApp.status}`}` };

    // 2) Assinatura do objeto `instagram` no app (token de APP = id|secret).
    const callback = deps.callbackUrl
        || `${String(process.env.PUBLIC_BASE_URL || 'https://consultor-fiscal-inteligente-631239634290.us-west1.run.app').replace(/\/$/, '')}/api/whatsapp/webhook`;
    const corpoSub = new URLSearchParams({
        object: 'instagram', callback_url: callback, fields: 'messages', verify_token: web.verifyToken,
        access_token: `${app.id}|${web.appSecret}`,
    });
    const rSub = await doFetch(`${GRAPH_BASE}/${app.id}/subscriptions`, { method: 'POST', body: corpoSub });
    const sub = await rSub.json().catch(() => ({}));
    if (!rSub.ok || sub.success !== true) {
        return { ok: false, erro: `A Meta recusou a assinatura do webhook do Instagram: ${sub?.error?.message || `HTTP ${rSub.status}`}` };
    }

    // 3) Página assinada no app (é por ela que a DM chega).
    const pag = await paginaDoInstagram({ ...deps, semCache: true });
    if (!pag.ok) return { ok: false, erro: pag.erro };
    const tokenPagina = pag.pagina.pageToken || cfg.token;
    const rPage = await doFetch(
        `${GRAPH_BASE}/${pag.pagina.pageId}/subscribed_apps?subscribed_fields=messages`,
        { method: 'POST', headers: { Authorization: `Bearer ${tokenPagina}` } },
    );
    const page = await rPage.json().catch(() => ({}));
    if (!rPage.ok || page.success !== true) {
        return { ok: false, erro: `A Meta recusou a assinatura da Página: ${page?.error?.message || `HTTP ${rPage.status}`}` };
    }

    return {
        ok: true,
        appId: String(app.id),
        callback,
        pageId: pag.pagina.pageId,
        igId: pag.pagina.igId,
        igUsername: pag.pagina.igUsername,
    };
}

/**
 * 🔬 O que a META diz que está assinado — a resposta da FONTE, não a nossa
 * memória de ter clicado o 📡. GET /{app}/subscriptions devolve objeto,
 * campos, callback e `active`; GET /{page}/subscribed_apps devolve o que a
 * Página assinou. É o degrau seguinte do diagnóstico de 22/08: com o
 * interruptor do Instagram ligado e ZERO evento cru, a pergunta vira "a
 * assinatura está mesmo de pé do lado de lá?".
 */
export async function assinaturasDoApp(deps = {}) {
    const cfg = deps.cfg || configWhatsapp(deps.env);
    const web = deps.web || configWebhook(deps.env);
    const doFetch = deps.fetchImpl || fetch;
    if (!cfg.token) return { ok: false, erro: 'Canal sem token (WHATSAPP_CLOUD_TOKEN).' };
    if (!web.appSecret) return { ok: false, erro: 'Sem WHATSAPP_APP_SECRET — o token de app é id|secret.' };

    const rApp = await doFetch(`${GRAPH_BASE}/app?fields=id,name`, { headers: { Authorization: `Bearer ${cfg.token}` } });
    const app = await rApp.json().catch(() => ({}));
    if (!rApp.ok || !app.id) {
        return { ok: false, erro: `Não deu pra identificar o app do token: ${app?.error?.message || `HTTP ${rApp.status}`}` };
    }

    const tokenApp = `${app.id}|${web.appSecret}`;
    const r = await doFetch(`${GRAPH_BASE}/${app.id}/subscriptions?access_token=${encodeURIComponent(tokenApp)}`);
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, erro: corpo?.error?.message || `HTTP ${r.status}` };
    const doApp = (Array.isArray(corpo.data) ? corpo.data : []).map((s) => ({
        objeto: String(s.object || ''),
        ativa: s.active !== false,
        callback: s.callback_url || null,
        campos: (Array.isArray(s.fields) ? s.fields : [])
            .map((f) => (typeof f === 'string' ? f : f?.name))
            .filter(Boolean),
    }));

    // O lado da PÁGINA (best-effort — sem Página o lado do app já responde).
    let daPagina = null;
    try {
        const pag = await paginaDoInstagram(deps);
        if (pag.ok && pag.pagina.pageToken) {
            const rp = await doFetch(`${GRAPH_BASE}/${pag.pagina.pageId}/subscribed_apps?fields=subscribed_fields`, {
                headers: { Authorization: `Bearer ${pag.pagina.pageToken}` },
            });
            const cp = await rp.json().catch(() => ({}));
            if (rp.ok) {
                daPagina = (Array.isArray(cp.data) ? cp.data : []).map((a) => ({
                    appId: String(a.id || ''),
                    campos: Array.isArray(a.subscribed_fields) ? a.subscribed_fields : [],
                }));
            }
        }
    } catch { /* lado da página fica null — dito, não zerado */ }

    return { ok: true, appId: String(app.id), doApp, daPagina };
}

/**
 * Responde UMA DM com texto. A janela de 24h é regra da Meta no Instagram
 * também — fora dela a API recusa, e a resposta volta TRADUZIDA (a tela já
 * sabe dizer "janela fechada").
 */
export async function enviarTextoInstagram({ para, texto }, deps = {}) {
    const igsid = String(para || '').replace(/^ig_/, '').replace(/\D/g, '');
    const corpo = String(texto ?? '').trim();
    if (!igsid) return { ok: false, erro: 'Destinatário do Instagram inválido.' };
    if (!corpo) return { ok: false, erro: 'Escreva a mensagem antes de enviar.' };
    const pag = await paginaDoInstagram(deps);
    if (!pag.ok) return { ok: false, erro: pag.erro };
    const doFetch = deps.fetchImpl || fetch;
    const token = pag.pagina.pageToken || (deps.cfg || configWhatsapp(deps.env)).token;
    const r = await doFetch(`${GRAPH_BASE}/${pag.pagina.pageId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: igsid }, messaging_type: 'RESPONSE', message: { text: corpo } }),
    });
    const resp = await r.json().catch(() => ({}));
    if (!r.ok) {
        const m = resp?.error?.message || `HTTP ${r.status}`;
        const janela = /outside.*window|allowed window|24 ?h/i.test(m) || resp?.error?.code === 10;
        return { ok: false, erro: m, janelaFechada: janela };
    }
    return { ok: true, messageId: String(resp.message_id || resp.mid || `ig-envio-${Date.now()}`) };
}

export const _internals = { tsMsParaIso };
