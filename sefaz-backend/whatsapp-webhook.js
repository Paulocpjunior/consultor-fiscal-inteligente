// ============================================================================
// sefaz-backend/whatsapp-webhook.js  (ESM, núcleo PURO — testável)
// ----------------------------------------------------------------------------
// F1 DO MÓDULO 💬 COMUNICAÇÃO (desenho em docs/desenho-modulo-comunicacao.md):
// o CFI passa a RECEBER o que a Meta manda — mensagens dos clientes e STATUS
// de entrega dos nossos envios — em paralelo com a Ultra Fox, só gravando.
//
// POR QUE ISSO IMPORTA JÁ NA F1: hoje a auditoria de envio para em "a Meta
// aceitou" (messageId), e aceito ≠ entregue — o filtro de marketing (131049)
// descarta a mensagem EM SILÊNCIO e ninguém vê. O status do webhook é o farol
// honesto do canal: entregue/lido/falhou COM o motivo.
//
// REGRAS QUE MANDAM:
// - A assinatura X-Hub-Signature-256 é VALIDADA sobre o corpo CRU (HMAC com o
//   app secret). Sem assinatura válida, nada entra no banco — a rota é
//   pública e qualquer um pode dar POST nela.
// - Comparação em tempo constante (timingSafeEqual) — mesma regra do
//   cron-secret.
// - Tipo de mensagem desconhecido NÃO é descartado: entra com o tipo nomeado
//   e texto nulo (ausência não é prova; descartar em silêncio é a armadilha
//   do parser de checkbox do Jotform).
// - Nenhuma função aqui toca banco ou rede — quem grava é a rota.
// ============================================================================

import { createHmac } from 'crypto';
import { secretsMatch } from './cron-secret.js';

/** Config do webhook — envs próprias, separadas das do envio. */
export function configWebhook(env = process.env) {
    return {
        verifyToken: String(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim(),
        appSecret: String(env.WHATSAPP_APP_SECRET || '').trim(),
    };
}

/** O que falta pro webhook funcionar — em português e com a ação (farol honesto). */
export function faltasDaConfigWebhook(cfg) {
    const faltas = [];
    if (!cfg.verifyToken) faltas.push('token de verificação (env WHATSAPP_WEBHOOK_VERIFY_TOKEN — você inventa o valor e repete no painel da Meta)');
    if (!cfg.appSecret) faltas.push('app secret da Meta (env WHATSAPP_APP_SECRET — App da Meta → Configurações → Básico)');
    return faltas;
}

// Comparação em tempo constante: a MESMA do cron-secret (régua única — uma
// segunda cópia aqui foi barrada em revisão no próprio PR que a escreveu).

/**
 * GET de verificação da Meta: ela manda hub.mode=subscribe + hub.verify_token
 * + hub.challenge, e espera o challenge de volta (200) SÓ se o token bater.
 */
export function responderVerificacao(query, cfg) {
    const q = query || {};
    const modo = q['hub.mode'];
    const token = q['hub.verify_token'];
    const challenge = q['hub.challenge'];
    if (modo !== 'subscribe') return { ok: false, motivo: `hub.mode "${modo}" não é subscribe` };
    if (!cfg.verifyToken) return { ok: false, motivo: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN não configurado' };
    if (!secretsMatch(token, cfg.verifyToken)) return { ok: false, motivo: 'verify_token não confere' };
    return { ok: true, challenge: String(challenge ?? '') };
}

/**
 * Valida a assinatura do POST. O header vem como "sha256=<hex>" e o HMAC é
 * calculado sobre o corpo CRU (bytes como chegaram — por isso o server.js
 * guarda req.rawBody; re-serializar o JSON mudaria a ordem das chaves e a
 * assinatura nunca bateria).
 */
export function assinaturaValida(rawBody, headerAssinatura, appSecret) {
    if (!appSecret || !rawBody) return false;
    const header = String(headerAssinatura || '');
    if (!header.startsWith('sha256=')) return false;
    const recebida = header.slice('sha256='.length);
    const esperada = createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex');
    return secretsMatch(recebida, esperada);
}

/** Timestamp da Meta (segundos, string) → ISO. Torto vira null, nunca chute. */
function tsParaIso(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n * 1000).toISOString();
}

/** Fim da janela de 24h aberta por uma mensagem do cliente. */
export function janela24hAte(timestampIso) {
    const t = Date.parse(timestampIso || '');
    if (!Number.isFinite(t)) return null;
    return new Date(t + 24 * 60 * 60 * 1000).toISOString();
}

// Tipos que carregam mídia (o binário fica na Meta; o download é da F2 —
// aqui guardamos o media id, que é o que permite baixar depois).
const TIPOS_MIDIA = new Set(['image', 'document', 'audio', 'video', 'sticker']);

/** Extrai o texto "legível" de uma mensagem, conforme o tipo. */
function textoDaMensagem(m) {
    switch (m.type) {
        case 'text': return m.text?.body ?? null;
        case 'button': return m.button?.text ?? null;
        case 'interactive':
            return m.interactive?.button_reply?.title
                ?? m.interactive?.list_reply?.title ?? null;
        case 'reaction': return m.reaction?.emoji ?? null;
        case 'image': case 'document': case 'video':
            return m[m.type]?.caption ?? null;
        case 'location': {
            const l = m.location || {};
            return (l.latitude != null && l.longitude != null)
                ? `📍 ${l.latitude},${l.longitude}${l.name ? ` (${l.name})` : ''}` : null;
        }
        case 'contacts': return '👤 cartão de contato';
        default: return null;
    }
}

/**
 * Extrai o que interessa do payload do webhook (campo "messages").
 * Devolve { valido, mensagens[], statuses[] } — mensagens são o que o CLIENTE
 * mandou; statuses são o destino dos NOSSOS envios.
 */
export function extrairEventos(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (p.object !== 'whatsapp_business_account') {
        return { valido: false, motivo: `object "${p.object}" não é whatsapp_business_account`, mensagens: [], statuses: [] };
    }
    const mensagens = [];
    const statuses = [];
    for (const entry of (Array.isArray(p.entry) ? p.entry : [])) {
        for (const change of (Array.isArray(entry?.changes) ? entry.changes : [])) {
            if (change?.field !== 'messages') continue;
            const value = change.value || {};
            const phoneNumberId = value.metadata?.phone_number_id || null;
            const nomes = new Map((Array.isArray(value.contacts) ? value.contacts : [])
                .map((c) => [c?.wa_id, c?.profile?.name || null]));

            for (const m of (Array.isArray(value.messages) ? value.messages : [])) {
                if (!m?.id || !m?.from) continue; // sem id não há idempotência; sem from não há conversa
                const midiaBruta = TIPOS_MIDIA.has(m.type) ? (m[m.type] || {}) : null;
                mensagens.push({
                    metaMessageId: String(m.id),
                    de: String(m.from),
                    nomePerfil: nomes.get(m.from) || null,
                    tipo: String(m.type || 'desconhecido'),
                    texto: textoDaMensagem(m),
                    midia: midiaBruta ? {
                        metaMediaId: midiaBruta.id || null,
                        mime: midiaBruta.mime_type || null,
                        nomeArquivo: midiaBruta.filename || null,
                        sha256: midiaBruta.sha256 || null,
                    } : null,
                    respostaA: m.context?.id || null,
                    timestamp: tsParaIso(m.timestamp),
                    phoneNumberId,
                });
            }

            for (const s of (Array.isArray(value.statuses) ? value.statuses : [])) {
                if (!s?.id) continue;
                const erro = Array.isArray(s.errors) && s.errors[0] ? s.errors[0] : null;
                statuses.push({
                    metaMessageId: String(s.id),
                    destinatario: s.recipient_id ? String(s.recipient_id) : null,
                    status: String(s.status || 'desconhecido'),
                    timestamp: tsParaIso(s.timestamp),
                    erro: erro ? {
                        codigo: erro.code ?? null,
                        titulo: erro.title || null,
                        detalhe: erro.error_data?.details || erro.message || null,
                    } : null,
                    phoneNumberId,
                });
            }
        }
    }
    return { valido: true, mensagens, statuses };
}

/** Status da Meta → português da tela. Desconhecido fica como veio, nomeado. */
export function traduzirStatusEntrega(status) {
    const mapa = { sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou', deleted: 'apagado', warning: 'aviso' };
    return mapa[String(status || '').toLowerCase()] || String(status || 'desconhecido');
}

/**
 * Falha de entrega → frase COM AÇÃO (padrão interpretarCstat). O 131049 é o
 * protagonista: é o filtro que hoje faz o escritório LIGAR pro cliente sem
 * saber por quê.
 */
export function interpretarErroEntrega(codigo, detalhe = '') {
    const c = Number(codigo);
    if (c === 131049 || c === 130472) {
        return 'A Meta NÃO entregou para preservar o engajamento (filtro de marketing). Ação: template na categoria UTILITY e/ou pedir ao cliente que inicie a conversa (a resposta dele abre a janela de 24h).';
    }
    if (c === 131047) return 'Fora da janela de 24h — reenvie por template aprovado.';
    if (c === 131026) return 'O número não tem WhatsApp ou não pode receber — confira o número no cadastro do cliente.';
    if (c === 131053) return 'Falha no upload/download da mídia — tente reenviar o anexo.';
    return detalhe ? `Falha na entrega: ${detalhe}` : 'Falha na entrega — confira o número e tente novamente.';
}

/** Resumo curto de uma mensagem pra "última mensagem" da conversa. */
export function resumoParaConversa(msg) {
    if (msg.texto) return String(msg.texto).slice(0, 140);
    if (msg.midia?.nomeArquivo) return `📎 ${msg.midia.nomeArquivo}`;
    const rotulos = { image: '🖼️ imagem', document: '📎 documento', audio: '🎙️ áudio', video: '🎬 vídeo', sticker: '🩹 figurinha' };
    return rotulos[msg.tipo] || `(${msg.tipo})`;
}

export const _internals = { tsParaIso, textoDaMensagem };
