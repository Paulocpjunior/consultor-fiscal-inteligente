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
import { destinatariosDoPush, destinatariosDoAvisoTeams, montarPushMensagem, tokenMorreu, montarAuditoriaAviso } from './whatsapp-push.js';
import { enviarAvisoTeams } from './teams-aviso.js';

export const COLECAO_TOKENS = 'whatsapp_push_tokens';

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

/** Usuários + tokens + preferências, no formato que o núcleo espera. */
export async function lerUsuariosComToken(db) {
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
        const { alvos, fora: foraPush } = destinatariosDoPush({
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
        // pode ter o Teams aberto. Nasce LIGADO (avisoTeamsAtivo: true) —
        // regra do Paulo (23/08): "OS ALERTAS NASCEM LIGADOS SEMPRE". O
        // "nasce desligado" vale só pro que fala com o CLIENTE.
        // 🔎 O QUE ACONTECEU COM CADA CANAL fica GRAVADO (24/09, Paulo: "não
        // estamos recebendo notificação"). O núcleo já sabia quem ficou de
        // fora e por quê; o fan-out jogava isso no console. Agora vira o doc
        // `whatsapp_config/ultimo_aviso`, que a ⚙️ → 🔔 mostra — silêncio sem
        // motivo é o que faz a pessoa concluir "o app não avisa".
        const auditoriaTeams = { alvos: [], fora: [], enviados: 0, erros: [] };
        if (config?.avisoTeamsAtivo) {
            const teams = destinatariosDoAvisoTeams({ usuarios, conversa, config, agora: new Date(), autorDaMensagem: null });
            auditoriaTeams.alvos = teams.alvos; auditoriaTeams.fora = teams.fora;
            for (const alvo of teams.alvos) {
                const r = await (deps.enviarTeams || enviarAvisoTeams)({
                    email: alvo.email, titulo: aviso.titulo, corpo: aviso.corpo,
                });
                if (r.ok) auditoriaTeams.enviados += 1;
                else {
                    auditoriaTeams.erros.push({ email: alvo.email, etapa: r.etapa || null, erro: String(r.erro || '').slice(0, 200) });
                    console.warn(`[whatsapp/teams-aviso] ${alvo.email}: ${r.etapa} — ${r.erro}`);
                }
            }
        } else {
            auditoriaTeams.fora = usuarios.map((u) => ({ uid: u.uid, email: u.email || null, motivo: 'aviso no Teams DESLIGADO na ⚙️ (chave geral)' }));
        }
        const gravarAuditoria = async (enviadosPush) => {
            try {
                await db.collection('whatsapp_config').doc('ultimo_aviso').set(montarAuditoriaAviso({
                    titulo: aviso.titulo,
                    push: { alvos, fora: foraPush, enviados: enviadosPush },
                    teams: auditoriaTeams,
                }));
            } catch (e) { console.warn('[whatsapp/push] auditoria do aviso não gravada:', e.message); }
        };

        // O `if (!alvos.length) return` fica LITERAL de propósito: a trava de
        // teamsAviso.test.ts prende que o bloco do Teams (acima) vem ANTES
        // deste early-return do FCM — quem não registrou celular ainda pode
        // ter o Teams aberto. A auditoria entra na mesma linha.
        if (!alvos.length) return gravarAuditoria(0).then(() => ({ enviados: 0, alvos: 0, fora: foraPush }));
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
        await gravarAuditoria(enviados);
        return { enviados, alvos: alvos.length, fora: foraPush };
    } catch (e) {
        // Push é aviso; mensagem é dado. Nunca inverter a prioridade.
        console.warn('[whatsapp/push] não enviado (a mensagem está gravada):', e.message);
        return { enviados: 0, erro: e.message };
    }
}

/**
 * 🧪 Push de TESTE para os aparelhos de UMA pessoa (o botão "Testar tudo" da
 * ⚙️ → 🔔). Diz o que faltou quando não dá: sem aparelho registrado não é
 * falha do FCM, é ausência de cadastro — e a frase tem de dizer isso.
 */
export async function enviarPushTeste({ uid, titulo, corpo, deps = {} }) {
    const db = deps.db || getDb();
    const d = (await db.collection(COLECAO_TOKENS).doc(uid).get()).data() || {};
    const tokens = Array.isArray(d.tokens) ? [...new Set(d.tokens)] : [];
    if (!tokens.length) return { ok: false, etapa: 'sem-aparelho', erro: 'Nenhum celular/navegador registrado para push nesta conta.' };
    const messaging = deps.messaging || admin.messaging();
    const resp = await messaging.sendEachForMulticast({
        tokens,
        notification: { title: titulo, body: corpo },
        data: { link: '/connect', tag: 'spconnect-teste' },
        webpush: { fcmOptions: { link: '/connect' }, notification: { icon: '/connect-icon-192.png', tag: 'spconnect-teste' } },
    });
    const mortos = resp.responses.map((r, i) => (!r.success && tokenMorreu(r.error?.code) ? tokens[i] : null)).filter(Boolean);
    await limparTokensMortos(db, uid, mortos);
    if (resp.successCount > 0) return { ok: true, enviados: resp.successCount, aparelhos: tokens.length, mortos: mortos.length };
    const primeiro = resp.responses.find((r) => !r.success)?.error;
    return { ok: false, etapa: 'fcm', erro: primeiro?.message || 'O FCM recusou todos os aparelhos.', mortos: mortos.length };
}
