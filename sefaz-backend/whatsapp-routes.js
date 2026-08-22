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
import { Storage } from '@google-cloud/storage';
import { requireAdmin, requireAuth } from './require-admin.js';
import { crossProjectAuth, PROJETO } from './require-cross-project-auth.js';
import {
    validarTemplate, resolverTemplate, montarVariaveisPorSchema,
    DEPARTAMENTOS_WHATSAPP, validarNovoTemplateMeta,
} from './whatsapp-templates.js';
import {
    enviarTemplateWhatsapp, configWhatsapp, listarTemplatesAprovados, criarTemplateNaMeta, numeroCanonicoWhatsapp,
    listarAppsAssinadosNaWaba, assinarWaba, enviarTextoLivre, normalizarNumeroBr,
    subirMidiaWhatsapp, enviarMidiaWhatsapp, GRAPH_BASE, enviarContatoWhatsapp,
} from './whatsapp-cloud.js';
import {
    CANDIDATOS_SONDA, ANTES_DE_LIGAR, interpretarSondaChamadas, concluirSonda,
} from './whatsapp-chamadas.js';
import {
    BASES_LEGAIS, CORES_ETIQUETA, validarEtiqueta, montarCatalogoEtiquetas,
    validarEtiquetasDoContato, pendenciasLgpdDoContato, filtrarContatos,
} from './whatsapp-etiquetas.js';
import {
    montarRelatorioTitular, planoDeEliminacao, registroDaSolicitacao,
} from './lgpd-titular.js';
import { validarAnexo, legendaSeraIgnorada, resumoDoAnexo } from './whatsapp-midia.js';
import { registrarMudancaPermissao } from './auditoria-permissoes.js';
import { montarCatalogoCanais, credenciaisDoCanal, validarCanal } from './whatsapp-canais.js';
import { arquivarMidiasWhatsappNoSharePoint } from './whatsapp-sharepoint-arquivo.js';
import { montarRelatorioAtendimento } from './whatsapp-relatorio.js';
import { registrarToken } from './whatsapp-push.js';
import { COLECAO_TOKENS } from './whatsapp-push-envio.js';
import {
    FILAS_ATENDIMENTO, filaValida, filasVisiveis, conversaVisivel,
    resolverConfig, papelValido, podeEncerrar,
} from './whatsapp-atendimento.js';
import {
    interpretarContatosCsv, interpretarConversaTxt, interpretarMensagensCsv,
    prepararMensagensDoTxt, idMensagemImportada,
} from './whatsapp-import-ultrafox.js';
import { detectarAnexo, PASTA_MIDIA } from './whatsapp-import-lote.js';
import { CANDIDATOS_SONDA as CANDIDATOS_SONDA_IG, interpretarSondaInstagram, concluirSondaInstagram, SOBRE_RESTRINGIR_ATENDENTES } from './instagram-sonda.js';
import { configWebhook, faltasDaConfigWebhook } from './whatsapp-webhook.js';
import {
    idConversaDoParam, ehConversaInstagram, enviarTextoInstagram, ligarRecebimentoInstagram,
} from './instagram-dm.js';

const router = Router();
const COLECAO = 'whatsapp_templates';
// Mesmo bucket do webhook (que baixa a mídia recebida) — segunda régua de
// caminho divergiria e o anexo sumiria de um dos lados.
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'consultorfiscalapp';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const storage = new Storage();

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

// 📝 Criar template NOVO na Meta (Paulo, 21/08: cadastro pelo nosso app).
// Validação de forma ANTES da rede (recusa da Meta custa a fila de aprovação
// de novo); o status volta como a Meta respondeu — normalmente PENDING, e o
// aprovado aparece sozinho na lista de cima quando a Meta liberar.
router.post('/templates-meta', requireAdmin, async (req, res) => {
    try {
        const v = validarNovoTemplateMeta(req.body || {});
        if (!v.ok) return res.status(400).json({ ok: false, error: 'Template inválido', detalhes: v.erros });
        const r = await criarTemplateNaMeta(v.template);
        if (!r.ok) return res.status(502).json({ ok: false, error: r.erro, detalheMeta: r.detalheMeta || null });
        return res.json({ ok: true, id: r.id, status: r.status, categoria: r.categoria, variaveis: v.variaveis });
    } catch (e) {
        console.error('[whatsapp/templates-meta:criar]', e);
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

// Perfil de atendimento do usuário logado: filas que enxerga (null = todas)
// e o PAPEL (admin/gestor/colaborador). O escopo é do BACKEND — o front
// nunca é o filtro de dados (regra da Carteira).
async function perfilAtendimento(db, user) {
    if (user?.role === 'admin') return { filas: null, papel: 'admin', papelAtendimento: null };
    let departamentos = []; let filasAtendimento = []; let papelAtendimento = null;
    try {
        const u = await db.collection('users').doc(user.uid).get();
        departamentos = u.data()?.departamentos || [];
        filasAtendimento = u.data()?.filasAtendimento || [];
        papelAtendimento = u.data()?.papelAtendimento || null;
    } catch { /* sem doc = só Recepção */ }
    const papel = String(papelAtendimento || '').toLowerCase() === 'gestor' ? 'gestor' : 'colaborador';
    return {
        filas: filasVisiveis({ role: user?.role, papelAtendimento, departamentos, filasAtendimento }),
        papel,
        papelAtendimento,
    };
}

// Uma leitura, todas as conversas + o contato de cada uma (getAll em lote —
// nada de N consultas).
// 🚨 O teto de 100 mordeu no PRIMEIRO teste real (Paulo, 21/08, com várias
// pessoas logadas: o chip dizia "Todas · 100" — número redondo é teto, não
// carteira). Conversa mais antiga que a centésima sumia da lista CALADA,
// mesmo aberta e não lida — a mesma classe do limit(2000) dos contatos.
// Virou leitura paginada com teto ALTO e NOMEADO: se um dia bater, a
// resposta diz (`limiteLeitura`), nunca esconde.
const PAGINA_CONVERSAS = 500;
const TETO_LEITURA_CONVERSAS = 2000;

router.get('/conversas', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const { filas: minhasFilas, papel } = await perfilAtendimento(db, req.user);
        // ⚡ As respostas rápidas vão de CARONA: o composer precisa delas o
        // tempo todo e esta é a rota que todo atendente já lê a cada 30s —
        // uma leitura a mais aqui evita uma rota nova + um fetch por tela.
        const cfgDoc = await db.collection('whatsapp_config').doc('atendimento').get()
            .catch(() => ({ data: () => null }));
        const respostasRapidas = resolverConfig(cfgDoc.data()).respostasRapidas;
        let docsConversas = [];
        let cursorConv = null;
        while (docsConversas.length < TETO_LEITURA_CONVERSAS) {
            let q = db.collection('whatsapp_conversas')
                .orderBy('atualizadoEm', 'desc').limit(PAGINA_CONVERSAS);
            if (cursorConv) q = q.startAfter(cursorConv);
            // eslint-disable-next-line no-await-in-loop
            const pagina = await q.get();
            if (pagina.empty) break;
            docsConversas = docsConversas.concat(pagina.docs);
            cursorConv = pagina.docs[pagina.docs.length - 1];
            if (pagina.docs.length < PAGINA_CONVERSAS) break;
        }
        const numeros = docsConversas.map((d) => d.id);
        const contatos = new Map();
        // getAll em fatias: uma chamada com 2000 refs é pedir recusa do RPC.
        for (let i = 0; i < numeros.length; i += 300) {
            const refs = numeros.slice(i, i + 300).map((n) => db.collection('whatsapp_contatos').doc(n));
            // eslint-disable-next-line no-await-in-loop
            (await db.getAll(...refs)).forEach((c) => { if (c.exists) contatos.set(c.id, c.data()); });
        }
        const conversas = docsConversas.map((d) => {
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
                canalId: x.canalId || null,               // por qual número do escritório entrou
                canal: x.canal || 'whatsapp',             // 'instagram' = DM (selo 📷 na tela)
                situacao: x.status || 'aberta',
                janela24hAte: x.janela24hAte || null,
                ultimaMensagem: x.ultimaMensagem || null,
                naoLidas: x.naoLidas || 0,
                atualizadoEm: x.atualizadoEm || null,
            };
        }).filter((cv) => conversaVisivel(minhasFilas, cv.fila));
        return res.json({
            ok: true, conversas, filas: FILAS_ATENDIMENTO, minhasFilas, papel, respostasRapidas,
            limiteLeitura: docsConversas.length >= TETO_LEITURA_CONVERSAS ? TETO_LEITURA_CONVERSAS : null,
        });
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
        const numero = idConversaDoParam(req.params.numero);
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
                    // Link direto (banner de fila; anexo de DM do Instagram,
                    // que vem por URL da CDN da Meta e não passa pelo Storage).
                    link: x.midia.link || null,
                } : null,
                timestamp: x.timestamp || x.recebidoEm || null,
                statusEntrega: x.statusEntrega || null,
                erroEntrega: x.erroEntrega || null,
                // Anexo que ficou no backup do SharePoint (importação). Campo
                // novo entra na lista de saída no MESMO PR — fora dela ele é
                // descartado em silêncio e a thread nunca diria que houve
                // arquivo (a lição da whitelist do #382).
                anexoNoBackup: x.anexoNoBackup || null,
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
// O modal de envio dos apps irmãos usa esta mesma porta. `autorizar` mantém a
// validação forte: token Firebase assinado, projeto explicitamente permitido,
// e-mail verificado e domínio do escritório. As demais rotas do inbox seguem
// exclusivas do CFI, pois o irmão só inicia a conversa — não lê o atendimento.
router.post('/conversas/iniciar', autorizar, async (req, res) => {
    try {
        const p = req.body || {};
        const departamento = String(p.departamento || '').trim().toLowerCase();
        // Quem inicia a conversa é uma FILA de atendimento (as 8 — Recepção,
        // RH e Jurídico incluídos), não só os 5 apps do SaaS: DEPARTAMENTOS_
        // WHATSAPP é o escopo do CADASTRO de template (esse sim só os 5
        // módulos, decisão de 10/08), mas o template APROVADO NA META (ramo
        // templateDireto, abaixo) não depende de cadastro nenhum — recusar
        // aqui é o que fazia a Recepção nunca conseguir abrir uma conversa
        // (Paulo, 21/08).
        if (!filaValida(departamento)) {
            return res.status(400).json({ ok: false, error: `Departamento (fila) inválido — use ${FILAS_ATENDIMENTO.map((f) => f.id).join(', ')}.` });
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
            // A fila é de quem INICIOU — sem isso a conversa nascia sem dono
            // e caía no default da Recepção (cx.fila || 'recepcao'), mesmo
            // quando foi o Fiscal ou a Contábil quem mandou o template.
            fila: departamento,
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
                por: req.user?.email || null,
                projetoOrigem: req.user?.projectId || (req._ehAdmin ? 'cfi' : 'sp-connect'),
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
        const numero = idConversaDoParam(req.params.numero);
        const texto = String(req.body?.texto ?? '').trim();
        if (!numero) return res.status(400).json({ ok: false, error: 'número inválido' });
        if (!texto) return res.status(400).json({ ok: false, error: 'Escreva a mensagem antes de enviar.' });
        if (texto.length > 4096) return res.status(400).json({ ok: false, error: 'Mensagem longa demais (máx. 4096 caracteres).' });

        const db = getDb();
        const conv = await db.collection('whatsapp_conversas').doc(numero).get();
        const ehIg = ehConversaInstagram(numero) || conv.data()?.canal === 'instagram';
        const ate = Date.parse(conv.data()?.janela24hAte || '');
        if (!Number.isFinite(ate) || ate <= Date.now()) {
            return res.status(422).json({
                ok: false,
                error: 'A janela de 24h desta conversa está fechada — texto livre não sai.',
                // No Instagram NÃO existe template aprovado como saída — fora
                // da janela só resta esperar o cliente escrever de novo.
                acao: ehIg
                    ? 'No Instagram não há template: aguarde o cliente escrever de novo (isso reabre a janela).'
                    : 'Envie por template aprovado (ou aguarde o cliente escrever, o que reabre a janela).',
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

        // 📷 DM do Instagram sai pela Graph da PÁGINA; WhatsApp, pela WABA.
        // O resto do fluxo (gravação, auto-assumir, thread) é o MESMO.
        const envio = ehIg
            ? await enviarTextoInstagram({ para: numero, texto })
            : await enviarTextoLivre({ para: numero, texto });
        if (!envio.ok) {
            if (ehIg && envio.janelaFechada) {
                return res.status(422).json({
                    ok: false, error: 'A Meta recusou: a janela de resposta do Instagram fechou.',
                    acao: 'Aguarde o cliente escrever de novo — no Instagram não há template.',
                    janelaFechada: true,
                });
            }
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
            ...(ehIg ? { canal: 'instagram' } : {}),
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
        const numero = idConversaDoParam(req.params.numero);
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

// 🖼️ Imagem por fila (20/08, olhando a Ultra Fox): a admin sobe a arte do
// departamento UMA vez; ela fica no Storage e é servida por uma rota PÚBLICA
// (`GET /api/whatsapp/publico/imagem-fila/:fila`, em whatsapp-webhook-routes)
// — é preciso que a META alcance a URL sem token nenhum. O que o app grava é
// SÓ o link (banner de departamento, sem dado de cliente); nada aqui muda a
// leitura/gravação de anexo de conversa, que continua com mediaId e cofre
// gated por fila.
router.post('/atendimento-config/imagem-fila', requireAdmin, async (req, res) => {
    try {
        const fila = String(req.body?.fila || '').trim().toLowerCase();
        if (!filaValida(fila)) return res.status(400).json({ ok: false, error: `Fila inválida. Válidas: ${FILAS_ATENDIMENTO.map((f) => f.id).join(', ')}` });
        const base64 = String(req.body?.base64 || '');
        if (!base64) return res.status(400).json({ ok: false, error: 'Escolha a imagem antes de enviar.' });
        const mime = req.body?.mime;
        const tamanhoBytes = Buffer.byteLength(base64, 'base64');
        const v = validarAnexo({ mime, tamanhoBytes, nomeArquivo: `banner-${fila}` });
        if (!v.ok) return res.status(422).json({ ok: false, error: v.erro, acao: v.acao });
        if (v.tipo !== 'image') return res.status(422).json({ ok: false, error: `Isso não é uma imagem (${mime || 'tipo desconhecido'}).`, acao: 'Envie JPG, PNG ou WEBP.' });

        // Caminho DETERMINÍSTICO por fila — subir de novo SUBSTITUI o banner
        // anterior daquela fila, não empilha arquivo velho no bucket.
        const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[String(mime).split(';')[0].trim().toLowerCase()] || 'jpg';
        const caminho = `whatsapp/config/imagem-fila/${fila}.${ext}`;
        await storage.bucket(STORAGE_BUCKET).file(caminho).save(Buffer.from(base64, 'base64'), {
            contentType: mime || 'application/octet-stream', resumable: false,
        });

        // A URL é do NOSSO app (rota pública própria), não do bucket direto —
        // não depende de o bucket aceitar objeto público (política do GCP
        // costuma bloquear isso), e o app controla o que serve.
        const url = `${req.protocol}://${req.get('host')}/api/whatsapp/publico/imagem-fila/${fila}`;

        const db = getDb();
        const cfgDoc = await db.collection('whatsapp_config').doc('atendimento').get();
        const atual = resolverConfig(cfgDoc.data());
        const limpa = resolverConfig({ ...atual, imagensPorFila: { ...atual.imagensPorFila, [fila]: url } });
        await db.collection('whatsapp_config').doc('atendimento').set({
            ...limpa, atualizadoEm: new Date().toISOString(), atualizadoPor: req.user?.email || null,
        });
        return res.json({ ok: true, config: limpa, url });
    } catch (e) {
        console.error('[whatsapp/atendimento-config/imagem-fila]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Tirar a imagem de uma fila (volta a mandar só texto).
router.delete('/atendimento-config/imagem-fila/:fila', requireAdmin, async (req, res) => {
    try {
        const fila = String(req.params.fila || '').trim().toLowerCase();
        if (!filaValida(fila)) return res.status(400).json({ ok: false, error: 'fila inválida' });
        const db = getDb();
        const cfgDoc = await db.collection('whatsapp_config').doc('atendimento').get();
        const atual = resolverConfig(cfgDoc.data());
        const semEla = { ...atual.imagensPorFila };
        delete semEla[fila];
        const limpa = resolverConfig({ ...atual, imagensPorFila: semEla });
        await db.collection('whatsapp_config').doc('atendimento').set({
            ...limpa, atualizadoEm: new Date().toISOString(), atualizadoPor: req.user?.email || null,
        });
        return res.json({ ok: true, config: limpa });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/** Helper das ações: atualiza a conversa e responde o novo estado. */
// idConversaDoParam em vez do replace(/\D/g,'') cru: o id do Instagram
// (ig_178…) passa INTEIRO — o replace o transformaria em número de telefone
// e a ação cairia na conversa errada.
async function acaoConversa(req, res, patch, extra = {}) {
    const numero = idConversaDoParam(req.params.numero);
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
        const numero = idConversaDoParam(req.params.numero);
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

        // Aviso ao cliente: melhor esforço, com o desfecho NOMEADO. No
        // Instagram ele fica de fora (o texto sairia pela API da Página e a
        // frase fala de "atendimento no WhatsApp") — a transferência em si
        // funciona igual, e o desfecho diz o porquê em vez de sumir calado.
        let avisoCliente = 'desligado';
        const ehIgFila = ehConversaInstagram(numero) || conv.data()?.canal === 'instagram';
        if (ehIgFila) avisoCliente = 'indisponivel-no-instagram';
        try {
            const cfgDoc = await db.collection('whatsapp_config').doc('atendimento').get();
            const cfg = resolverConfig(cfgDoc.data());
            if (cfg.avisarClienteTransferencia && !ehIgFila) {
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

// Encerrar / reabrir o atendimento. QUEM PODE (Paulo, 16/08): admin e gestor,
// qualquer atendimento; colaborador, SÓ o que ele conduz (encerrar o próprio
// atendimento é parte do atendimento; encerrar o dos outros é gestão). O
// cliente encerra pelo #sair (bot). Encerrando com a pesquisa LIGADA e a
// janela de 24h aberta, a nota 1-5 é pedida ao cliente — o desfecho do
// convite vai NOMEADO na resposta (enviada · janela-fechada · desligada).
router.post('/conversas/:numero/situacao', requireAuth, async (req, res) => {
    try {
        const numero = idConversaDoParam(req.params.numero);
        const s = String(req.body?.situacao || '').trim();
        if (!numero) return res.status(400).json({ ok: false, error: 'número inválido' });
        if (!['aberta', 'resolvida'].includes(s)) return res.status(400).json({ ok: false, error: 'situação deve ser aberta ou resolvida' });

        const db = getDb();
        const convRef = db.collection('whatsapp_conversas').doc(numero);
        const conv = (await convRef.get()).data() || {};
        const { papelAtendimento } = await perfilAtendimento(db, req.user);
        const eu = req.user?.email || null;
        if (!podeEncerrar({ role: req.user?.role, papelAtendimento, email: eu, atribuidoA: conv.atribuidoA || null })) {
            return res.status(403).json({
                ok: false,
                error: conv.atribuidoA
                    ? `Este atendimento está em condução por ${conv.atribuidoA} — só quem conduz (ou gestor/admin) encerra ou reabre.`
                    : 'Este atendimento está sem condutor — assuma-o (🙋) antes de encerrar, ou peça a um gestor/admin.',
                acao: 'Assuma a conversa, ou peça a um gestor.',
            });
        }

        const agora = new Date().toISOString();
        await convRef.set({
            status: s,
            resolvidaPor: s === 'resolvida' ? eu : null,
            ...(s === 'aberta' ? { aguardandoAvaliacao: false } : {}),
            atualizadoEm: agora,
        }, { merge: true });

        // Pesquisa de satisfação no encerramento (chave nasce desligada).
        // No Instagram a pesquisa fica de FORA (a nota 1-5 é lida pelo
        // webhook do WhatsApp; no IG a resposta cairia como DM comum e a nota
        // nunca seria capturada — pedir e não ouvir é pior que não pedir).
        let avaliacao = 'desligada';
        const ehIgSit = ehConversaInstagram(numero) || conv.canal === 'instagram';
        if (ehIgSit && s === 'resolvida') avaliacao = 'indisponivel-no-instagram';
        if (s === 'resolvida' && !ehIgSit) {
            try {
                const cfgDoc = await db.collection('whatsapp_config').doc('atendimento').get();
                const cfg = resolverConfig(cfgDoc.data());
                if (cfg.avaliacaoAtiva) {
                    const ate = Date.parse(conv.janela24hAte || '');
                    if (!Number.isFinite(ate) || ate <= Date.now()) {
                        avaliacao = 'janela-fechada';
                    } else {
                        const envio = await enviarTextoLivre({ para: numero, texto: cfg.mensagens.avaliacao });
                        if (envio.ok) {
                            avaliacao = 'enviada';
                            await convRef.set({ aguardandoAvaliacao: true }, { merge: true });
                            await db.collection('whatsapp_mensagens').doc(envio.messageId).set({
                                conversaId: numero, direcao: 'saida', tipo: 'text',
                                texto: cfg.mensagens.avaliacao, midia: null, timestamp: new Date().toISOString(),
                                statusEntrega: 'enviado', enviadoPor: 'bot',
                            }, { merge: true });
                        } else {
                            avaliacao = 'falhou';
                        }
                    }
                }
            } catch (e) {
                console.warn('[whatsapp/situacao] pesquisa não saiu:', e.message);
                avaliacao = 'falhou';
            }
        }

        return res.json({ ok: true, numero, situacao: s, avaliacao });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// Nota interna: vive na thread mas NUNCA sai pro cliente (direcao 'interna').
router.post('/conversas/:numero/nota', requireAuth, async (req, res) => {
    try {
        const numero = idConversaDoParam(req.params.numero);
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
        const numero = idConversaDoParam(req.params.numero);
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

// ═══ 📇 CONTATOS ═══════════════════════════════════════════════════════════
// Paulo, 17/08: *"também não vejo o menu de contatos, esse é essencial para
// importação do backup Ultra Fox, adicionar novos contatos, compartilhar
// novos contatos"*. Ele está certo, e o defeito era da família de sempre:
// `whatsapp_contatos` era GRAVADO por quatro caminhos (webhook, importador,
// template, vínculo) e LIDO por nenhuma tela. Importar 800 contatos os
// deixava invisíveis até alguém escrever pro número.

// 🚨 O teto de 2000 (leitura de UM `.get()` só) foi ultrapassado em produção
// (Paulo, 20/08 — a carteira de contatos passou de 2000 depois do backup da
// Ultra Fox + uso normal, e a tela avisava "há mais no banco" mas os contatos
// além do teto ficavam INVISÍVEIS pra busca/etiqueta, não só cortados da
// exibição). Virou PAGINAÇÃO de verdade (cursor por documentId, que a
// coleção já tem por natureza — o número é o id) até um teto de SEGURANÇA
// bem acima de qualquer carteira real, não mais um teto pensado pro volume
// de um dia.
const PAGINA_CONTATOS = 1000;
const TETO_LEITURA_CONTATOS = 50000;

async function lerTodosContatos(db) {
    const colecao = db.collection('whatsapp_contatos');
    let cursor = null;
    let docs = [];
    while (docs.length < TETO_LEITURA_CONTATOS) {
        let q = colecao.orderBy(admin.firestore.FieldPath.documentId()).limit(PAGINA_CONTATOS);
        if (cursor) q = q.startAfter(cursor);
        // eslint-disable-next-line no-await-in-loop
        const pagina = await q.get();
        if (pagina.empty) break;
        docs = docs.concat(pagina.docs);
        cursor = pagina.docs[pagina.docs.length - 1];
        if (pagina.docs.length < PAGINA_CONTATOS) break; // última página
    }
    return docs;
}

async function lerCatalogoEtiquetas(db) {
    const snap = await db.collection('whatsapp_etiquetas').limit(200).get();
    return montarCatalogoEtiquetas(snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
}

router.get('/etiquetas', requireAuth, async (_req, res) => {
    try {
        return res.json({ ok: true, etiquetas: await lerCatalogoEtiquetas(getDb()), basesLegais: BASES_LEGAIS, cores: CORES_ETIQUETA });
    } catch (e) {
        console.error('[whatsapp/etiquetas]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Cadastro de etiqueta é ADMIN: ela declara a FINALIDADE de um tratamento de
// dado pessoal, e isso não é escolha de quem opera a conversa.
router.post('/etiquetas', requireAdmin, async (req, res) => {
    try {
        const v = validarEtiqueta(req.body || {});
        if (!v.ok) return res.status(400).json({ ok: false, error: v.erro });
        const agora = new Date().toISOString();
        await getDb().collection('whatsapp_etiquetas').doc(v.etiqueta.id).set({
            ...v.etiqueta, atualizadoEm: agora, atualizadoPor: req.user?.email || null,
        }, { merge: true });
        return res.json({ ok: true, etiquetas: await lerCatalogoEtiquetas(getDb()) });
    } catch (e) {
        console.error('[whatsapp/etiquetas/post]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/contatos', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const [docsContatos, catalogo] = await Promise.all([
            lerTodosContatos(db),
            lerCatalogoEtiquetas(db),
        ]);
        const todos = docsContatos.map((d) => {
            const c = d.data() || {};
            return {
                numero: d.id,
                nomePerfil: c.nomePerfil || null,
                empresaId: c.empresaId || null,
                empresaNome: c.empresaNome || null,
                empresaNomeSugerido: c.empresaNomeSugerido || null,
                etiquetas: Array.isArray(c.etiquetas) ? c.etiquetas : [],
                consentimentos: c.consentimentos || {},
                origem: c.origem || null,
                criadoEm: c.criadoEm || null,
                atualizadoEm: c.atualizadoEm || null,
                observacao: c.observacao || null,
            };
        });
        const filtrados = filtrarContatos(todos, {
            busca: req.query.busca || '',
            etiqueta: req.query.etiqueta || '',
            semEtiqueta: String(req.query.semEtiqueta || '') === 'true',
        });
        // Pendência de LGPD vai JUNTO da lista: separada numa aba de auditoria,
        // ninguém abre — e ela é sobre a pessoa que está na linha.
        const comPendencia = filtrados.map((c) => ({ ...c, pendenciasLgpd: pendenciasLgpdDoContato(c, catalogo) }));
        // Contagem por etiqueta sai do conjunto INTEIRO, não do filtrado: é ela
        // que diz o tamanho de cada grupo (número do filtro seria circular).
        const porEtiqueta = {};
        todos.forEach((c) => (c.etiquetas || []).forEach((e) => { porEtiqueta[e] = (porEtiqueta[e] || 0) + 1; }));
        return res.json({
            ok: true,
            contatos: comPendencia.slice(0, 500),
            total: todos.length,
            totalFiltrado: filtrados.length,
            // Lista cortada SEMPRE diz que foi cortada (farol honesto vale pra contagem).
            truncado: filtrados.length > 500,
            // E o teto da leitura também: contagem por etiqueta sobre uma leitura
            // truncada mentiria para baixo, calada. Agora só truncado no TETO de
            // segurança (50000) — bem acima de qualquer carteira real de hoje.
            limiteLeitura: docsContatos.length >= TETO_LEITURA_CONTATOS ? TETO_LEITURA_CONTATOS : null,
            semEtiquetaTotal: todos.filter((c) => !(c.etiquetas || []).length).length,
            porEtiqueta, etiquetas: catalogo,
        });
    } catch (e) {
        console.error('[whatsapp/contatos]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Novo contato à mão. NÃO sobrescreve quem já existe — devolve o que está lá,
// com a causa ("já existe" sem estado é beco, 14/08).
router.post('/contatos', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const numero = normalizarNumeroBr(req.body?.numero || '');
        if (!numero || numero.length < 12) {
            return res.status(400).json({ ok: false, error: 'Informe o número com DDD (ex.: 11 99999-0000).' });
        }
        const nome = String(req.body?.nome || '').trim().slice(0, 80);
        const catalogo = await lerCatalogoEtiquetas(db);
        const v = validarEtiquetasDoContato(req.body?.etiquetas, catalogo);
        if (!v.ok) return res.status(400).json({ ok: false, error: v.erro });

        const ref = db.collection('whatsapp_contatos').doc(numero);
        const atual = await ref.get();
        if (atual.exists) {
            const d = atual.data() || {};
            return res.status(409).json({
                ok: false,
                error: `Este número já está cadastrado${d.nomePerfil ? ` como "${d.nomePerfil}"` : ''}${(d.etiquetas || []).length ? ` · etiquetas: ${d.etiquetas.join(', ')}` : ''}.`,
                acao: 'Abra o contato na lista para editar — nada foi sobrescrito.',
                jaExiste: true, numero,
            });
        }
        const agora = new Date().toISOString();
        await ref.set({
            numero, ...(nome ? { nomePerfil: nome } : {}),
            etiquetas: v.etiquetas, empresaId: null,
            origem: 'cadastro', criadoPor: req.user?.email || null,
            criadoEm: agora, atualizadoEm: agora,
        });
        return res.json({ ok: true, numero });
    } catch (e) {
        console.error('[whatsapp/contatos/post]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Etiquetar. Grava QUEM etiquetou: classificar uma pessoa é ato com autor.
router.patch('/contatos/:numero', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const numero = String(req.params.numero || '').replace(/\D/g, '');
        if (!numero) return res.status(400).json({ ok: false, error: 'número inválido' });
        const ref = db.collection('whatsapp_contatos').doc(numero);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ ok: false, error: 'Contato não encontrado.' });

        const catalogo = await lerCatalogoEtiquetas(db);
        const patch = { atualizadoEm: new Date().toISOString() };

        if (req.body?.etiquetas !== undefined) {
            const v = validarEtiquetasDoContato(req.body.etiquetas, catalogo);
            if (!v.ok) return res.status(400).json({ ok: false, error: v.erro });
            patch.etiquetas = v.etiquetas;
            patch.etiquetadoPor = req.user?.email || null;
            patch.etiquetadoEm = patch.atualizadoEm;
        }
        if (req.body?.nome !== undefined) patch.nomePerfil = String(req.body.nome).trim().slice(0, 80) || null;
        if (req.body?.observacao !== undefined) patch.observacao = String(req.body.observacao).trim().slice(0, 500) || null;

        // Consentimento: registra COMO e QUANDO. "Consentimento" sem forma
        // registrada não prova nada se um dia a ANPD perguntar.
        if (req.body?.consentimento) {
            const { etiqueta, como, revogar } = req.body.consentimento;
            const id = String(etiqueta || '').trim();
            if (!catalogo.some((e) => e.id === id)) {
                return res.status(400).json({ ok: false, error: `Etiqueta "${id}" não existe no catálogo.` });
            }
            const atualCons = (snap.data() || {}).consentimentos || {};
            patch.consentimentos = {
                ...atualCons,
                [id]: revogar
                    // Revogar NÃO apaga o consentimento antigo: some da conta,
                    // não da história — é ela que explica os envios de antes.
                    ? { ...(atualCons[id] || {}), revogadoEm: patch.atualizadoEm, revogadoPor: req.user?.email || null }
                    : { em: patch.atualizadoEm, como: String(como || '').trim().slice(0, 200) || null, por: req.user?.email || null, revogadoEm: null },
            };
            if (!revogar && !String(como || '').trim()) {
                return res.status(400).json({
                    ok: false,
                    error: 'Diga COMO o titular consentiu (ex.: "pediu no WhatsApp em 10/08", "assinou no contrato", "marcou no formulário do site").',
                });
            }
        }

        await ref.set(patch, { merge: true });
        const atualizado = { numero, ...(snap.data() || {}), ...patch };
        return res.json({ ok: true, pendenciasLgpd: pendenciasLgpdDoContato(atualizado, catalogo) });
    } catch (e) {
        console.error('[whatsapp/contatos/patch]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ═══ 🔒 LGPD — DIREITOS DO TITULAR ═════════════════════════════════════════
// Paulo, 17/08: *"devemos atender a lei de proteção de dados LGPD, evidenciar
// de forma enfática que estamos em acordo"*. O que dá lastro à frase do
// rodapé é ISTO — o mecanismo. Selo sem mecanismo é afirmação enganosa ao
// titular, e vira prova contra quem o escreveu.
//
// AMBAS SÃO requireAdmin: atender pedido de titular é ato do escritório, e o
// relatório entrega a conversa INTEIRA daquela pessoa — dado que o
// colaborador da fila X não teria por que ver de um contato da fila Y.

async function coletarDadosDoTitular(db, numero) {
    const [contato, conversa, msgs, envios, catalogo] = await Promise.all([
        db.collection('whatsapp_contatos').doc(numero).get(),
        db.collection('whatsapp_conversas').doc(numero).get(),
        db.collection('whatsapp_mensagens').where('conversaId', '==', numero).limit(2000).get(),
        db.collection('impostos_enviados').where('telefone', '==', numero).limit(500).get()
            .catch(() => ({ docs: [] })),   // coleção de outro trilho: ausência não derruba o direito de acesso
        lerCatalogoEtiquetas(db),
    ]);
    return {
        contato: contato.exists ? contato.data() : null,
        conversa: conversa.exists ? conversa.data() : null,
        mensagens: msgs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })),
        envios: envios.docs.map((d) => d.data() || {}),
        catalogo,
    };
}

router.get('/lgpd/titular/:numero', requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const numero = String(req.params.numero || '').replace(/\D/g, '');
        if (!numero) return res.status(400).json({ ok: false, error: 'número inválido' });
        const d = await coletarDadosDoTitular(db, numero);
        const relatorio = montarRelatorioTitular({
            numero, contato: d.contato, conversa: d.conversa,
            mensagens: d.mensagens, envios: d.envios, catalogoEtiquetas: d.catalogo,
        });
        const em = new Date().toISOString();
        // O pedido de ACESSO também se registra: é ele que prova, depois, que
        // o direito foi atendido (art. 37).
        const reg = registroDaSolicitacao({ numero, tipo: 'acesso', quem: req.user?.email || null, em });
        if (reg.ok) {
            await db.collection('lgpd_solicitacoes').add(reg.registro).catch((e) =>
                console.warn('[lgpd] registro do acesso falhou:', e.message));
        }
        return res.json({ ok: true, relatorio: { ...relatorio, geradoEm: em } });
    } catch (e) {
        console.error('[lgpd/titular]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Eliminação (art. 18, VI). SEM `confirmar:true` devolve só o PLANO — a mesma
 * regra do importador: nada é apagado sem a pessoa ver antes o que sai e o
 * que fica. E o que fica vem NOMEADO, porque prometer "apagamos tudo" e
 * guardar comprovante seria informação enganosa.
 */
router.post('/lgpd/titular/:numero/eliminar', requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const numero = String(req.params.numero || '').replace(/\D/g, '');
        if (!numero) return res.status(400).json({ ok: false, error: 'número inválido' });
        const d = await coletarDadosDoTitular(db, numero);
        const plano = planoDeEliminacao({
            numero, contato: d.contato, mensagens: d.mensagens.length, envios: d.envios.length,
        });
        if (!req.body?.confirmar) return res.json({ ok: true, plano, confirmado: false });
        if (plano.nadaARemover) return res.json({ ok: true, plano, confirmado: false, aviso: plano.aviso });

        const em = new Date().toISOString();
        const reg = registroDaSolicitacao({
            numero, tipo: 'eliminacao', quem: req.user?.email || null, em, plano,
            motivoDoTitular: String(req.body?.motivo || '').trim().slice(0, 300) || null,
        });
        if (!reg.ok) return res.status(400).json({ ok: false, error: reg.erro });
        // O registro entra ANTES do apagamento: se algo falhar no meio, fica a
        // prova de que o pedido existiu — o contrário deixaria dado sumido sem
        // rastro de quem mandou sumir.
        await db.collection('lgpd_solicitacoes').add(reg.registro);

        for (let i = 0; i < d.mensagens.length; i += 400) {
            const batch = db.batch();
            d.mensagens.slice(i, i + 400).forEach((m) => batch.delete(db.collection('whatsapp_mensagens').doc(m.id)));
            await batch.commit();
        }
        await db.collection('whatsapp_conversas').doc(numero).delete().catch(() => {});
        await db.collection('whatsapp_contatos').doc(numero).delete().catch(() => {});

        return res.json({ ok: true, plano, confirmado: true, removidas: d.mensagens.length });
    } catch (e) {
        console.error('[lgpd/eliminar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * 📤 Compartilhar contato — manda o CARTÃO dentro de uma conversa aberta.
 *
 * Duas guardas, as mesmas do texto livre (compartilhar contato é mensagem
 * como qualquer outra, e a Meta não abre exceção):
 *  · a janela de 24h precisa estar ABERTA (fora dela só template aprovado);
 *  · a conversa precisa ser VISÍVEL pra quem clicou — senão dava pra
 *    escrever numa conversa de outra fila por esta porta lateral.
 */
router.post('/contatos/:numero/compartilhar', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const destino = String(req.params.numero || '').replace(/\D/g, '');
        const alvos = Array.isArray(req.body?.numeros) ? req.body.numeros.map((n) => String(n).replace(/\D/g, '')).filter(Boolean) : [];
        if (!destino || !alvos.length) return res.status(400).json({ ok: false, error: 'Escolha o contato a compartilhar.' });
        if (alvos.length > 5) return res.status(400).json({ ok: false, error: 'Compartilhe até 5 contatos por vez.' });

        // Régua ÚNICA de visibilidade — a mesma do GET e do stream de mídia.
        const visao = await podeVerConversa(db, req.user, destino);
        const c = visao.conversa || {};
        if (!c.numero && !c.atualizadoEm) {
            return res.status(404).json({ ok: false, error: 'Não há conversa com este número — o cartão só vai dentro de uma conversa.' });
        }
        if (!visao.ok) return res.status(403).json({ ok: false, error: 'Esta conversa não é de uma fila sua.' });
        const ate = c.janela24hAte ? new Date(c.janela24hAte).getTime() : 0;
        if (!(ate > Date.now())) {
            return res.status(422).json({
                ok: false,
                error: 'A janela de 24h desta conversa está fechada — fora dela a Meta só aceita template aprovado.',
                acao: 'Peça ao cliente para escrever, ou inicie por template (✚ Nova).',
            });
        }

        const refs = alvos.map((n) => db.collection('whatsapp_contatos').doc(n));
        const snaps = await db.getAll(...refs);
        const cartoes = snaps.map((s, i) => {
            const d = s.data() || {};
            return { numero: alvos[i], nome: d.nomePerfil || null, empresa: d.empresaNome || d.empresaNomeSugerido || null };
        });

        const envio = await enviarContatoWhatsapp({ para: destino, contatos: cartoes });
        if (!envio.ok) return res.status(502).json({ ok: false, error: envio.erro, acao: envio.acao });

        const agora = new Date().toISOString();
        const resumo = `📇 Contato compartilhado: ${cartoes.map((x) => x.nome || x.numero).join(' · ')}`;
        await db.collection('whatsapp_mensagens').doc(envio.messageId).set({
            conversaId: destino, direcao: 'saida', tipo: 'contacts',
            texto: resumo, midia: null, timestamp: agora,
            statusEntrega: 'enviado', enviadoPor: req.user?.email || null,
        }, { merge: true });
        await db.collection('whatsapp_conversas').doc(destino).set({
            ultimaMensagem: { resumo, direcao: 'saida', em: agora }, atualizadoEm: agora,
        }, { merge: true });
        return res.json({ ok: true, messageId: envio.messageId, compartilhados: cartoes.length });
    } catch (e) {
        console.error('[whatsapp/contatos/compartilhar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── 📎 MÍDIA: abrir a recebida e enviar anexo ──────────────────────────────
// Era a lacuna 🔴 BLOQUEANTE do de-para com a Ultra Fox: o cliente manda o
// comprovante e o atendente via um rótulo que não abria.
//
// POR QUE STREAM E NÃO URL ASSINADA: o arquivo é conversa de cliente. Link
// assinado é compartilhável POR QUEM PEGAR — sai do controle do app. Aqui o
// acesso passa pela MESMA régua de visibilidade de fila da conversa (quem
// não vê a conversa não abre o anexo dela), e o custo é banda, não risco.

/** A conversa é visível pra este usuário? Régua única (a mesma do GET). */
async function podeVerConversa(db, user, numero) {
    const { filas } = await perfilAtendimento(db, user);
    const conv = await db.collection('whatsapp_conversas').doc(numero).get();
    return { ok: conversaVisivel(filas, conv.data()?.fila || null), conversa: conv.data() || {} };
}

router.get('/conversas/:numero/midia/:mensagemId', requireAuth, async (req, res) => {
    try {
        const numero = idConversaDoParam(req.params.numero);
        const mensagemId = String(req.params.mensagemId || '').trim();
        if (!numero || !mensagemId) return res.status(400).json({ ok: false, error: 'conversa ou mensagem inválida' });

        const db = getDb();
        const { ok: visivel } = await podeVerConversa(db, req.user, numero);
        if (!visivel) return res.status(403).json({ ok: false, error: 'Esta conversa é de uma fila que você não atende.' });

        const msg = (await db.collection('whatsapp_mensagens').doc(mensagemId).get()).data();
        // O anexo é da conversa que o caminho diz — id de outra conversa não
        // vira porta lateral pro anexo de um cliente que este atendente não vê.
        if (!msg || msg.conversaId !== numero) return res.status(404).json({ ok: false, error: 'anexo não encontrado nesta conversa' });
        if (!msg.midia) return res.status(404).json({ ok: false, error: 'esta mensagem não tem anexo' });
        if (!msg.midia.storagePath) {
            // Ausência com CAUSA: "não baixado" e "falhou ao baixar" são
            // problemas diferentes, com ações diferentes.
            return res.status(409).json({
                ok: false,
                error: msg.midia.downloadErro
                    ? `O anexo não foi baixado da Meta: ${msg.midia.downloadErro}`
                    : 'O anexo ainda não foi baixado da Meta.',
                acao: msg.midia.downloadErro
                    ? 'A mídia expira na Meta em alguns dias — se o erro persistir, peça o arquivo de novo ao cliente.'
                    : 'Aguarde alguns segundos e recarregue a conversa.',
            });
        }

        const arquivo = storage.bucket(STORAGE_BUCKET).file(msg.midia.storagePath);
        const [existe] = await arquivo.exists();
        if (!existe) return res.status(410).json({ ok: false, error: 'O arquivo não está mais no armazenamento.' });

        const nome = msg.midia.nomeArquivo || 'anexo';
        res.setHeader('Content-Type', msg.midia.mime || 'application/octet-stream');
        // inline: imagem e PDF abrem na tela; o navegador ainda deixa baixar.
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(nome)}"`);
        res.setHeader('Cache-Control', 'private, max-age=300');
        arquivo.createReadStream()
            .on('error', (e) => {
                console.error('[whatsapp/midia] stream falhou:', e.message);
                if (!res.headersSent) res.status(500).json({ ok: false, error: 'falha ao ler o anexo' });
                else res.end();
            })
            .pipe(res);
        return undefined;
    } catch (e) {
        console.error('[whatsapp/midia]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Enviar ANEXO na conversa (dentro da janela de 24h, como o texto livre).
router.post('/conversas/:numero/anexo', requireAuth, async (req, res) => {
    try {
        const numero = idConversaDoParam(req.params.numero);
        const p = req.body || {};
        const base64 = String(p.base64 || '');
        if (!numero) return res.status(400).json({ ok: false, error: 'número inválido' });
        if (ehConversaInstagram(numero)) {
            // Fase 1 do Instagram é TEXTO — subir mídia usa outra API (a da
            // Página) e não foi construída ainda. Recusa nomeada > envio que
            // parece ter saído e nunca chega.
            return res.status(422).json({
                ok: false,
                error: 'Anexo em DM do Instagram ainda não é suportado — esta fase responde TEXTO.',
                acao: 'Responda por texto; se o cliente precisar de arquivo, combine outro canal (e-mail ou WhatsApp).',
            });
        }
        if (!base64) return res.status(400).json({ ok: false, error: 'Escolha o arquivo antes de enviar.' });

        const db = getDb();
        const { ok: visivel, conversa } = await podeVerConversa(db, req.user, numero);
        if (!visivel) return res.status(403).json({ ok: false, error: 'Esta conversa é de uma fila que você não atende.' });

        // Janela de 24h: anexo é mensagem livre — fora dela a Meta recusa.
        const ate = Date.parse(conversa.janela24hAte || '');
        if (!Number.isFinite(ate) || ate <= Date.now()) {
            return res.status(422).json({
                ok: false,
                error: 'A janela de 24h desta conversa está fechada — anexo não sai.',
                acao: 'Aguarde o cliente escrever (isso reabre a janela) ou envie por template aprovado.',
                janelaFechada: true,
            });
        }
        // Guarda de condução: a MESMA do texto livre (duas vozes confundem).
        const dono = conversa.atribuidoA || null;
        const eu = req.user?.email || null;
        if (dono && dono !== eu) {
            return res.status(409).json({
                ok: false,
                error: `Esta conversa está em condução por ${dono}.`,
                acao: 'Assuma a conversa (🙋) antes de enviar o anexo.',
                emConducaoPor: dono,
            });
        }

        const tamanhoBytes = Buffer.byteLength(base64, 'base64');
        const v = validarAnexo({ mime: p.mime, tamanhoBytes, nomeArquivo: p.nomeArquivo });
        if (!v.ok) return res.status(422).json({ ok: false, error: v.erro, acao: v.acao });
        const legenda = String(p.legenda || '').trim();

        let mediaId;
        try {
            mediaId = await subirMidiaWhatsapp({ base64, nomeArquivo: v.nome, mime: p.mime });
        } catch (e) {
            return res.status(422).json({ ok: false, error: e.message, acao: 'Confira o arquivo e tente de novo.' });
        }
        const envio = await enviarMidiaWhatsapp({ para: numero, tipo: v.tipo, mediaId, nomeArquivo: v.nome, legenda });
        if (!envio.ok) {
            const status = envio.configuracaoIncompleta ? 503 : envio.indeterminado ? 502 : 422;
            return res.status(status).json({ ok: false, error: envio.erro, acao: envio.acao, indeterminado: Boolean(envio.indeterminado) });
        }

        // Cópia do ENVIADO no Storage: sem ela o histórico mostraria um anexo
        // que ninguém abre depois (a mídia expira na Meta) — a mesma falta
        // que este PR veio consertar, só que do lado da saída.
        const agora = new Date().toISOString();
        const caminho = `whatsapp/${numero}/${envio.messageId}_${v.nome}`;
        let storagePath = null;
        try {
            await storage.bucket(STORAGE_BUCKET).file(caminho).save(Buffer.from(base64, 'base64'), {
                contentType: p.mime || 'application/octet-stream', resumable: false,
            });
            storagePath = caminho;
        } catch (e) {
            console.warn('[whatsapp/anexo] enviado, mas a cópia no Storage falhou:', e.message);
        }

        const midia = {
            nomeArquivo: v.nome, mime: p.mime || null, tipo: v.tipo,
            tamanhoBytes, storagePath, metaMediaId: mediaId,
        };
        const msg = {
            conversaId: numero, direcao: 'saida', tipo: v.tipo,
            texto: legenda || null, midia, timestamp: agora,
            statusEntrega: 'enviado', enviadoPor: eu,
        };
        await db.collection('whatsapp_mensagens').doc(envio.messageId).set(msg, { merge: true });
        await db.collection('whatsapp_conversas').doc(numero).set({
            ultimaMensagem: { resumo: resumoDoAnexo(v.tipo, v.nome, legenda), direcao: 'saida', em: agora },
            atualizadoEm: agora,
            ...(dono ? {} : { atribuidoA: eu }),   // enviar anexo também é assumir
        }, { merge: true });

        return res.json({
            ok: true,
            // A legenda descartada é DITA — texto que some sem aviso faz a
            // pessoa achar que o cliente leu o recado.
            legendaIgnorada: legendaSeraIgnorada(v.tipo, legenda),
            copiaGuardada: Boolean(storagePath),
            mensagem: { id: envio.messageId, ...msg, midia: { ...midia, baixada: Boolean(storagePath) }, erroEntrega: null },
        });
    } catch (e) {
        console.error('[whatsapp/anexo]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── CLIENTE 360 da conversa (pós-vínculo) ──────────────────────────────────
// A vantagem do SP Connect sobre a plataforma antiga: o atendente vê QUEM é
// o cliente sem trocar de tela. NENHUMA conta nova — responsável vem da
// carteira, guias vêm da auditoria do rito #293 (impostos_enviados). Sort em
// memória de propósito: where(empresaId)+orderBy(enviadoEm) exigiria índice
// composto — entra se o volume provar precisar.
router.get('/conversas/:numero/cliente', requireAuth, async (req, res) => {
    try {
        const numero = idConversaDoParam(req.params.numero);
        if (!numero) return res.status(400).json({ ok: false, error: 'número inválido' });
        const db = getDb();
        const contato = (await db.collection('whatsapp_contatos').doc(numero).get()).data() || {};
        if (!contato.empresaId) return res.json({ ok: true, vinculado: false });

        const empresaId = contato.empresaId;
        const [simples, lucro, cartSnap, enviosSnap] = await Promise.all([
            db.collection('simples_empresas').doc(empresaId).get(),
            db.collection('lucro_empresas').doc(empresaId).get(),
            db.collection('carteiras').where('empresaId', '==', empresaId).get(),
            db.collection('impostos_enviados').where('empresaId', '==', empresaId).limit(100).get(),
        ]);
        const emp = simples.exists ? { ...simples.data(), _origem: 'simples' }
            : lucro.exists ? { ...lucro.data(), _origem: 'lucro' } : null;

        const responsaveis = cartSnap.docs.map((d) => {
            const x = d.data();
            return { nome: x.colaboradorNome || null, papel: x.papel || 'principal' };
        }).filter((r) => r.nome);

        const paraIso = (v) => {
            if (!v) return null;
            if (typeof v.toDate === 'function') return v.toDate().toISOString();
            const t = Date.parse(v);
            return Number.isFinite(t) ? new Date(t).toISOString() : null;
        };
        const guias = enviosSnap.docs.map((d) => {
            const x = d.data();
            return {
                tipo: x.tipo || null, competencia: x.competencia || null,
                valor: Number.isFinite(Number(x.valor)) ? Number(x.valor) : null,
                canal: x.canal || null, enviadoPor: x.enviadoPor || null,
                enviadoEm: paraIso(x.enviadoEm),
            };
        }).sort((a, b) => String(b.enviadoEm || '').localeCompare(String(a.enviadoEm || ''))).slice(0, 6);

        return res.json({
            ok: true,
            vinculado: true,
            empresa: emp ? {
                id: empresaId,
                nome: emp.nome || emp.razaoSocial || contato.empresaNome || empresaId,
                cnpj: String(emp.cnpj || '').replace(/\D/g, '') || null,
                regime: emp._origem === 'simples' ? 'Simples Nacional' : (emp.regimePadrao || 'Lucro'),
                excluida: Boolean(emp._deleted || emp._merged_into),
            } : { id: empresaId, nome: contato.empresaNome || empresaId, cnpj: null, regime: null, naoEncontrada: true },
            responsaveis,
            // total vai junto: lista de 6 com total maior avisa que há mais.
            guias, totalGuias: enviosSnap.size,
        });
    } catch (e) {
        console.error('[whatsapp/cliente]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
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

// ─── 🔔 PUSH: token do celular e preferências de aviso ──────────────────────
// O token é POR USUÁRIO (um doc por uid), e cada pessoa pode ter vários
// celulares. Quem recebe o quê é decidido no envio, pela MESMA régua de fila
// do inbox — registrar token não dá acesso a nada.

router.post('/push/token', requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid) return res.status(401).json({ ok: false, error: 'sessão inválida' });
        const ref = getDb().collection(COLECAO_TOKENS).doc(uid);
        const atual = (await ref.get()).data() || {};
        const r = registrarToken(atual.tokens || [], req.body?.token);
        if (!r.ok) return res.status(400).json({ ok: false, error: r.erro });
        await ref.set({
            email: req.user?.email || null,
            tokens: r.tokens,
            atualizadoEm: new Date().toISOString(),
        }, { merge: true });
        return res.json({ ok: true, dispositivos: r.tokens.length });
    } catch (e) {
        console.error('[whatsapp/push/token]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/push/prefs', requireAuth, async (req, res) => {
    try {
        const d = (await getDb().collection(COLECAO_TOKENS).doc(req.user?.uid || '_').get()).data() || {};
        return res.json({ ok: true, prefs: d.prefs || {}, dispositivos: (d.tokens || []).length });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/push/prefs', requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid) return res.status(401).json({ ok: false, error: 'sessão inválida' });
        const p = req.body?.prefs || {};
        const prefs = {};
        for (const k of ['som', 'popup', 'push', 'pushForaDoExpediente']) {
            if (typeof p[k] === 'boolean') prefs[k] = p[k];
        }
        await getDb().collection(COLECAO_TOKENS).doc(uid).set({ prefs }, { merge: true });
        return res.json({ ok: true, prefs });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// ─── 📞 CANAIS (2º número / 2ª WABA) ────────────────────────────────────────
// Hoje o escritório tem UM número, que vem do ENV e é o canal PADRÃO. Estas
// rotas deixam o app APTO a um segundo sem refazer nada — e sem cadastro
// obrigatório enquanto ele não existir.
//
// ⚠️ O TOKEN do canal novo NUNCA entra aqui: o cadastro guarda o NOME da
// variável do Cloud Run; o valor vive lá, como o do canal de hoje. É a mesma
// régua do cofre de certificados — leva-se a operação, nunca a chave.

async function lerCanais(db) {
    let cadastrados = [];
    try {
        const snap = await db.collection('whatsapp_canais').get();
        cadastrados = snap.docs.map((d) => ({ id: d.id, dados: d.data() }));
    } catch (e) {
        console.warn('[whatsapp/canais] catálogo não lido:', e.message);
    }
    return montarCatalogoCanais({ cadastrados });
}

router.get('/canais', requireAuth, async (_req, res) => {
    try {
        const catalogo = await lerCanais(getDb());
        // `pronto` de cada canal responde pela CREDENCIAL de verdade (a env
        // no Cloud Run), não só pelo cadastro — cadastro completo com env
        // faltando é o "parece configurado e não envia" que se quer evitar.
        const canais = catalogo.canais.map((c) => {
            const cred = credenciaisDoCanal(c, process.env);
            const { envToken, ...semSegredo } = c;
            return { ...semSegredo, envToken, pronto: cred.pronto, faltas: cred.faltas };
        });
        return res.json({ ...catalogo, ok: true, canais });
    } catch (e) {
        console.error('[whatsapp/canais]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/canais', requireAdmin, async (req, res) => {
    try {
        const v = validarCanal(req.body || {});
        if (!v.ok) return res.status(400).json({ ok: false, error: v.erros.join(' · '), erros: v.erros });
        const db = getDb();
        const catalogo = await lerCanais(db);
        const pnid = String(req.body.phoneNumberId).trim();
        const jaUsado = catalogo.canais.find((c) => c.phoneNumberId === pnid && c.id !== v.id);
        if (jaUsado) {
            return res.status(409).json({
                ok: false,
                error: `O número ${pnid} já é o canal "${jaUsado.rotulo}". Dois canais no mesmo número roteariam as mensagens ao acaso.`,
            });
        }
        await db.collection('whatsapp_canais').doc(v.id).set({
            rotulo: String(req.body.rotulo).trim(),
            numeroExibicao: String(req.body.numeroExibicao || '').trim() || null,
            phoneNumberId: pnid,
            wabaId: String(req.body.wabaId || '').trim() || null,
            envToken: v.envToken,        // o NOME da variável, nunca o valor
            ativo: req.body.ativo !== false,
            atualizadoEm: new Date().toISOString(),
            atualizadoPor: req.user?.email || null,
        }, { merge: true });
        return res.json({ ok: true, id: v.id, ...(await lerCanais(db)) });
    } catch (e) {
        console.error('[whatsapp/canais POST]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
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
                papelAtendimento: x.papelAtendimento || 'colaborador',
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
        const antes = snap.data()?.filasAtendimento || [];
        await ref.set({ filasAtendimento: filas }, { merge: true });
        // Mudança de PODER deixa rastro (quem vê quais conversas).
        await registrarMudancaPermissao({
            alvoUid: uid, alvoEmail: snap.data()?.email || null,
            campo: 'filasAtendimento', de: antes, para: filas, por: req.user?.email || null,
        });
        console.log(`[whatsapp/atendentes] filas de ${uid} → [${filas.join(', ')}] por ${req.user?.email}`);
        return res.json({ ok: true, uid, filas });
    } catch (e) {
        console.error('[whatsapp/atendentes/filas]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Papel do atendimento (gestor/colaborador) — SÓ admin grava ("alteração
// sistêmica" é do admin; gestor visualiza e atende, não configura). Papel
// desconhecido é RECUSADO, e as rules têm a anti-autoconcessão.
router.post('/atendentes/:uid/papel', requireAdmin, async (req, res) => {
    try {
        const uid = String(req.params.uid || '').trim();
        const papel = String(req.body?.papel || '').trim().toLowerCase();
        if (!uid) return res.status(400).json({ ok: false, error: 'Informe o uid do usuário.' });
        if (!papelValido(papel)) return res.status(400).json({ ok: false, error: 'papel deve ser colaborador ou gestor.' });
        const ref = getDb().collection('users').doc(uid);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ ok: false, error: `Usuário ${uid} não existe no cadastro.` });
        const antes = snap.data()?.papelAtendimento || 'colaborador';
        await ref.set({ papelAtendimento: papel }, { merge: true });
        await registrarMudancaPermissao({
            alvoUid: uid, alvoEmail: snap.data()?.email || null,
            campo: 'papelAtendimento', de: antes, para: papel, por: req.user?.email || null,
        });
        console.log(`[whatsapp/atendentes] papel de ${uid} → ${papel} por ${req.user?.email}`);
        return res.json({ ok: true, uid, papel });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// ─── 📊 AVALIAÇÕES do atendimento ───────────────────────────────────────────
// admin e gestor veem TODAS; colaborador vê as DELE (atendente = seu e-mail).
// O recorte é do backend. Filtro em memória de propósito: where(atendente)+
// orderBy(em) exigiria índice composto — entra se o volume provar precisar.
router.get('/avaliacoes', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const { papel } = await perfilAtendimento(db, req.user);
        const veTudo = papel === 'admin' || papel === 'gestor';
        const eu = req.user?.email || null;
        const snap = await db.collection('whatsapp_avaliacoes').orderBy('em', 'desc').limit(500).get();
        const todas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const visiveis = veTudo ? todas : todas.filter((a) => a.atendente === eu);
        const soma = visiveis.reduce((s, a) => s + (Number(a.nota) || 0), 0);
        return res.json({
            ok: true,
            escopo: veTudo ? 'todas' : 'minhas',
            total: visiveis.length,
            media: visiveis.length ? Math.round((soma / visiveis.length) * 100) / 100 : null,
            porNota: [1, 2, 3, 4, 5].map((n) => ({ nota: n, quantidade: visiveis.filter((a) => a.nota === n).length })),
            avaliacoes: visiveis.slice(0, 50),
        });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// ─── 📈 RELATÓRIO DE ATENDIMENTO (volume e tempo de 1ª resposta) ────────────
// Item 3 da lista de 21/08 — o último 🔴 do de-para. Admin e GESTOR (é papel
// de gestão; colaborador tem o próprio painel de avaliações). A CONTA é do
// núcleo puro (whatsapp-relatorio.js); aqui só a leitura do período.
router.get('/relatorio', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const { papel } = await perfilAtendimento(db, req.user);
        if (papel !== 'admin' && papel !== 'gestor') {
            return res.status(403).json({ ok: false, error: 'Relatório de atendimento é de admin/gestor.' });
        }
        const dias = Math.min(Math.max(Number(req.query.dias) || 7, 1), 90);
        const inicioIso = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

        // timestamp é ISO string — where >= compara certo. Teto NOMEADO: se
        // bater, o relatório DIZ que está parcial em vez de parecer completo.
        const TETO_MSGS = 20000;
        const snap = await db.collection('whatsapp_mensagens')
            .where('timestamp', '>=', inicioIso).limit(TETO_MSGS).get();
        const mensagens = snap.docs.map((d) => d.data() || {});

        const numeros = [...new Set(mensagens.map((m) => m.conversaId).filter(Boolean))];
        const filaPorConversa = new Map();
        for (let i = 0; i < numeros.length; i += 300) {
            const refs = numeros.slice(i, i + 300).map((n) => db.collection('whatsapp_conversas').doc(n));
            // eslint-disable-next-line no-await-in-loop
            (await db.getAll(...refs)).forEach((c) => { if (c.exists) filaPorConversa.set(c.id, (c.data() || {}).fila || null); });
        }

        const r = montarRelatorioAtendimento({ mensagens, filaPorConversa });
        return res.json({
            ok: true, dias, ...r,
            parcial: mensagens.length >= TETO_MSGS ? TETO_MSGS : null,
        });
    } catch (e) {
        console.error('[whatsapp/relatorio]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── 🗄 ARQUIVO DE MÍDIA NO SHAREPOINT (manual — o cron roda sozinho) ───────
// Regra do manual da casa (Paulo, 21/08): tudo que não for texto vai pro
// SharePoint, árvore genérica "SP Connect/" (currículo de não-cliente também).
// O automático pega carona no cron do arquivo fiscal; este botão existe pra
// rodar AGORA e pra ver o resultado sem esperar o próximo ciclo.
router.post('/arquivo-sp', requireAdmin, async (req, res) => {
    try {
        const r = await arquivarMidiasWhatsappNoSharePoint({ maxDocs: Number(req.body?.maxDocs) || undefined });
        return res.json(r);
    } catch (e) {
        console.error('[whatsapp/arquivo-sp]', e);
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
            // 📎 Decisão do Paulo (18/08): "texto no whatsapp, anexo
            // SharePoint". A mensagem entra DIZENDO que havia anexo e onde
            // ele está — linha enigmática faria alguém procurar no app um
            // arquivo que ele nunca teve.
            const anexo = detectarAnexo(m.texto);
            batch.set(db.collection('whatsapp_mensagens').doc(idMensagemImportada(m)), {
                conversaId: m.numero, direcao: m.direcao, tipo: 'text',
                texto: m.texto, midia: null, timestamp: m.em,
                ...(anexo.temAnexo ? { anexoNoBackup: { arquivo: anexo.arquivo, pasta: PASTA_MIDIA } } : {}),
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

/**
 * 📦 IMPORTAÇÃO EM LOTE do backup da Ultra Fox (Paulo, 18/08: *"pode
 * construir"*). O export tem ~800 MB e centenas de pastas — subir arquivo por
 * arquivo pela tela antiga seria trabalho humano de horas, e o corpo do POST
 * tem teto de 20 MB, então o zip inteiro não passa de jeito nenhum.
 *
 * DESENHO: **o navegador LÊ e INTERPRETA na máquina de quem importa** (o
 * parser é o mesmo módulo puro, importado no front — segunda cópia dele seria
 * a divergência de sempre) e manda MENSAGENS JÁ LIDAS, em blocos. A mídia nem
 * sai do computador nesta etapa.
 *
 * 🚨 **MAS QUEM DECIDE A DIREÇÃO É O SERVIDOR**, com a mesma
 * `prepararMensagensDoTxt` da importação de um arquivo só: o cliente manda o
 * AUTOR de cada mensagem e a lista de quem é do escritório; entrada/saída sai
 * daqui. E o **id é recalculado aqui** (`gravarMensagensImportadas`), nunca
 * aceito do navegador — id vindo de fora é a porta para gravar duas vezes a
 * mesma mensagem, que é justamente o que o determinismo existe para impedir.
 *
 * ⚠️ Número vem da PASTA e entra COMO ESTÁ (`numeroCanonicoWhatsapp`): foi
 * este backup que revelou os clientes de fora do Brasil.
 */
router.post('/importar-ultrafox/lote', requireAdmin, async (req, res) => {
    try {
        const p = req.body || {};
        const autoresEscritorio = Array.isArray(p.autoresEscritorio) ? p.autoresEscritorio : [];
        if (!autoresEscritorio.length) {
            return res.status(400).json({
                ok: false,
                error: 'Marque qual(is) autor(es) são do ESCRITÓRIO — a direção das mensagens não se adivinha.',
            });
        }
        const conversas = Array.isArray(p.conversas) ? p.conversas : [];
        if (!conversas.length) return res.status(400).json({ ok: false, error: 'Bloco sem conversa nenhuma.' });

        const docs = [];
        const recusadas = [];
        for (const c of conversas) {
            const numero = numeroCanonicoWhatsapp(c?.numero);
            if (!numero) { recusadas.push({ numero: String(c?.numero || ''), motivo: 'número da pasta ilegível' }); continue; }
            const mensagens = (Array.isArray(c?.mensagens) ? c.mensagens : []).filter((m) => {
                // Data que não é data NÃO vira "agora" — mensagem no lugar
                // errado da thread é pior que mensagem que não entrou.
                const ok = m && typeof m.em === 'string' && Number.isFinite(Date.parse(m.em)) && typeof m.texto === 'string';
                if (!ok) recusadas.push({ numero, motivo: 'mensagem sem data legível ou sem texto' });
                return ok;
            });
            if (!mensagens.length) continue;
            docs.push(...prepararMensagensDoTxt({ mensagens, numero, autoresEscritorio }));
        }

        if (docs.length > LIMITE_MENSAGENS_IMPORT) {
            return res.status(422).json({
                ok: false,
                error: `Bloco com ${docs.length} mensagens — o limite por requisição é ${LIMITE_MENSAGENS_IMPORT}.`,
                acao: 'A tela divide sozinha; se isto apareceu, recarregue e tente de novo.',
            });
        }
        if (!docs.length) {
            return res.status(422).json({ ok: false, error: 'Nenhuma mensagem legível neste bloco — nada foi gravado.', recusadas: recusadas.slice(0, 20) });
        }

        const g = await gravarMensagensImportadas(getDb(), docs, req.user?.email || null);
        // Recusadas SEMPRE voltam: bloco que grava 900 de 1000 e não diz nada
        // é o contador mudo que faz alguém achar que importou tudo.
        return res.json({ ok: true, ...g, recusadas: recusadas.slice(0, 20), totalRecusadas: recusadas.length });
    } catch (e) {
        console.error('[whatsapp/importar-ultrafox/lote]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * 🔎 SONDA da chamada de voz/vídeo — READ-ONLY, de propósito.
 *
 * Ela pergunta à Meta e RELATA; não liga nem desliga nada. Ligar a chamada
 * abre um botão no WhatsApp de TODOS os clientes, e essa é decisão do Paulo
 * com destino de atendimento definido antes — não efeito colateral de um
 * clique de diagnóstico. `whatsappChamadas.test.ts` prova que o núcleo não
 * escreve (nem na Meta, nem no banco).
 */
router.get('/chamadas/sondar', requireAdmin, async (_req, res) => {
    try {
        const cfg = configWhatsapp();
        if (!cfg.token || !cfg.phoneNumberId) {
            return res.json({
                ok: true,
                conclusao: {
                    veredito: 'indeterminado',
                    motivo: 'O canal do WhatsApp não está configurado neste ambiente.',
                    acao: 'Sem token/phone number id não dá pra perguntar à Meta — e não perguntar não é resposta.',
                },
                sondas: [], antesDeLigar: ANTES_DE_LIGAR,
            });
        }

        const sondas = [];
        for (const c of CANDIDATOS_SONDA) {
            let status = null; let corpo = null;
            try {
                const r = await fetch(`${GRAPH_BASE}/${c.caminho(cfg.phoneNumberId)}`, {
                    headers: { Authorization: `Bearer ${cfg.token}` },
                });
                status = r.status;
                corpo = await r.json().catch(() => ({}));
            } catch (e) {
                corpo = { error: { message: e.message } };
            }
            sondas.push({
                candidato: c.id, rotulo: c.rotulo, hipotese: c.hipotese,
                ...interpretarSondaChamadas(status, corpo),
            });
        }

        return res.json({ ok: true, conclusao: concluirSonda(sondas), sondas, antesDeLigar: ANTES_DE_LIGAR });
    } catch (e) {
        console.error('[whatsapp/chamadas/sondar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * 🔎 SONDA DO INSTAGRAM — READ-ONLY, mesma decisão do ☎️ (não linka nada).
 *
 * Paulo, 18/08: *"Conseguimos linkar as DM do nosso Instagram? E se sim
 * somente para alguns atendentes?"*. O token do WhatsApp foi concedido só
 * pras permissões do WhatsApp — a API de Mensagens do Instagram é outro
 * produto da Graph API, com permissões PRÓPRIAS. A sonda pergunta com o
 * MESMO token e mostra o que a Meta responde de verdade, em vez de supor.
 */
router.get('/instagram/sondar', requireAdmin, async (_req, res) => {
    try {
        const cfg = configWhatsapp();
        if (!cfg.token) {
            return res.json({
                ok: true,
                conclusao: {
                    veredito: 'indeterminado',
                    motivo: 'O canal do WhatsApp não está configurado neste ambiente.',
                    acao: 'Sem token não dá pra perguntar à Meta — e não perguntar não é resposta.',
                },
                sondas: [], sobreRestringirAtendentes: SOBRE_RESTRINGIR_ATENDENTES,
            });
        }

        const sondas = [];
        for (const c of CANDIDATOS_SONDA_IG) {
            let status = null; let corpo = null;
            try {
                const r = await fetch(`${GRAPH_BASE}/${c.caminho()}`, {
                    headers: { Authorization: `Bearer ${cfg.token}` },
                });
                status = r.status;
                corpo = await r.json().catch(() => ({}));
            } catch (e) {
                corpo = { error: { message: e.message } };
            }
            sondas.push({
                candidato: c.id, rotulo: c.rotulo, hipotese: c.hipotese,
                ...interpretarSondaInstagram(c.id, status, corpo),
            });
        }

        return res.json({ ok: true, conclusao: concluirSondaInstagram(sondas), sondas, sobreRestringirAtendentes: SOBRE_RESTRINGIR_ATENDENTES });
    } catch (e) {
        console.error('[whatsapp/instagram/sondar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// 📡 LIGA o recebimento das DMs (assina o webhook `instagram` no app + a
// Página no app). Idempotente — religar só re-afirma. O estado persistido em
// whatsapp_config/instagram é o que a ⚙️ → 📷 mostra ("ligado em ..., por
// ..."), porque botão que não muda nada visível é beco (família do "Já
// importado" sem estado).
router.post('/instagram/ligar', requireAdmin, async (req, res) => {
    try {
        const r = await ligarRecebimentoInstagram();
        if (!r.ok) return res.status(422).json({ ok: false, error: r.erro });
        const estado = {
            ligadoEm: new Date().toISOString(),
            ligadoPor: req.user?.email || null,
            appId: r.appId,
            callback: r.callback,
            pageId: r.pageId,
            igId: r.igId,
            igUsername: r.igUsername,
        };
        await getDb().collection('whatsapp_config').doc('instagram').set(estado, { merge: true });
        return res.json({ ok: true, ...estado });
    } catch (e) {
        console.error('[whatsapp/instagram/ligar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Estado do recebimento (a ⚙️ → 📷 lê ao abrir — sem isso o 📡 não teria como
// dizer se já foi clicado).
router.get('/instagram/estado', requireAdmin, async (_req, res) => {
    try {
        const doc = await getDb().collection('whatsapp_config').doc('instagram').get();
        return res.json({ ok: true, estado: doc.exists ? doc.data() : null });
    } catch (e) {
        console.error('[whatsapp/instagram/estado]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
