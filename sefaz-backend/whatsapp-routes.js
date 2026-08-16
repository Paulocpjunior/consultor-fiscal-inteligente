// ============================================================================
// sefaz-backend/whatsapp-routes.js  (ESM)
// Montado em /api/admin/whatsapp pelo server.js.
// ----------------------------------------------------------------------------
// GATEWAY DO WHATSAPP COMPARTILHADO (Paulo, 10/08): a MESMA API da Meta (uma
// WABA, um token, guardado SÓ no CFI) atende os 5 módulos. Os apps irmãos
// enviam PELO TÚNEL — nunca recebem o token, igual ao gateway do Reinf e ao
// cofre de certificado. Cada departamento usa SEU template aprovado (cadastro
// `whatsapp_templates`), e templates novos entram no cadastro quando a Meta
// aprova.
//
//   GET  /templates[?departamento=]   — lista os templates (admin ou irmão)
//   POST /templates                   — cadastra/edita um template (SÓ admin)
//   DELETE /templates/:id             — desativa (SÓ admin)
//   POST /enviar                      — envia por template (admin ou irmão)
//
// O envio grava auditoria em `whatsapp_envios` SEM o conteúdo do documento —
// só metadado (destino, template, messageId, quem, projeto de origem).
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAdmin, requireAuth } from './require-admin.js';
import { crossProjectAuth, PROJETO } from './require-cross-project-auth.js';
import {
    validarTemplate, resolverTemplate, montarVariaveisPorSchema,
    DEPARTAMENTOS_WHATSAPP,
} from './whatsapp-templates.js';
import {
    enviarTemplateWhatsapp, configWhatsapp, listarTemplatesAprovados,
    listarAppsAssinadosNaWaba, assinarWaba,
} from './whatsapp-cloud.js';
import { configWebhook, faltasDaConfigWebhook } from './whatsapp-webhook.js';

const router = Router();
const COLECAO = 'whatsapp_templates';

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

// Admin do CFI OU app irmão (os 5) com e-mail verificado do domínio.
const doIrmao = crossProjectAuth([PROJETO.fiscal, PROJETO.contabil, PROJETO.dpFolha, PROJETO.financeiro]);
async function autorizar(req, res, next) {
    let passou = false;
    const engolir = { status() { return engolir; }, json() { return engolir; } };
    await requireAdmin(req, engolir, () => { passou = true; });
    if (passou) { req._ehAdmin = true; return next(); }
    return doIrmao(req, res, next);
}

async function lerCadastro(departamento) {
    const db = getDb();
    let q = db.collection(COLECAO);
    if (departamento) q = q.where('departamento', '==', String(departamento).trim().toLowerCase());
    const snap = await q.get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ─── Lista de templates ─────────────────────────────────────────────────────
router.get('/templates', autorizar, async (req, res) => {
    try {
        const templates = await lerCadastro(req.query.departamento);
        return res.json({ ok: true, departamentos: [...DEPARTAMENTOS_WHATSAPP], templates });
    } catch (e) {
        console.error('[whatsapp/templates GET]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Templates APROVADOS na Meta (para ESCOLHER, não digitar) ───────────────
//
// Nome de template aprovado não é opinião: a Meta tem a lista. Digitar o que dá
// pra escolher é criar erro que não precisava existir — foram TRÊS recusas
// seguidas em 13/08 por causa de um `guia_` a mais ou a menos.
//
// A resposta traz também o formato do cabeçalho e a CONTAGEM de variáveis do
// corpo, que eram preenchidos a dedo e recusam o envio quando erram.
router.get('/templates-meta', requireAdmin, async (_req, res) => {
    try {
        const r = await listarTemplatesAprovados();
        if (!r.ok) return res.status(502).json({ ok: false, error: r.erro, acao: r.acao, faltas: r.faltas });
        return res.json({ ok: true, templates: r.templates });
    } catch (e) {
        console.error('[whatsapp/templates-meta]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Cadastro/edição de template (SÓ admin — irmão não define, só usa) ──────
router.post('/templates', requireAdmin, async (req, res) => {
    try {
        const v = validarTemplate(req.body || {});
        if (!v.ok) return res.status(400).json({ ok: false, error: 'Template inválido', detalhes: v.erros });
        const db = getDb();
        await db.collection(COLECAO).doc(v.template.id).set({
            ...v.template,
            atualizadoEm: new Date().toISOString(),
            atualizadoPor: req.user?.email || null,
        }, { merge: true });

        // ── RENOMEAR NÃO PODE DEIXAR RASTRO ATIVO ───────────────────────────
        //
        // O id do doc é `departamento__nome`, então trocar o nome CRIA outro
        // template em vez de renomear. Era por isso que a tela travava o campo
        // — e a trava virou beco sem saída: o template aprovado mudou de nome
        // (13/08) e não havia como corrigir o cadastro.
        //
        // Destravar sozinho seria pior: dois templates ATIVOS no mesmo
        // departamento fazem `resolverTemplate` recusar por ambiguidade, e o
        // envio quebraria de um jeito novo. Então quem renomeia desativa o
        // antigo aqui, e a resposta DIZ que isso aconteceu — cadastro que muda
        // sozinho sem avisar é o que faz ninguém confiar na tela.
        let substituiu = null;
        const anterior = String(req.body?.idAnterior || '').trim();
        if (anterior && anterior !== v.template.id) {
            try {
                const ref = db.collection(COLECAO).doc(anterior);
                const snap = await ref.get();
                if (snap.exists) {
                    await ref.set({
                        ativo: false,
                        desativadoEm: new Date().toISOString(),
                        desativadoPor: req.user?.email || null,
                        desativadoMotivo: `Substituído por "${v.template.nome}" (renomeado no cadastro).`,
                    }, { merge: true });
                    substituiu = { id: anterior, nome: snap.data()?.nome || null };
                }
            } catch (e) {
                // Falhar aqui deixaria DOIS ativos — melhor recusar do que
                // entregar um cadastro ambíguo que só quebra no envio.
                return res.status(500).json({
                    ok: false,
                    error: `O template novo foi salvo, mas não foi possível desativar o anterior (${anterior}): ${e.message}. `
                        + 'Desative-o na lista antes de enviar — dois templates ativos no mesmo departamento fazem o envio recusar por ambiguidade.',
                });
            }
        }
        return res.json({ ok: true, template: v.template, substituiu });
    } catch (e) {
        console.error('[whatsapp/templates POST]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.delete('/templates/:id', requireAdmin, async (req, res) => {
    try {
        await getDb().collection(COLECAO).doc(String(req.params.id)).set({ ativo: false }, { merge: true });
        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Envio por template (admin OU irmão) ────────────────────────────────────
// Body: { departamento, template?, para, variaveis:{chave:valor}, pdfBase64?,
//         nomeArquivo?, referencia? }
// O token da Meta NUNCA sai daqui — o irmão só manda o que quer dizer.
router.post('/enviar', autorizar, async (req, res) => {
    try {
        const p = req.body || {};
        const departamento = String(p.departamento || '').trim().toLowerCase();
        if (!DEPARTAMENTOS_WHATSAPP.has(departamento)) {
            return res.status(400).json({ ok: false, error: `departamento inválido (use ${[...DEPARTAMENTOS_WHATSAPP].join(', ')})` });
        }
        if (!p.para) return res.status(400).json({ ok: false, error: 'para (WhatsApp do destinatário) é obrigatório' });

        const cadastro = await lerCadastro(departamento);
        const resol = resolverTemplate(cadastro, { departamento, templateNome: p.template });
        if (!resol.ok) return res.status(400).json({ ok: false, error: resol.erro, opcoes: resol.opcoes });
        const template = resol.template;

        // Variáveis NOMEADAS → posicionais pelo schema. Faltando = recusa.
        const mv = montarVariaveisPorSchema(template, p.variaveis);
        if (!mv.ok) {
            return res.status(400).json({ ok: false, error: `Faltam variáveis do template "${template.nome}": ${mv.faltando.join(', ')}`, faltando: mv.faltando });
        }
        if (template.temDocumento && !p.pdfBase64) {
            return res.status(400).json({ ok: false, error: `O template "${template.nome}" tem cabeçalho de documento — envie o pdfBase64.` });
        }
        // O CAMINHO INVERSO ERA MUDO, e era o pior dos dois.
        //
        // Com `temDocumento: false`, o PDF era DESCARTADO em silêncio logo
        // abaixo (`pdfBase64: template.temDocumento ? ... : null`): a mensagem
        // saía dizendo "segue em anexo a guia", sem anexo nenhum, a Meta
        // devolvia messageId e o app registrava PROVA DE ENVIO. O cliente
        // recebe uma promessa de anexo que não existe, e ninguém no escritório
        // fica sabendo — é farol verde sobre entrega que não aconteceu.
        //
        // Template do WhatsApp só carrega arquivo se tiver CABEÇALHO DE
        // DOCUMENTO aprovado pela Meta; isso não se contorna do lado de cá.
        if (!template.temDocumento && p.pdfBase64) {
            return res.status(400).json({
                ok: false,
                error: `O template "${template.nome}" NÃO tem cabeçalho de documento, então ele não pode levar `
                    + 'o PDF da guia — a mensagem sairia prometendo um anexo que não vai junto, e o envio seria '
                    + 'registrado como bem-sucedido.',
                acao: 'No Gerenciador do WhatsApp, edite o modelo e adicione um cabeçalho do tipo DOCUMENTO (ou '
                    + 'crie um modelo novo com ele). Depois marque "📎 tem documento" no cadastro do template em '
                    + '⚙️ Config Admin. Enquanto isso, mande a guia por e-mail — lá o anexo é comprovado.',
            });
        }

        const envio = await enviarTemplateWhatsapp({
            para: p.para,
            template: template.nome,
            idioma: template.idioma,
            variaveis: mv.variaveis,
            pdfBase64: template.temDocumento ? (p.pdfBase64 || null) : null,
            nomeArquivo: p.nomeArquivo || `${departamento}_${template.nome}.pdf`,
        });
        if (!envio.ok) {
            const status = envio.configuracaoIncompleta ? 503 : envio.indeterminado ? 502 : 422;
            return res.status(status).json({ ok: false, error: envio.erro, acao: envio.acao, indeterminado: Boolean(envio.indeterminado) });
        }

        // Auditoria SEM conteúdo do documento — só metadado.
        try {
            await getDb().collection('whatsapp_envios').add({
                em: admin.firestore.FieldValue.serverTimestamp(),
                departamento, template: template.nome,
                numeroEnviado: envio.numeroEnviado, messageId: envio.messageId,
                por: req.user?.email || null,
                projetoOrigem: req.user?.projeto || (req._ehAdmin ? 'cfi' : null),
                referencia: p.referencia || null,
                temDocumento: Boolean(template.temDocumento && p.pdfBase64),
            });
        } catch (e) { console.warn('[whatsapp/enviar] auditoria falhou:', e.message); }

        return res.json({ ok: true, messageId: envio.messageId, numeroEnviado: envio.numeroEnviado, template: template.nome });
    } catch (e) {
        console.error('[whatsapp/enviar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Status do canal (o botão da tela pergunta antes de aparecer) ──────────
router.get('/status', autorizar, (_req, res) => {
    const cfg = configWhatsapp();
    return res.json({ ok: true, pronto: Boolean(cfg.token && cfg.phoneNumberId) });
});

// ─── Painel do WEBHOOK (F1 do 💬 Comunicação) — admin ───────────────────────
// A rota pública /api/whatsapp/webhook não tem tela própria; ESTA é a tela
// dela (rota sem botão não é funcionalidade). Mostra: config (faltas
// nomeadas), últimos status de entrega e últimas mensagens recebidas.
router.get('/webhook-status', requireAdmin, async (_req, res) => {
    try {
        const cfg = configWebhook();
        const faltas = faltasDaConfigWebhook(cfg);
        const db = getDb();

        // Queries de campo único (sem índice composto): statusEm só existe em
        // doc com status; recebidoEm só em mensagem recebida — o orderBy do
        // Firestore já exclui quem não tem o campo.
        const [statusSnap, msgSnap, evSnap] = await Promise.all([
            db.collection('whatsapp_mensagens').orderBy('statusEm', 'desc').limit(10).get(),
            db.collection('whatsapp_mensagens').orderBy('recebidoEm', 'desc').limit(10).get(),
            db.collection('whatsapp_webhook_eventos').orderBy('recebidoEm', 'desc').limit(1).get(),
        ]);

        const ultimosStatus = statusSnap.docs.map((d) => {
            const x = d.data();
            return {
                messageId: d.id, numero: x.conversaId || null,
                status: x.statusEntrega || null, em: x.statusEm || null,
                erro: x.erroEntrega || null,
            };
        });
        const ultimasMensagens = msgSnap.docs
            .filter((d) => d.data().direcao === 'entrada')
            .map((d) => {
                const x = d.data();
                return {
                    numero: x.conversaId || null, tipo: x.tipo || null,
                    texto: x.texto ? String(x.texto).slice(0, 160) : null,
                    temMidia: Boolean(x.midia), em: x.timestamp || x.recebidoEm || null,
                };
            });
        const ultimoEventoEm = evSnap.empty ? null : (evSnap.docs[0].data().recebidoEm || null);

        // A SEGUNDA amarração: o app precisa estar ASSINADO na WABA, senão o
        // teste do painel chega e a mensagem real não (caso de 16/08). Falha
        // aqui não derruba o painel — vira aviso nomeado.
        let assinaturaWaba = null;
        try {
            const a = await listarAppsAssinadosNaWaba();
            assinaturaWaba = a.ok
                ? { ok: true, wabaId: a.wabaId, apps: a.apps }
                : { ok: false, erro: a.erro };
        } catch (e) { assinaturaWaba = { ok: false, erro: e.message }; }

        return res.json({
            ok: true,
            configurado: faltas.length === 0,
            faltas,
            // O caminho que o Paulo cola no painel da Meta (campo Callback URL).
            caminhoWebhook: '/api/whatsapp/webhook',
            assinaturaWaba,
            ultimoEventoEm,
            ultimosStatus,
            ultimasMensagens,
        });
    } catch (e) {
        console.error('[whatsapp/webhook-status]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Assina o NOSSO app na WABA (subscribed_apps) — é o que liga o fluxo REAL de
// eventos. Idempotente: assinar de novo não duplica nada.
router.post('/webhook-assinar-waba', requireAdmin, async (_req, res) => {
    try {
        const r = await assinarWaba();
        if (!r.ok) return res.status(502).json({ ok: false, error: r.erro, acao: r.acao });
        return res.json({ ok: true, wabaId: r.wabaId });
    } catch (e) {
        console.error('[whatsapp/webhook-assinar-waba]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ═══ SP CONNECT — F2, PR 1: LEITURA das conversas ═══════════════════════════
//
// Todo colaborador autenticado lê (requireAuth): na F2 inicial NENHUMA
// conversa tem fila (triagem manual ainda não roda), então tudo é Recepção —
// e Recepção é visível a todos (decisão de 14/08). Quando a atribuição de
// fila nascer, o filtro por departamento entra AQUI, no backend (o front
// nunca é o filtro de dados — regra da Carteira).

// Uma leitura, todas as conversas + o contato de cada uma (getAll em lote —
// nada de N consultas).
router.get('/conversas', requireAuth, async (_req, res) => {
    try {
        const db = getDb();
        const snap = await db.collection('whatsapp_conversas')
            .orderBy('atualizadoEm', 'desc').limit(100).get();
        const numeros = snap.docs.map((d) => d.id);
        const contatos = new Map();
        if (numeros.length) {
            const refs = numeros.map((n) => db.collection('whatsapp_contatos').doc(n));
            (await db.getAll(...refs)).forEach((c) => { if (c.exists) contatos.set(c.id, c.data()); });
        }
        const conversas = snap.docs.map((d) => {
            const x = d.data();
            const c = contatos.get(d.id) || {};
            return {
                numero: d.id,
                nome: c.nomePerfil || null,
                empresaId: c.empresaId || null,   // null = pendência "vincular ao cliente"
                origemContato: c.origem || null,
                fila: x.fila || null,             // null = Recepção
                atribuidoA: x.atribuidoA || null,
                situacao: x.status || 'aberta',
                janela24hAte: x.janela24hAte || null,
                ultimaMensagem: x.ultimaMensagem || null,
                naoLidas: x.naoLidas || 0,
                atualizadoEm: x.atualizadoEm || null,
            };
        });
        return res.json({ ok: true, conversas });
    } catch (e) {
        console.error('[whatsapp/conversas]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Mensagens de UMA conversa. Filtro simples + ordenação em memória de
// propósito: where(conversaId)+orderBy(timestamp) exigiria índice composto,
// e 500 docs de mensagem são leves — índice entra se o volume provar precisar.
router.get('/conversas/:numero/mensagens', requireAuth, async (req, res) => {
    try {
        const numero = String(req.params.numero || '').replace(/\D/g, '');
        if (!numero) return res.status(400).json({ ok: false, error: 'número inválido' });
        const snap = await getDb().collection('whatsapp_mensagens')
            .where('conversaId', '==', numero).limit(500).get();
        const mensagens = snap.docs.map((d) => {
            const x = d.data();
            return {
                id: d.id,
                direcao: x.direcao || null,
                tipo: x.tipo || null,
                texto: x.texto ?? null,
                midia: x.midia ? {
                    nomeArquivo: x.midia.nomeArquivo || null,
                    mime: x.midia.mime || null,
                    baixada: Boolean(x.midia.storagePath),
                } : null,
                timestamp: x.timestamp || x.recebidoEm || null,
                statusEntrega: x.statusEntrega || null,
                erroEntrega: x.erroEntrega || null,
            };
        }).sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
        return res.json({ ok: true, mensagens });
    } catch (e) {
        console.error('[whatsapp/mensagens]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Abrir a conversa zera o contador de não lidas — sem isso o selo mente
// pra sempre. É a ÚNICA escrita do PR 1 (responder é o PR 2).
router.post('/conversas/:numero/lida', requireAuth, async (req, res) => {
    try {
        const numero = String(req.params.numero || '').replace(/\D/g, '');
        if (!numero) return res.status(400).json({ ok: false, error: 'número inválido' });
        await getDb().collection('whatsapp_conversas').doc(numero)
            .set({ naoLidas: 0 }, { merge: true });
        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
