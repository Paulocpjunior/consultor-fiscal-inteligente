// ============================================================================
// sefaz-backend/whatsapp-webhook-routes.js  (ESM)
// Montado em /api/whatsapp pelo server.js — rota PÚBLICA (a Meta chama).
// ----------------------------------------------------------------------------
// F1 do módulo 💬 Comunicação: receber e GRAVAR, nada de tela de conversa
// ainda (é a F2). A Ultra Fox continua recebendo em paralelo — subscrever o
// nosso app na WABA não tira o dela.
//
// SEGURANÇA DA ROTA PÚBLICA:
// - GET  = handshake da Meta (verify token, tempo constante).
// - POST = só entra com X-Hub-Signature-256 válida sobre o corpo CRU
//   (req.rawBody, guardado pelo verify do express.json no server.js).
//
// DECISÕES DE GRAVAÇÃO:
// - O evento CRU é gravado PRIMEIRO (whatsapp_webhook_eventos, id = hash do
//   corpo ⇒ reentrega da Meta sobrescreve o mesmo doc). É o padrão do
//   Jotform Sign: a forma real se aprende do dado guardado.
// - Idempotência das mensagens pelo id da Meta (wamid) como id do doc —
//   reentrega não duplica.
// - Falha de gravação → HTTP 500 DE PROPÓSITO: a Meta reentrega, e como tudo
//   é idempotente, reprocessar é seguro. Responder 200 com gravação perdida
//   seria sumir com mensagem de cliente em silêncio.
// - Status de entrega ATUALIZA a mensagem e a auditoria de envio
//   (whatsapp_envios) — é o "entregue/lido/falhou" que o painel mostra.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { createHash } from 'crypto';
import {
    configWebhook, faltasDaConfigWebhook, responderVerificacao,
    assinaturaValida, extrairEventos, traduzirStatusEntrega,
    interpretarErroEntrega, janela24hAte, resumoParaConversa,
} from './whatsapp-webhook.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

// ─── GET: handshake de assinatura do webhook no painel da Meta ──────────────
router.get('/webhook', (req, res) => {
    const r = responderVerificacao(req.query, configWebhook());
    if (!r.ok) {
        console.warn('[whatsapp/webhook GET] verificação recusada:', r.motivo);
        return res.sendStatus(403);
    }
    // A Meta espera o challenge CRU (texto), não JSON.
    return res.status(200).send(r.challenge);
});

/** Grava UMA mensagem recebida + contato + conversa. Idempotente pelo wamid. */
async function gravarMensagemRecebida(db, msg) {
    const agora = new Date().toISOString();
    await db.collection('whatsapp_mensagens').doc(msg.metaMessageId).set({
        conversaId: msg.de,
        direcao: 'entrada',
        tipo: msg.tipo,
        texto: msg.texto,
        midia: msg.midia,           // download do binário é da F2 — o media id fica guardado
        respostaA: msg.respostaA,
        timestamp: msg.timestamp,
        phoneNumberId: msg.phoneNumberId,
        recebidoEm: agora,
    }, { merge: true });

    // Contato: `origem` só nasce na criação — quem veio da importação da Ultra
    // Fox (F2) não vira "espontaneo" por ter mandado mensagem.
    const contatoRef = db.collection('whatsapp_contatos').doc(msg.de);
    const contato = await contatoRef.get();
    await contatoRef.set({
        numero: msg.de,
        ...(msg.nomePerfil ? { nomePerfil: msg.nomePerfil } : {}),
        ...(contato.exists ? {} : { origem: 'espontaneo', criadoEm: agora, empresaId: null }),
        atualizadoEm: agora,
    }, { merge: true });

    await db.collection('whatsapp_conversas').doc(msg.de).set({
        numero: msg.de,
        ultimaMensagem: { resumo: resumoParaConversa(msg), direcao: 'entrada', em: msg.timestamp || agora },
        // Mensagem do cliente ABRE/renova a janela de 24h — é ela que a F2 mostra.
        janela24hAte: janela24hAte(msg.timestamp || agora),
        naoLidas: admin.firestore.FieldValue.increment(1),
        atualizadoEm: agora,
    }, { merge: true });
}

/** Grava UM status de entrega na mensagem e na auditoria de envio. */
async function gravarStatus(db, st) {
    const agora = new Date().toISOString();
    const statusPt = traduzirStatusEntrega(st.status);
    const patch = {
        statusEntrega: statusPt,
        statusEm: st.timestamp || agora,
        ...(st.erro ? {
            erroEntrega: {
                codigo: st.erro.codigo,
                detalhe: st.erro.detalhe || st.erro.titulo || null,
                acao: interpretarErroEntrega(st.erro.codigo, st.erro.detalhe || ''),
            },
        } : {}),
    };

    // "lido" não pode regredir pra "entregue" quando a Meta manda os dois fora
    // de ordem — o read implica delivered, então só avança.
    const ref = db.collection('whatsapp_mensagens').doc(st.metaMessageId);
    const atual = await ref.get();
    const ordem = { enviado: 1, entregue: 2, lido: 3, falhou: 3 };
    const jaTem = ordem[atual.data()?.statusEntrega] || 0;
    const chegando = ordem[statusPt] || 0;
    if (atual.exists && jaTem >= chegando && jaTem !== 0) return;

    await ref.set({
        conversaId: st.destinatario || atual.data()?.conversaId || null,
        ...(atual.exists ? {} : { direcao: 'saida', timestamp: st.timestamp || agora }),
        ...patch,
    }, { merge: true });

    // Liga o status à auditoria do envio (a guia enviada pelo rito) — é o
    // aceite da F1: "envio real mostrando entregue/lido no painel".
    try {
        const snap = await db.collection('whatsapp_envios')
            .where('messageId', '==', st.metaMessageId).limit(1).get();
        if (!snap.empty) await snap.docs[0].ref.set(patch, { merge: true });
    } catch (e) {
        console.warn('[whatsapp/webhook] status não ligou na auditoria:', e.message);
    }
}

// ─── POST: eventos da Meta (mensagens + statuses) ───────────────────────────
router.post('/webhook', async (req, res) => {
    const cfg = configWebhook();
    const faltas = faltasDaConfigWebhook(cfg);
    if (faltas.length) {
        console.warn('[whatsapp/webhook POST] sem config:', faltas.join('; '));
        return res.sendStatus(503);
    }
    if (!assinaturaValida(req.rawBody, req.headers['x-hub-signature-256'], cfg.appSecret)) {
        console.warn('[whatsapp/webhook POST] assinatura inválida — descartado');
        return res.sendStatus(401);
    }

    try {
        const db = getDb();
        const agora = new Date().toISOString();

        // 1) Evento cru primeiro — se o resto falhar, a reentrega reprocessa.
        const hash = createHash('sha256').update(req.rawBody).digest('hex').slice(0, 40);
        await db.collection('whatsapp_webhook_eventos').doc(hash).set({
            recebidoEm: agora,
            payload: req.body,
        }, { merge: true });

        // 2) Extrai e grava.
        const ev = extrairEventos(req.body);
        if (!ev.valido) {
            console.warn('[whatsapp/webhook POST] payload fora do esperado:', ev.motivo);
            return res.sendStatus(200); // assinado pela Meta, mas não é da WABA — nada a fazer
        }
        for (const msg of ev.mensagens) await gravarMensagemRecebida(db, msg);
        for (const st of ev.statuses) await gravarStatus(db, st);

        return res.status(200).json({ ok: true, mensagens: ev.mensagens.length, statuses: ev.statuses.length });
    } catch (e) {
        // 500 de propósito: a Meta reentrega e a gravação é idempotente.
        console.error('[whatsapp/webhook POST]', e);
        return res.sendStatus(500);
    }
});

export default router;
