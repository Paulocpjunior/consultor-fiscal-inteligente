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
    listarAppsAssinadosNaWaba, assinarWaba, enviarTextoLivre, normalizarNumeroBr,
} from './whatsapp-cloud.js';
import {
    FILAS_ATENDIMENTO, filaValida, filasVisiveis, conversaVisivel,
    resolverConfig,
} from './whatsapp-atendimento.js';
import {
    interpretarContatosCsv, interpretarConversaTxt, interpretarMensagensCsv,
    prepararMensagensDoTxt, idMensagemImportada,
} from './whatsapp-import-ultrafox.js';
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

// LEITURA do cadastro de templates: qualquer usuário logado (o atendente do
// SP Connect escolhe template pra iniciar conversa) OU app irmão pelo túnel.
// Gravação continua requireAdmin — atendente usa, não define.
async function autorizarLeitura(req, res, next) {
    let passou = false;
    const engolir = { status() { return engolir; }, json() { return engolir; } };
    await requireAuth(req, engolir, () => { passou = true; });
    if (passou) return next();
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
router.get('/templates', autorizarLeitura, async (req, res) => {
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
router.get('/templates-meta', autorizarLeitura, async (_req, res) => {
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

// Filas que o usuário logado enxerga (null = todas). O escopo é do BACKEND —
// o front nunca é o filtro de dados (regra da Carteira).
async function filasDoUsuario(db, user) {
    if (user?.role === 'admin') return null;
    let departamentos = []; let filasAtendimento = [];
    try {
        const u = await db.collection('users').doc(user.uid).get();
        departamentos = u.data()?.departamentos || [];
        filasAtendimento = u.data()?.filasAtendimento || [];
    } catch { /* sem doc = só Recepção */ }
    return filasVisiveis({ role: user?.role, departamentos, filasAtendimento });
}

// Uma leitura, todas as conversas + o contato de cada uma (getAll em lote —
// nada de N consultas).
router.get('/conversas', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const minhasFilas = await filasDoUsuario(db, req.user);
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
                nome: c.nomeExibicao || c.nomePerfil || null,
                empresaId: c.empresaId || null,   // null = pendência "vincular ao cliente"
                empresaNome: c.empresaNome || null,
                origemContato: c.origem || null,
                fila: x.fila || null,             // null = Recepção
                protocolo: x.protocolo || null,
                atribuidoA: x.atribuidoA || null,
                transferidaDe: x.transferidaDe || null,   // selo "↪ veio de X" até alguém assumir
                situacao: x.status || 'aberta',
                janela24hAte: x.janela24hAte || null,
                ultimaMensagem: x.ultimaMensagem || null,
                naoLidas: x.naoLidas || 0,
                atualizadoEm: x.atualizadoEm || null,
            };
        }).filter((cv) => conversaVisivel(minhasFilas, cv.fila));
        return res.json({ ok: true, conversas, filas: FILAS_ATENDIMENTO, minhasFilas });
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

// ─── INICIAR CONVERSA (PR 3) — template aprovado, a porta de fora da janela ─
// Regra da Meta: conversa iniciada pela empresa SÓ sai por template. Template
// COM documento fica de fora aqui de propósito: guia viaja pelas telas de
// guia (rito #293) — o SP Connect inicia CONVERSA, não entrega imposto.
router.post('/conversas/iniciar', requireAuth, async (req, res) => {
    try {
        const p = req.body || {};
        const departamento = String(p.departamento || '').trim().toLowerCase();
        if (!DEPARTAMENTOS_WHATSAPP.has(departamento)) {
            return res.status(400).json({ ok: false, error: `Departamento inválido (use ${[...DEPARTAMENTOS_WHATSAPP].join(', ')}).` });
        }
        if (!p.para) return res.status(400).json({ ok: false, error: 'Informe o número do WhatsApp do destinatário.' });

        // A conversa de um número é UMA só. Se ela já está ABERTA e EM
        // CONDUÇÃO por alguém, um template no meio seria uma segunda voz na
        // mesma thread do cliente — a saída certa é falar com quem conduz
        // (nota interna) ou pedir a transferência. Recusa DIZ o estado.
        const numeroAlvo = normalizarNumeroBr(p.para);
        if (numeroAlvo) {
            const convExistente = await getDb().collection('whatsapp_conversas').doc(numeroAlvo).get();
            const cx = convExistente.data() || {};
            if (convExistente.exists && (cx.status || 'aberta') === 'aberta' && cx.atribuidoA) {
                return res.status(409).json({
                    ok: false,
                    error: `Este número já está em atendimento na fila ${(FILAS_ATENDIMENTO.find((f) => f.id === (cx.fila || 'recepcao')) || {}).rotulo || 'Recepção'}, em condução por ${cx.atribuidoA}.`,
                    acao: 'Abra a conversa e deixe uma nota interna pra quem conduz, ou peça a transferência de fila — iniciar outro template criaria duas vozes na mesma conversa do cliente.',
                    emConducaoPor: cx.atribuidoA,
                    fila: cx.fila || 'recepcao',
                });
            }
        }

        // DUAS portas: template do CADASTRO (variáveis nomeadas) OU template
        // APROVADO direto da Meta (o atendente vê o corpo e preenche {{1}},
        // {{2}}… posicionais) — linkar na ⚙️ vira opção, não pré-requisito.
        let nomeTemplate; let idiomaTemplate; let variaveisPosicionais;
        if (p.templateDireto?.nome) {
            nomeTemplate = String(p.templateDireto.nome).trim();
            idiomaTemplate = String(p.templateDireto.idioma || 'pt_BR').trim();
            variaveisPosicionais = (Array.isArray(p.variaveisPosicionais) ? p.variaveisPosicionais : [])
                .map((v) => String(v ?? '').trim());
            if (variaveisPosicionais.some((v) => !v)) {
                return res.status(400).json({ ok: false, error: 'Preencha todas as variáveis do template — a Meta recusa envio meio preenchido.' });
            }
        } else {
            const cadastro = await lerCadastro(departamento);
            const resol = resolverTemplate(cadastro, { departamento, templateNome: p.template });
            if (!resol.ok) return res.status(400).json({ ok: false, error: resol.erro, opcoes: resol.opcoes });
            const template = resol.template;
            if (template.temDocumento) {
                return res.status(400).json({
                    ok: false,
                    error: `O template "${template.nome}" tem cabeçalho de DOCUMENTO — ele serve pra enviar guia, e guia sai pelas telas de guia (com o PDF e o rito completo).`,
                    acao: 'Escolha um template de conversa (sem documento).',
                });
            }
            const mv = montarVariaveisPorSchema(template, p.variaveis);
            if (!mv.ok) {
                return res.status(400).json({ ok: false, error: `Faltam variáveis do template "${template.nome}": ${mv.faltando.join(', ')}`, faltando: mv.faltando });
            }
            nomeTemplate = template.nome;
            idiomaTemplate = template.idioma;
            variaveisPosicionais = mv.variaveis;
        }

        const envio = await enviarTemplateWhatsapp({
            para: p.para, template: nomeTemplate, idioma: idiomaTemplate,
            variaveis: variaveisPosicionais, pdfBase64: null, nomeArquivo: null,
        });
        if (!envio.ok) {
            const status = envio.configuracaoIncompleta ? 503 : envio.indeterminado ? 502 : 422;
            return res.status(status).json({ ok: false, error: envio.erro, acao: envio.acao, indeterminado: Boolean(envio.indeterminado) });
        }

        // A conversa nasce na lista — o balão diz O QUE foi mandado (template +
        // variáveis preenchidas), porque o corpo aprovado mora na Meta.
        const db = getDb();
        const agora = new Date().toISOString();
        const numero = envio.numeroEnviado;
        // ⚠️ usar nomeTemplate/variaveisPosicionais (existem nos DOIS ramos);
        // `template`/`mv` só existem no ramo do cadastro — referenciá-los aqui
        // estourava ReferenceError no caminho templateDireto.
        const resumo = `📋 ${nomeTemplate}: ${variaveisPosicionais.join(' · ')}`.slice(0, 300);
        await db.collection('whatsapp_mensagens').doc(envio.messageId).set({
            conversaId: numero, direcao: 'saida', tipo: 'template',
            texto: resumo, midia: null, timestamp: agora,
            statusEntrega: 'enviado', enviadoPor: req.user?.email || null,
        }, { merge: true });
        const contatoRef = db.collection('whatsapp_contatos').doc(numero);
        const contato = await contatoRef.get();
        await contatoRef.set({
            numero,
            ...(p.nomeContato ? { nomePerfil: String(p.nomeContato).slice(0, 80) } : {}),
            ...(contato.exists ? {} : { origem: 'atendimento', criadoEm: agora, empresaId: null }),
            atualizadoEm: agora,
        }, { merge: true });
        await db.collection('whatsapp_conversas').doc(numero).set({
            numero,
            ultimaMensagem: { resumo, direcao: 'saida', em: agora },
            atualizadoEm: agora,
            // Janela NÃO abre aqui — só a resposta do cliente abre (regra da Meta).
        }, { merge: true });

        // Auditoria compartilhada com o /enviar (mesma coleção).
        try {
            await db.collection('whatsapp_envios').add({
                em: admin.firestore.FieldValue.serverTimestamp(),
                departamento, template: nomeTemplate,
                numeroEnviado: numero, messageId: envio.messageId,
                por: req.user?.email || null, projetoOrigem: 'sp-connect',
                referencia: 'conversa-iniciada', temDocumento: false,
            });
        } catch (e) { console.warn('[whatsapp/iniciar] auditoria falhou:', e.message); }

        return res.json({ ok: true, numero, messageId: envio.messageId });
    } catch (e) {
        console.error('[whatsapp/conversas/iniciar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── RESPONDER (PR 2) — texto livre DENTRO da janela de 24h ────────────────
// A trava da janela é AQUI, antes da rede: fora dela a Meta recusaria
// (131047) e a resposta certa é o template — a tela diz isso. Quem enviou
// fica gravado na mensagem (auditoria de atendimento).
router.post('/conversas/:numero/responder', requireAuth, async (req, res) => {
    try {
        const numero = String(req.params.numero || '').replace(/\D/g, '');
        const texto = String(req.body?.texto ?? '').trim();
        if (!numero) return res.status(400).json({ ok: false, error: 'número inválido' });
        if (!texto) return res.status(400).json({ ok: false, error: 'Escreva a mensagem antes de enviar.' });
        if (texto.length > 4096) return res.status(400).json({ ok: false, error: 'Mensagem longa demais (máx. 4096 caracteres).' });

        const db = getDb();
        const conv = await db.collection('whatsapp_conversas').doc(numero).get();
        const ate = Date.parse(conv.data()?.janela24hAte || '');
        if (!Number.isFinite(ate) || ate <= Date.now()) {
            return res.status(422).json({
                ok: false,
                error: 'A janela de 24h desta conversa está fechada — texto livre não sai.',
                acao: 'Envie por template aprovado (ou aguarde o cliente escrever, o que reabre a janela).',
                janelaFechada: true,
            });
        }

        // GUARDA DE CONDUÇÃO: conversa em condução por OUTRO atendente não
        // recebe resposta de terceiro sem assumir antes — dois departamentos
        // escrevendo ao mesmo tempo é o cliente recebendo duas vozes. Assumir
        // é UM clique (mata-burro com caminho, não parede) e fica auditado.
        const dono = conv.data()?.atribuidoA || null;
        const eu = req.user?.email || null;
        if (dono && dono !== eu) {
            return res.status(409).json({
                ok: false,
                error: `Esta conversa está em condução por ${dono}.`,
                acao: 'Assuma a conversa (🙋) antes de responder — ou combine por nota interna / transfira de fila.',
                emConducaoPor: dono,
            });
        }

        const envio = await enviarTextoLivre({ para: numero, texto });
        if (!envio.ok) {
            const status = envio.configuracaoIncompleta ? 503 : envio.indeterminado ? 502 : 422;
            return res.status(status).json({ ok: false, error: envio.erro, acao: envio.acao, indeterminado: Boolean(envio.indeterminado) });
        }

        const agora = new Date().toISOString();
        const msg = {
            conversaId: numero,
            direcao: 'saida',
            tipo: 'text',
            texto,
            midia: null,
            timestamp: agora,
            statusEntrega: 'enviado',   // o webhook promove pra entregue/lido
            enviadoPor: req.user?.email || null,
        };
        await db.collection('whatsapp_mensagens').doc(envio.messageId).set(msg, { merge: true });
        await db.collection('whatsapp_conversas').doc(numero).set({
            ultimaMensagem: { resumo: texto.slice(0, 140), direcao: 'saida', em: agora },
            atualizadoEm: agora,
            // Responder conversa SEM dono te torna o condutor (auto-assumir):
            // a primeira resposta é exatamente o ato de assumir.
            ...(dono ? {} : { atribuidoA: eu }),
        }, { merge: true });

        return res.json({ ok: true, autoAssumida: !dono, mensagem: { id: envio.messageId, ...msg, erroEntrega: null } });
    } catch (e) {
        console.error('[whatsapp/responder]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Abrir a conversa zera o contador de não lidas — sem isso o selo mente
// pra sempre.
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

// ═══ F3 — CONFIG DO ATENDIMENTO E AÇÕES DE CONVERSA ═════════════════════════

// Config: leitura de qualquer logado (o inbox precisa das filas/menu);
// gravação SÓ admin. O bot NASCE desligado — resolverConfig garante.
router.get('/atendimento-config', requireAuth, async (_req, res) => {
    try {
        const doc = await getDb().collection('whatsapp_config').doc('atendimento').get();
        return res.json({ ok: true, config: resolverConfig(doc.data()), filas: FILAS_ATENDIMENTO });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/atendimento-config', requireAdmin, async (req, res) => {
    try {
        const limpa = resolverConfig(req.body?.config);
        await getDb().collection('whatsapp_config').doc('atendimento').set({
            ...limpa,
            atualizadoEm: new Date().toISOString(),
            atualizadoPor: req.user?.email || null,
        });
        return res.json({ ok: true, config: limpa });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/** Helper das ações: atualiza a conversa e responde o novo estado. */
async function acaoConversa(req, res, patch, extra = {}) {
    const numero = String(req.params.numero || '').replace(/\D/g, '');
    if (!numero) return res.status(400).json({ ok: false, error: 'número inválido' });
    const agora = new Date().toISOString();
    await getDb().collection('whatsapp_conversas').doc(numero).set(
        { ...patch, atualizadoEm: agora }, { merge: true },
    );
    return res.json({ ok: true, numero, ...extra });
}

// Transferir de fila — a transferência entre DEPARTAMENTOS (Paulo, 16/08).
// A conversa de um número é UMA só, então transferir é trocar o DONO:
// (1) a atribuição é LIMPA — a conversa chega SEM dono na fila destino
//     (mantê-la presa no atendente de origem deixaria o destino vendo uma
//     conversa "ocupada" que ninguém de lá pode conduzir);
// (2) fica uma nota AUTOMÁTICA na thread (de onde veio, quem mandou, recado
//     opcional) — transferência sem rastro é a conversa que chega crua e o
//     destino pergunta tudo de novo ao cliente;
// (3) aviso ao CLIENTE é opcional (chave na ⚙️, nasce desligada) e só sai com
//     a janela de 24h aberta — falha no aviso NÃO desfaz a transferência,
//     mas é DITA na resposta.
router.post('/conversas/:numero/fila', requireAuth, async (req, res) => {
    try {
        const numero = String(req.params.numero || '').replace(/\D/g, '');
        const fila = String(req.body?.fila || '').trim().toLowerCase();
        const recado = String(req.body?.recado || '').trim();
        if (!numero) return res.status(400).json({ ok: false, error: 'número inválido' });
        if (!filaValida(fila)) return res.status(400).json({ ok: false, error: `Fila inválida. Válidas: ${FILAS_ATENDIMENTO.map((f) => f.id).join(', ')}` });

        const db = getDb();
        const convRef = db.collection('whatsapp_conversas').doc(numero);
        const conv = await convRef.get();
        const filaDe = conv.data()?.fila || 'recepcao';
        if (filaDe === fila) return res.status(400).json({ ok: false, error: 'A conversa já está nessa fila.' });
        const agora = new Date().toISOString();
        const quem = req.user?.email || null;

        await convRef.set({
            fila,
            atribuidoA: null,            // chega SEM dono na fila destino
            transferidaPor: quem,
            transferidaDe: filaDe,
            transferidaEm: agora,
            atualizadoEm: agora,
        }, { merge: true });

        const rotuloDe = (FILAS_ATENDIMENTO.find((f) => f.id === filaDe) || {}).rotulo || filaDe;
        const rotuloPara = (FILAS_ATENDIMENTO.find((f) => f.id === fila) || {}).rotulo || fila;
        const textoNota = `↪ Transferida de ${rotuloDe} para ${rotuloPara} por ${quem || 'alguém'}${recado ? `\nRecado: ${recado}` : ''}`;
        const notaRef = await db.collection('whatsapp_mensagens').add({
            conversaId: numero, direcao: 'interna', tipo: 'transferencia',
            texto: textoNota, midia: null, timestamp: agora, enviadoPor: quem,
        });

        // Aviso ao cliente: melhor esforço, com o desfecho NOMEADO.
        let avisoCliente = 'desligado';
        try {
            const cfgDoc = await db.collection('whatsapp_config').doc('atendimento').get();
            const cfg = resolverConfig(cfgDoc.data());
            if (cfg.avisarClienteTransferencia) {
                const ate = Date.parse(conv.data()?.janela24hAte || '');
                if (!Number.isFinite(ate) || ate <= Date.now()) {
                    avisoCliente = 'janela-fechada';
                } else {
                    const texto = String(cfg.mensagens.transferencia || '').replace('{fila}', rotuloPara);
                    const envio = await enviarTextoLivre({ para: numero, texto });
                    if (envio.ok) {
                        avisoCliente = 'enviado';
                        await db.collection('whatsapp_mensagens').doc(envio.messageId).set({
                            conversaId: numero, direcao: 'saida', tipo: 'text', texto,
                            midia: null, timestamp: new Date().toISOString(),
                            statusEntrega: 'enviado', enviadoPor: 'bot',
                        }, { merge: true });
                    } else {
                        avisoCliente = 'falhou';
                    }
                }
            }
        } catch (e) {
            console.warn('[whatsapp/fila] aviso ao cliente falhou:', e.message);
            avisoCliente = 'falhou';
        }

        return res.json({
            ok: true, numero, fila, transferidaDe: filaDe, avisoCliente,
            nota: { id: notaRef.id, conversaId: numero, direcao: 'interna', tipo: 'transferencia', texto: textoNota, midia: null, timestamp: agora, statusEntrega: null, erroEntrega: null, enviadoPor: quem },
        });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// Assumir / liberar a conversa (um responsável por vez).
router.post('/conversas/:numero/assumir', requireAuth, async (req, res) => {
    try {
        const liberar = Boolean(req.body?.liberar);
        return acaoConversa(req, res, { atribuidoA: liberar ? null : (req.user?.email || null) });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// Resolver / reabrir.
router.post('/conversas/:numero/situacao', requireAuth, async (req, res) => {
    try {
        const s = String(req.body?.situacao || '').trim();
        if (!['aberta', 'resolvida'].includes(s)) return res.status(400).json({ ok: false, error: 'situação deve ser aberta ou resolvida' });
        return acaoConversa(req, res, { status: s, resolvidaPor: s === 'resolvida' ? (req.user?.email || null) : null });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// Nota interna: vive na thread mas NUNCA sai pro cliente (direcao 'interna').
router.post('/conversas/:numero/nota', requireAuth, async (req, res) => {
    try {
        const numero = String(req.params.numero || '').replace(/\D/g, '');
        const texto = String(req.body?.texto ?? '').trim();
        if (!numero || !texto) return res.status(400).json({ ok: false, error: 'Escreva a nota.' });
        const agora = new Date().toISOString();
        const ref = await getDb().collection('whatsapp_mensagens').add({
            conversaId: numero, direcao: 'interna', tipo: 'nota',
            texto, midia: null, timestamp: agora, enviadoPor: req.user?.email || null,
        });
        return res.json({ ok: true, mensagem: { id: ref.id, conversaId: numero, direcao: 'interna', tipo: 'nota', texto, midia: null, timestamp: agora, statusEntrega: null, erroEntrega: null, enviadoPor: req.user?.email || null } });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// Vincular contato ↔ cliente do cadastro (grava QUEM vinculou — é afirmação).
router.post('/conversas/:numero/vincular', requireAuth, async (req, res) => {
    try {
        const numero = String(req.params.numero || '').replace(/\D/g, '');
        const empresaId = String(req.body?.empresaId || '').trim();
        const empresaNome = String(req.body?.empresaNome || '').trim() || null;
        if (!numero) return res.status(400).json({ ok: false, error: 'número inválido' });
        await getDb().collection('whatsapp_contatos').doc(numero).set({
            numero,
            empresaId: empresaId || null,   // vazio DESVINCULA
            empresaNome: empresaId ? empresaNome : null,
            vinculadoPor: req.user?.email || null,
            vinculadoEm: new Date().toISOString(),
        }, { merge: true });
        return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// Busca de clientes pro vínculo (nome/CNPJ, nas DUAS coleções — CNPJ tem duas
// formas no banco, então a comparação é por dígitos, nunca por igualdade).
router.get('/clientes-busca', requireAuth, async (req, res) => {
    try {
        const q = String(req.query.q || '').trim().toLowerCase();
        if (q.length < 3) return res.json({ ok: true, clientes: [] });
        const qDigitos = q.replace(/\D/g, '');
        const db = getDb();
        const [simples, lucro] = await Promise.all([
            db.collection('simples_empresas').get(),
            db.collection('lucro_empresas').get(),
        ]);
        const clientes = [];
        for (const [snap, origem] of [[simples, 'simples'], [lucro, 'lucro']]) {
            for (const d of snap.docs) {
                const x = d.data();
                if (x._deleted || x._merged_into) continue;
                const nome = String(x.nome || x.razaoSocial || '');
                const cnpj = String(x.cnpj || '').replace(/\D/g, '');
                if (nome.toLowerCase().includes(q) || (qDigitos.length >= 4 && cnpj.includes(qDigitos))) {
                    clientes.push({ id: d.id, nome, cnpj, origem });
                    if (clientes.length >= 10) break;
                }
            }
            if (clientes.length >= 10) break;
        }
        return res.json({ ok: true, clientes });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// ─── ATENDENTES ↔ FILAS (a atribuição que a visibilidade lê) ────────────────
// `users.filasAtendimento` decide quem VÊ o quê no inbox (filasVisiveis).
// Gravação SÓ admin — mesma regra dos departamentos do SaaS (auto-conceder
// 'recepcao' abriria todas as conversas), e as rules têm a anti-autoconcessão.

router.get('/atendentes', requireAdmin, async (_req, res) => {
    try {
        const snap = await getDb().collection('users').limit(500).get();
        const atendentes = snap.docs.map((d) => {
            const x = d.data() || {};
            return {
                uid: d.id,
                email: x.email || null,
                nome: x.displayName || x.nome || null,
                role: x.role || 'colaborador',
                departamentos: Array.isArray(x.departamentos) ? x.departamentos : [],
                filasAtendimento: Array.isArray(x.filasAtendimento) ? x.filasAtendimento : [],
            };
        }).sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')));
        return res.json({ ok: true, atendentes, filas: FILAS_ATENDIMENTO });
    } catch (e) {
        console.error('[whatsapp/atendentes]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/atendentes/:uid/filas', requireAdmin, async (req, res) => {
    try {
        const uid = String(req.params.uid || '').trim();
        if (!uid) return res.status(400).json({ ok: false, error: 'Informe o uid do usuário.' });
        const brutas = Array.isArray(req.body?.filas) ? req.body.filas : null;
        if (!brutas) return res.status(400).json({ ok: false, error: 'Envie filas: [] (lista, vazia limpa a atribuição).' });
        const filas = [...new Set(brutas.map((f) => String(f || '').trim().toLowerCase()).filter(Boolean))];
        // Fila desconhecida é RECUSA, nunca descarte em silêncio (lição da #382).
        const invalidas = filas.filter((f) => !filaValida(f));
        if (invalidas.length) {
            return res.status(400).json({
                ok: false,
                error: `Fila(s) desconhecida(s): ${invalidas.join(', ')}. Válidas: ${FILAS_ATENDIMENTO.map((f) => f.id).join(', ')}.`,
            });
        }
        const ref = getDb().collection('users').doc(uid);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ ok: false, error: `Usuário ${uid} não existe no cadastro.` });
        await ref.set({ filasAtendimento: filas }, { merge: true });
        console.log(`[whatsapp/atendentes] filas de ${uid} → [${filas.join(', ')}] por ${req.user?.email}`);
        return res.json({ ok: true, uid, filas });
    } catch (e) {
        console.error('[whatsapp/atendentes/filas]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── 📥 IMPORTAR BACKUP DA ULTRA FOX (contatos e mensagens) ─────────────────
// NADA é gravado sem preview: confirmar:false devolve a leitura; só
// confirmar:true grava. Contato que JÁ existe NÃO é sobrescrito (backfill não
// sobrescreve, 13/08) e o id determinístico faz reimportar não duplicar.

const LIMITE_MENSAGENS_IMPORT = 20000;

async function gravarContatosImportados(db, contatos) {
    const agora = new Date().toISOString();
    let criados = 0;
    let jaExistiam = 0;
    for (let i = 0; i < contatos.length; i += 300) {
        const fatia = contatos.slice(i, i + 300);
        const refs = fatia.map((c) => db.collection('whatsapp_contatos').doc(c.numero));
        const snaps = await db.getAll(...refs);
        const batch = db.batch();
        snaps.forEach((s, j) => {
            if (s.exists) { jaExistiam += 1; return; }   // NUNCA sobrescreve o que já está lá
            const c = fatia[j];
            batch.set(refs[j], {
                numero: c.numero,
                ...(c.nome ? { nomePerfil: c.nome } : {}),
                ...(c.empresaNome ? { empresaNomeSugerido: c.empresaNome } : {}), // sugestão, não vínculo
                empresaId: null,
                origem: 'ultrafox-import',
                criadoEm: agora,
                atualizadoEm: agora,
            });
            criados += 1;
        });
        await batch.commit();
    }
    return { criados, jaExistiam };
}

async function gravarMensagensImportadas(db, mensagens, quem) {
    const agora = new Date().toISOString();
    let gravadas = 0;
    const porConversa = new Map();
    for (const m of mensagens) {
        const atual = porConversa.get(m.numero);
        if (!atual || m.em > atual.em) porConversa.set(m.numero, m);
    }
    for (let i = 0; i < mensagens.length; i += 400) {
        const batch = db.batch();
        for (const m of mensagens.slice(i, i + 400)) {
            batch.set(db.collection('whatsapp_mensagens').doc(idMensagemImportada(m)), {
                conversaId: m.numero, direcao: m.direcao, tipo: 'text',
                texto: m.texto, midia: null, timestamp: m.em,
                statusEntrega: null, origem: 'ultrafox-import',
                ...(m.autor ? { autorImportado: m.autor } : {}),
                importadoPor: quem, importadoEm: agora,
            }, { merge: true });
            gravadas += 1;
        }
        await batch.commit();
    }
    // Conversa/contato nascem se faltarem; conversa EXISTENTE não é tocada —
    // histórico importado não sobrescreve o presente (nem a janela de 24h).
    for (const [numero, ultima] of porConversa) {
        const convRef = db.collection('whatsapp_conversas').doc(numero);
        const conv = await convRef.get();
        if (!conv.exists) {
            await convRef.set({
                numero, fila: null, naoLidas: 0, status: 'aberta', janela24hAte: null,
                ultimaMensagem: { resumo: String(ultima.texto || '').slice(0, 140), direcao: ultima.direcao, em: ultima.em },
                atualizadoEm: ultima.em,
            });
        }
        const contRef = db.collection('whatsapp_contatos').doc(numero);
        const cont = await contRef.get();
        if (!cont.exists) {
            await contRef.set({ numero, empresaId: null, origem: 'ultrafox-import', criadoEm: agora, atualizadoEm: agora });
        }
    }
    return { gravadas, conversas: porConversa.size };
}

router.post('/importar-ultrafox', requireAdmin, async (req, res) => {
    try {
        const p = req.body || {};
        const tipo = String(p.tipo || '').trim();
        const conteudo = String(p.conteudo || '');
        const confirmar = Boolean(p.confirmar);
        if (!conteudo.trim()) return res.status(400).json({ ok: false, error: 'Cole ou envie o conteúdo do arquivo exportado.' });

        if (tipo === 'contatos') {
            const r = interpretarContatosCsv(conteudo);
            if (!confirmar) {
                return res.json({
                    ok: true, preview: true, tipo,
                    total: r.contatos.length, amostra: r.contatos.slice(0, 10),
                    descartados: r.descartados.slice(0, 20), totalDescartados: r.descartados.length,
                    avisos: r.avisos,
                });
            }
            if (!r.contatos.length) return res.status(422).json({ ok: false, error: 'Nenhum contato legível — nada foi gravado.', avisos: r.avisos });
            const g = await gravarContatosImportados(getDb(), r.contatos);
            return res.json({ ok: true, tipo, ...g, totalDescartados: r.descartados.length, avisos: r.avisos });
        }

        if (tipo === 'mensagens-txt') {
            const numero = normalizarNumeroBr(p.numero || '');
            const r = interpretarConversaTxt(conteudo);
            if (!confirmar) {
                return res.json({
                    ok: true, preview: true, tipo,
                    total: r.mensagens.length, autores: r.autores,
                    amostra: r.mensagens.slice(0, 6),
                    descartadas: r.descartadas.slice(0, 10), totalDescartadas: r.descartadas.length,
                    ...(numero ? {} : { avisos: ['Informe o NÚMERO do contato desta conversa antes de confirmar.'] }),
                });
            }
            if (!numero) return res.status(400).json({ ok: false, error: 'Informe o número do WhatsApp do contato desta conversa.' });
            const autoresEscritorio = Array.isArray(p.autoresEscritorio) ? p.autoresEscritorio : [];
            if (!autoresEscritorio.length) {
                return res.status(400).json({ ok: false, error: 'Marque qual(is) autor(es) são do ESCRITÓRIO — a direção das mensagens não se adivinha.' });
            }
            const docs = prepararMensagensDoTxt({ mensagens: r.mensagens, numero, autoresEscritorio });
            if (!docs.length) return res.status(422).json({ ok: false, error: 'Nenhuma mensagem legível — nada foi gravado.' });
            if (docs.length > LIMITE_MENSAGENS_IMPORT) {
                return res.status(422).json({ ok: false, error: `Arquivo com ${docs.length} mensagens — o limite por importação é ${LIMITE_MENSAGENS_IMPORT}. Divida o export.` });
            }
            const g = await gravarMensagensImportadas(getDb(), docs, req.user?.email || null);
            return res.json({ ok: true, tipo, ...g, totalDescartadas: r.descartadas.length });
        }

        if (tipo === 'mensagens-csv') {
            const r = interpretarMensagensCsv(conteudo);
            if (!confirmar) {
                return res.json({
                    ok: true, preview: true, tipo,
                    total: r.mensagens.length, amostra: r.mensagens.slice(0, 6),
                    descartadas: r.descartadas.slice(0, 10), totalDescartadas: r.descartadas.length,
                    avisos: r.avisos,
                });
            }
            if (!r.mensagens.length) return res.status(422).json({ ok: false, error: 'Nenhuma mensagem legível — nada foi gravado.', avisos: r.avisos });
            if (r.mensagens.length > LIMITE_MENSAGENS_IMPORT) {
                return res.status(422).json({ ok: false, error: `Arquivo com ${r.mensagens.length} mensagens — o limite por importação é ${LIMITE_MENSAGENS_IMPORT}. Divida o export.` });
            }
            const g = await gravarMensagensImportadas(getDb(), r.mensagens, req.user?.email || null);
            return res.json({ ok: true, tipo, ...g, totalDescartadas: r.descartadas.length, avisos: r.avisos });
        }

        return res.status(400).json({ ok: false, error: 'tipo deve ser contatos, mensagens-txt ou mensagens-csv.' });
    } catch (e) {
        console.error('[whatsapp/importar-ultrafox]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
