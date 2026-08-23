// ============================================================================
// sefaz-backend/whatsapp-push-envio.js  (ESM — I/O do push)
// ----------------------------------------------------------------------------
// Manda o push pelo FCM (Admin SDK, mesma credencial do Firestore — não
// existe chave nova de servidor pra guardar). A decisão de QUEM recebe é do
// núcleo puro `whatsapp-push.js`; aqui é só entrega.
//
// BEST-EFFORT SEMPRE: falhar o aviso não pode derrubar a captura da
// mensagem, que é o que não se recupera. A falha vai NOMEADA pro log.
// ============================================================================

import admin from 'firebase-admin';
import { destinatariosDoPush, destinatariosDoAvisoTeams, montarPushMensagem, tokenMorreu } from './whatsapp-push.js';
import { enviarAvisoTeams } from './teams-aviso.js';

export const COLECAO_TOKENS = 'whatsapp_push_tokens';

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

/** Usuários + tokens + preferências, no formato que o núcleo espera. */
async function lerUsuariosComToken(db) {
    const [users, tokens] = await Promise.all([
        db.collection('users').limit(500).get(),
        db.collection(COLECAO_TOKENS).limit(500).get(),
    ]);
    const porUid = new Map();
    tokens.docs.forEach((d) => porUid.set(d.id, d.data() || {}));
    return users.docs.map((d) => {
        const u = d.data() || {};
        const t = porUid.get(d.id) || {};
        return {
            uid: d.id,
            email: u.email || null,
            role: u.role || 'colaborador',
            papelAtendimento: u.papelAtendimento || null,
            departamentos: Array.isArray(u.departamentos) ? u.departamentos : [],
            filasAtendimento: Array.isArray(u.filasAtendimento) ? u.filasAtendimento : [],
            prefs: t.prefs || {},
            tokens: Array.isArray(t.tokens) ? t.tokens : [],
        };
    });
}

/** Remove do cadastro os tokens que o FCM disse que não existem mais. */
async function limparTokensMortos(db, uid, mortos) {
    if (!mortos.length) return;
    try {
        const ref = db.collection(COLECAO_TOKENS).doc(uid);
        const atual = (await ref.get()).data()?.tokens || [];
        await ref.set({ tokens: atual.filter((t) => !mortos.includes(t)) }, { merge: true });
        console.log(`[whatsapp/push] ${mortos.length} token(s) morto(s) removidos de ${uid}`);
    } catch (e) {
        console.warn('[whatsapp/push] limpeza de token falhou:', e.message);
    }
}

/**
 * Envia o push de UMA mensagem recebida. `msg` é a mensagem do webhook;
 * `conversa` traz a fila (é ela que decide quem recebe).
 */
export async function notificarMensagem({ msg, conversa = {}, config = null, canalRotulo = null, deps = {} }) {
    try {
        const db = deps.db || getDb();
        const usuarios = await lerUsuariosComToken(db);
        const { alvos } = destinatariosDoPush({
            usuarios, conversa, config, agora: new Date(),
            // Mensagem RECEBIDA não tem autor interno; o campo existe pra
            // quando o push for usado em mensagem de saída (menção, etc.).
            autorDaMensagem: null,
        });

        const aviso = montarPushMensagem({
            nomeContato: msg.nomePerfil, numero: msg.de,
            resumo: msg.texto || (msg.midia ? '📎 anexo' : 'nova mensagem'),
            canalRotulo,
        });

        // 🔔 Aviso NATIVO do Teams (Paulo, 23/08) — MESMA audiência do push
        // (destinatariosDoAvisoTeams reusa a régua), outra porta. Best-effort
        // e ANTES do early-return do FCM: quem não registrou celular ainda
        // pode ter o Teams aberto. Nasce desligado (avisoTeamsAtivo).
        if (config?.avisoTeamsAtivo) {
            const teams = destinatariosDoAvisoTeams({ usuarios, conversa, config, agora: new Date(), autorDaMensagem: null });
            for (const alvo of teams.alvos) {
                const r = await (deps.enviarTeams || enviarAvisoTeams)({
                    email: alvo.email, titulo: aviso.titulo, corpo: aviso.corpo,
                });
                if (!r.ok) console.warn(`[whatsapp/teams-aviso] ${alvo.email}: ${r.etapa} — ${r.erro}`);
            }
        }

        if (!alvos.length) return { enviados: 0, alvos: 0 };
        const messaging = deps.messaging || admin.messaging();
        let enviados = 0;
        for (const alvo of alvos) {
            const resp = await messaging.sendEachForMulticast({
                tokens: alvo.tokens,
                notification: { title: aviso.titulo, body: aviso.corpo },
                data: { numero: msg.de, link: aviso.link, tag: aviso.tag },
                webpush: {
                    fcmOptions: { link: aviso.link },
                    notification: { icon: '/connect-icon-192.png', tag: aviso.tag, badge: '/connect-icon-192.png' },
                },
            });
            enviados += resp.successCount;
            const mortos = resp.responses
                .map((r, i) => (!r.success && tokenMorreu(r.error?.code) ? alvo.tokens[i] : null))
                .filter(Boolean);
            await limparTokensMortos(db, alvo.uid, mortos);
        }
        return { enviados, alvos: alvos.length };
    } catch (e) {
        // Push é aviso; mensagem é dado. Nunca inverter a prioridade.
        console.warn('[whatsapp/push] não enviado (a mensagem está gravada):', e.message);
        return { enviados: 0, erro: e.message };
    }
}
