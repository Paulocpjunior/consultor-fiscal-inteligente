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
import { Storage } from '@google-cloud/storage';
import {
    configWebhook, faltasDaConfigWebhook, responderVerificacao,
    assinaturaValida, extrairEventos, traduzirStatusEntrega,
    interpretarErroEntrega, mensagemDoStatus, janela24hAte, resumoParaConversa,
    caminhoStorageMidia,
} from './whatsapp-webhook.js';
import { configWhatsapp, GRAPH_BASE, enviarTextoLivre, enviarMidiaWhatsapp } from './whatsapp-cloud.js';
import { resolverConfig, decidirAutomacao, gerarProtocolo, leituraDaNota, filaValida } from './whatsapp-atendimento.js';
import { montarCatalogoCanais, canalDoEvento, normalizarCanalCadastrado, cfgDeEnvioDaConversa } from './whatsapp-canais.js';
import { notificarMensagem } from './whatsapp-push-envio.js';
import { extrairEventosInstagram, resumoDaMensagemIg, paginaDoInstagram } from './instagram-dm.js';
import { extrairEventosChamada, resumoDaChamada, resumoDaPermissao } from './whatsapp-chamadas.js';
import {
    filasParaTriagem, valeClassificar, montarPromptTriagem,
    interpretarRespostaTriagem, decidirDestinoDaTriagem,
} from './whatsapp-triagem-ia.js';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'consultorfiscalapp';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const storage = new Storage();

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

// ─── GET: handshake de assinatura do webhook no painel da Meta ──────────────
router.get('/webhook', (req, res) => {
    const r = responderVerificacao(req.query, configWebhook());

    // 📋 O último aperto de mão fica GRAVADO (caso de 22/08: "Forbidden" no
    // painel da Meta e ninguém sabia se era o navegador batendo sem os
    // parâmetros ou o verify token colado errado — as duas caras eram o
    // mesmo 403, e a resposta estava só no log do Cloud Run). Um doc só,
    // sobrescrito; o TOKEN nunca é gravado — só o motivo. Best-effort e
    // pós-resposta: a Meta quer o challenge rápido, e diagnóstico não pode
    // atrasar nem derrubar o handshake real.
    const temHub = Boolean(req.query?.['hub.mode'] || req.query?.['hub.verify_token'] || req.query?.['hub.challenge']);
    setImmediate(async () => {
        try {
            await getDb().collection('whatsapp_config').doc('webhook_verificacao').set({
                em: new Date().toISOString(),
                ok: r.ok,
                motivo: r.ok ? null : r.motivo,
                // Sem hub.* nenhum = alguém abriu a URL no navegador — não é a Meta.
                pareceNavegador: !temHub,
            });
        } catch (e) {
            console.warn('[whatsapp/webhook GET] diagnóstico não gravado:', e.message);
        }
    });

    if (!r.ok) {
        console.warn('[whatsapp/webhook GET] verificação recusada:', r.motivo);
        return res.sendStatus(403);
    }
    // A Meta espera o challenge CRU (texto), não JSON.
    return res.status(200).send(r.challenge);
});

// ─── GET: banner de departamento, PÚBLICO de propósito ─────────────────────
// A Meta busca `image.link` sob demanda, de fora — não tem token nosso. É
// por isso que esta rota é aberta e a de anexo de CLIENTE (gated por fila,
// em whatsapp-routes.js) continua exigindo login: são dados de natureza
// diferente — banner é marketing da casa, anexo é conteúdo do cliente.
router.get('/publico/imagem-fila/:fila', async (req, res) => {
    try {
        const fila = String(req.params.fila || '').trim().toLowerCase();
        if (!filaValida(fila)) return res.sendStatus(404);
        const db = getDb();
        const cfgDoc = await db.collection('whatsapp_config').doc('atendimento').get();
        const config = resolverConfig(cfgDoc.data());
        const url = config.imagensPorFila?.[fila];
        if (!url) return res.sendStatus(404);
        // A extensão é a mesma gravada no upload (whatsapp-routes.js) — o
        // caminho é determinístico por fila, então listar o bucket resolve
        // qual arquivo existe sem precisar guardar o mime à parte.
        const bucket = storage.bucket(STORAGE_BUCKET);
        const [arquivos] = await bucket.getFiles({ prefix: `whatsapp/config/imagem-fila/${fila}.` });
        const arquivo = arquivos[0];
        if (!arquivo) return res.sendStatus(404);
        const [meta] = await arquivo.getMetadata();
        res.setHeader('Content-Type', meta.contentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        arquivo.createReadStream()
            .on('error', (e) => { console.error('[whatsapp/imagem-fila] stream falhou:', e.message); if (!res.headersSent) res.sendStatus(500); else res.end(); })
            .pipe(res);
        return undefined;
    } catch (e) {
        console.error('[whatsapp/imagem-fila]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/** Grava UMA mensagem recebida + contato + conversa. Idempotente pelo wamid. */
/**
 * Catálogo de canais (padrão do env + cadastrados). Leitura BEST-EFFORT: se
 * a coleção falhar, vale só o canal do env — um cadastro que piscou não pode
 * derrubar a captura de mensagem, que é o que não se recupera.
 */
async function catalogoDeCanais(db) {
    let cadastrados = [];
    try {
        const snap = await db.collection('whatsapp_canais').get();
        cadastrados = snap.docs.map((d) => ({ id: d.id, dados: d.data() }));
    } catch (e) {
        console.warn('[whatsapp/canais] catálogo não lido, valendo só o canal do env:', e.message);
    }
    return montarCatalogoCanais({ cadastrados });
}

async function gravarMensagemRecebida(db, msg, catalogo = null) {
    const agora = new Date().toISOString();
    // ☎️ Resposta ao cartão "Permitir": vira texto legível na linha (o
    // interactive cru não tem título) e carimba a conversa — é o que o botão
    // da tela lê para saber se a ligação de saída está autorizada.
    if (msg.permissaoLigacao && !msg.texto) msg.texto = resumoDaPermissao(msg.permissaoLigacao);
    // De qual número esta mensagem veio? A Meta diz no payload — é fonte.
    const canal = catalogo ? canalDoEvento(catalogo, msg.phoneNumberId) : { canalId: null, conhecido: true, motivo: null };
    if (catalogo && !canal.conhecido) console.warn('[whatsapp/canais]', canal.motivo);
    await db.collection('whatsapp_mensagens').doc(msg.metaMessageId).set({
        conversaId: msg.de,
        direcao: 'entrada',
        tipo: msg.tipo,
        texto: msg.texto,
        midia: msg.midia,           // download do binário é da F2 — o media id fica guardado
        respostaA: msg.respostaA,
        timestamp: msg.timestamp,
        phoneNumberId: msg.phoneNumberId,
        canalId: canal.canalId,          // null = número fora do catálogo (nomeado no log)
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
        // O canal da conversa é o do PRIMEIRO contato e não muda sozinho: se
        // o cliente escrever pro outro número, a linha do canal desta
        // conversa continua sendo a que o atendente já está usando.
        ...(canal.canalId ? { canalId: canal.canalId } : {}),
        ultimaMensagem: { resumo: resumoParaConversa(msg), direcao: 'entrada', em: msg.timestamp || agora },
        // Mensagem do cliente ABRE/renova a janela de 24h — é ela que a F2 mostra.
        janela24hAte: janela24hAte(msg.timestamp || agora),
        naoLidas: admin.firestore.FieldValue.increment(1),
        atualizadoEm: agora,
        ...(msg.permissaoLigacao ? {
            permissaoLigacao: {
                status: msg.permissaoLigacao.resposta,           // 'aceita' | 'recusada'
                em: msg.timestamp || agora,
                expiraEm: msg.permissaoLigacao.expiraEm || null, // null = a Meta não disse
            },
        } : {}),
    }, { merge: true });
}

/**
 * ☎️ Grava UM evento de CHAMADA como linha da conversa (Paulo, 23/08 — a
 * ligação recebida/perdida não pode sumir do histórico). Idempotente por
 * call+evento, e a reentrega da Meta NÃO conta não-lida duas vezes.
 *
 * 🚨 Chamada NÃO abre a janela de 24h — janela é de MENSAGEM (regra da Meta);
 * afirmá-la por ligação liberaria texto livre que a Meta vai recusar depois.
 */
async function gravarEventoChamada(db, c) {
    const agora = new Date().toISOString();
    const resumo = resumoDaChamada(c);
    const ref = db.collection('whatsapp_mensagens').doc(`call_${c.callId}_${c.evento || 'evento'}`);
    const jaExiste = (await ref.get()).exists;
    await ref.set({
        conversaId: c.conversaId,
        direcao: c.direcao,
        tipo: 'chamada',
        texto: resumo,
        callId: c.callId,
        eventoChamada: c.evento,
        duracaoSegundos: c.duracaoSegundos,
        timestamp: c.timestamp || agora,
        phoneNumberId: c.phoneNumberId,
        // O leiaute do "calls" ainda não foi provado — o CRU do evento fica no
        // doc: é dele que sai a régua definitiva quando a primeira chamada real
        // chegar (mesmo desenho do Jotform Sign).
        bruto: c.bruto,
        recebidoEm: agora,
    }, { merge: true });
    await db.collection('whatsapp_conversas').doc(c.conversaId).set({
        numero: c.conversaId,
        ultimaMensagem: { resumo, direcao: c.direcao, em: c.timestamp || agora },
        // Ligação DO CLIENTE pede atenção como não-lida — quem perdeu a
        // chamada precisa ver que ela existiu. Só na 1ª gravação do evento.
        ...(!jaExiste && c.direcao === 'entrada'
            ? { naoLidas: admin.firestore.FieldValue.increment(1) } : {}),
        atualizadoEm: agora,
    }, { merge: true });
    return { jaExiste };
}

/**
 * 📷 Grava UMA DM do Instagram (entrada OU eco de saída) + contato + conversa.
 * Idempotente pelo mid da Meta. A conversa é `ig_{IGSID}` com canal
 * 'instagram' na MESMA coleção — fila/assumir/transferir/relatório leem a
 * conversa, então funcionam sem mudar. O BOT NÃO roda aqui (decisão do
 * módulo instagram-dm.js): DM entra na triagem da Recepção e gente conduz.
 */
async function gravarMensagemInstagram(db, m) {
    const agora = new Date().toISOString();
    const eco = m.direcao === 'saida';
    const anexo = m.anexos[0] || null;
    const msgRef = db.collection('whatsapp_mensagens').doc(m.metaMessageId);
    // O eco da NOSSA resposta volta com o MESMO mid do envio: o doc já existe
    // com enviadoPor = atendente, e sobrescrever com null apagaria a autoria
    // (o relatório conta resposta humana por esse campo). Só o eco de fora
    // (Business Suite) cria doc novo — esse sim com enviadoPor null.
    const ecoJaNosso = eco ? (await msgRef.get()).exists : false;
    if (!ecoJaNosso) {
        await msgRef.set({
            conversaId: m.conversaId,
            direcao: m.direcao,
            tipo: anexo ? anexo.tipo : 'text',
            texto: m.texto,
            // O link da CDN da Meta expira, mas é o que a DM entrega — a tela
            // usa enquanto vale; anexo do Instagram não passa pelo download de
            // mídia do WhatsApp (media id é conceito da WABA, não existe aqui).
            midia: anexo ? { link: anexo.url, mime: null, nomeArquivo: null, baixada: true } : null,
            timestamp: m.timestamp,
            canal: 'instagram',
            // Eco = a Página respondeu por OUTRA plataforma (Business Suite).
            // enviadoPor null é a honestidade de sempre: não se afirma QUEM.
            ...(eco ? { statusEntrega: 'enviado', enviadoPor: null } : {}),
            recebidoEm: agora,
        }, { merge: true });
    }

    const contatoRef = db.collection('whatsapp_contatos').doc(m.conversaId);
    const contato = await contatoRef.get();
    await contatoRef.set({
        numero: m.conversaId,
        canal: 'instagram',
        ...(contato.exists ? {} : { origem: 'instagram', criadoEm: agora, empresaId: null }),
        atualizadoEm: agora,
    }, { merge: true });

    await db.collection('whatsapp_conversas').doc(m.conversaId).set({
        numero: m.conversaId,
        canal: 'instagram',
        ultimaMensagem: { resumo: resumoDaMensagemIg(m), direcao: m.direcao, em: m.timestamp || agora },
        // Só mensagem DO CLIENTE abre/renova a janela e conta não lida — o eco
        // é resposta nossa, não pendência.
        ...(eco ? {} : {
            janela24hAte: janela24hAte(m.timestamp || agora),
            naoLidas: admin.firestore.FieldValue.increment(1),
        }),
        atualizadoEm: agora,
    }, { merge: true });
    return { contatoNovo: !contato.exists, contatoNome: contato.data()?.nomePerfil || null };
}

/**
 * Best-effort: nome/username do perfil do Instagram pro contato recém-criado.
 * Falha NÃO derruba nada — sem perfil a tela mostra "Instagram" e segue.
 */
async function preencherPerfilInstagram(db, conversaId, igsid) {
    try {
        const pag = await paginaDoInstagram();
        if (!pag.ok) return;
        const token = pag.pagina.pageToken;
        if (!token) return;
        const r = await fetch(`${GRAPH_BASE}/${igsid}?fields=name,username`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const corpo = await r.json().catch(() => ({}));
        if (!r.ok) return;
        const nome = corpo.name || (corpo.username ? `@${corpo.username}` : null);
        if (!nome) return;
        await db.collection('whatsapp_contatos').doc(conversaId).set({
            nomePerfil: nome,
            ...(corpo.username ? { igUsername: corpo.username } : {}),
        }, { merge: true });
    } catch (e) {
        console.warn('[whatsapp/instagram] perfil não lido (segue sem nome):', e.message);
    }
}

/**
 * Baixa a mídia recebida pro NOSSO Storage — já na F1, de propósito: a Meta
 * guarda a mídia por tempo LIMITADO, então esperar a F2 perderia anexo de
 * cliente (comprovante de pagamento é o caso típico). Mesmo desenho do XML
 * cru: binário no bucket, `storagePath` no documento.
 *
 * BEST-EFFORT: falha aqui NÃO derruba o webhook (a mensagem já está gravada;
 * responder 500 por causa do anexo faria a Meta reentregar tudo). Falha fica
 * NOMEADA no doc (`downloadErro`) — nunca pendência muda.
 */
async function baixarMidiaRecebida(db, msg) {
    const ref = db.collection('whatsapp_mensagens').doc(msg.metaMessageId);
    try {
        const cfg = configWhatsapp();
        if (!cfg.token) throw new Error('canal sem token (WHATSAPP_CLOUD_TOKEN) — o download usa a mesma credencial do envio');
        const auth = { Authorization: `Bearer ${cfg.token}` };

        // 1) O media id vira uma URL temporária (expira em minutos)…
        const meta = await fetch(`${GRAPH_BASE}/${msg.midia.metaMediaId}`, { headers: auth });
        const corpo = await meta.json().catch(() => ({}));
        if (!meta.ok || !corpo.url) throw new Error(corpo?.error?.message || `HTTP ${meta.status} ao resolver o media id`);

        // 2) …que só entrega o binário com o MESMO token.
        const bin = await fetch(corpo.url, { headers: auth });
        if (!bin.ok) throw new Error(`HTTP ${bin.status} ao baixar o binário`);
        const buf = Buffer.from(await bin.arrayBuffer());

        const caminho = caminhoStorageMidia(msg);
        await storage.bucket(STORAGE_BUCKET).file(caminho).save(buf, {
            contentType: msg.midia.mime || corpo.mime_type || 'application/octet-stream',
            resumable: false,
        });
        await ref.set({
            midia: { ...msg.midia, storagePath: caminho, tamanhoBytes: buf.length, baixadoEm: new Date().toISOString() },
        }, { merge: true });
    } catch (e) {
        console.warn(`[whatsapp/webhook] mídia ${msg.metaMessageId} não baixada:`, e.message);
        try {
            await ref.set({ midia: { ...msg.midia, downloadErro: e.message } }, { merge: true });
        } catch { /* o doc pode nem existir se a gravação falhou antes */ }
    }
}

/** Grava UM status de entrega na mensagem e na auditoria de envio. */
async function gravarStatus(db, st) {
    const agora = new Date().toISOString();
    const statusPt = traduzirStatusEntrega(st.status);
    // A mensagem é lida logo abaixo de qualquer jeito; ler ANTES permite que a
    // frase do erro descreva O QUE foi enviado (o 131053 sem isso é beco).
    const refMsg = db.collection('whatsapp_mensagens').doc(st.metaMessageId);
    const atualMsg = await refMsg.get();
    // O DOCUMENTO inteiro, não só a mídia: é dele que sai também a resposta
    // de QUEM mandou — com os dois apps na WABA, boa parte das falhas que
    // chegam aqui é de mensagem que saiu pela outra plataforma.
    //
    // 🚨 Documento AUSENTE não é dúvida — é prova (caso P. Leal, 20/08): todo
    // envio nosso grava o doc antes de responder, antes de a Meta poder nos
    // chamar com um status. `mensagemDoStatus` é quem faz essa distinção.
    const msgDoc = mensagemDoStatus(atualMsg.exists, atualMsg.data());
    const patch = {
        statusEntrega: statusPt,
        statusEm: st.timestamp || agora,
        ...(st.erro ? {
            erroEntrega: {
                codigo: st.erro.codigo,
                detalhe: st.erro.detalhe || st.erro.titulo || null,
                acao: interpretarErroEntrega(st.erro.codigo, st.erro.detalhe || '', msgDoc),
            },
        } : {}),
    };

    // "lido" não pode regredir pra "entregue" quando a Meta manda os dois fora
    // de ordem — o read implica delivered, então só avança.
    const ref = refMsg;
    const atual = atualMsg;
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

/**
 * AVALIAÇÃO DO ATENDIMENTO — captura a nota 1-5 depois do encerramento.
 * Independente do botAtivo (a pesquisa é disparada pelo ENCERRAMENTO, não
 * pela triagem). SÓ a primeira mensagem após a pesquisa vale: se vier uma
 * nota, grava e agradece; se vier qualquer outra coisa, a espera é limpa —
 * insistir em avaliação é spam, e nota nunca se deduz de texto livre.
 * Devolve true quando a mensagem FOI a nota (o bot não roda em cima dela).
 */
async function capturarAvaliacao(db, msg) {
    try {
        const convRef = db.collection('whatsapp_conversas').doc(msg.de);
        const conversa = (await convRef.get()).data() || {};
        if (!conversa.aguardandoAvaliacao) return false;

        const cfgAval = resolverConfig((await db.collection('whatsapp_config').doc('atendimento').get()).data());
        const leitura = leituraDaNota(msg.texto, cfgAval.avaliacaoEscala);
        const nota = leitura.nota;
        const agora = new Date().toISOString();
        if (nota == null) {
            await convRef.set({ aguardandoAvaliacao: false }, { merge: true });
            // 🚨 NÚMERO FORA DA ESCALA NÃO SOME EM SILÊNCIO. Era o defeito de
            // 17/08: a mensagem pedia "1 a 10", a régua aceitava 1-5, o cliente
            // respondeu 10 e a nota virou null — o painel diria "0 avaliações"
            // com o cliente tendo avaliado. Agora fica registrado, com o que
            // ele respondeu e a escala que valia.
            if (leitura.tipo === 'fora-da-escala') {
                await db.collection('whatsapp_avaliacoes').add({
                    numero: msg.de, nota: null, em: agora,
                    descartada: 'fora-da-escala',
                    informado: leitura.informado, escala: leitura.escala,
                    atendente: conversa.resolvidaPor && conversa.resolvidaPor !== 'cliente' ? conversa.resolvidaPor : null,
                    fila: conversa.fila || conversa.transferidaDe || 'recepcao',
                    protocolo: conversa.protocolo || null,
                }).catch((e) => console.warn('[whatsapp/avaliacao] registro do descarte falhou:', e.message));
                console.warn(`[whatsapp/avaliacao] nota ${leitura.informado} FORA da escala 1-${leitura.escala} (${msg.de}) — texto e régua divergem`);
            }
            return false; // a mensagem é outra coisa — segue o fluxo normal
        }

        await convRef.set({
            aguardandoAvaliacao: false,
            avaliacao: { nota, em: agora },
            atualizadoEm: agora,
        }, { merge: true });
        await db.collection('whatsapp_avaliacoes').add({
            numero: msg.de,
            nota,
            em: agora,
            atendente: conversa.resolvidaPor && conversa.resolvidaPor !== 'cliente' ? conversa.resolvidaPor : null,
            encerradaPor: conversa.resolvidaPor || null,
            fila: conversa.fila || conversa.transferidaDe || 'recepcao',
            protocolo: conversa.protocolo || null,
        });

        // Reusa o cfg já lido acima — duas leituras do mesmo doc no mesmo
        // fluxo é desperdício, e é como duas verdades nascem.
        const config = cfgAval;
        // Pelo MESMO número da conversa (2º número em diante) — canal
        // quebrado só cala o agradecimento, a nota já está gravada.
        const canalEnv = await cfgDeEnvioDaConversa(db, conversa);
        if (canalEnv.erro) { console.warn('[whatsapp/avaliacao] agradecimento não saiu:', canalEnv.erro); return true; }
        const envio = await enviarTextoLivre({ para: msg.de, texto: config.mensagens.avaliacaoObrigado }, canalEnv.cfg ? { cfg: canalEnv.cfg } : {});
        if (envio.ok) {
            await db.collection('whatsapp_mensagens').doc(envio.messageId).set({
                conversaId: msg.de, direcao: 'saida', tipo: 'text',
                texto: config.mensagens.avaliacaoObrigado, midia: null, timestamp: agora,
                statusEntrega: 'enviado', enviadoPor: 'bot',
            }, { merge: true });
        }
        return true;
    } catch (e) {
        console.warn('[whatsapp/avaliacao] falhou (webhook segue intacto):', e.message);
        return false;
    }
}

/**
 * F3 — executa o bot pra UMA mensagem recebida. O cérebro (decidirAutomacao)
 * é puro e testado; aqui é só I/O: ler estado, executar ações, gravar o que
 * o bot respondeu (a resposta do bot entra na thread como mensagem 'saida'
 * com enviadoPor 'bot', senão o atendente não vê o que o cliente recebeu).
 * Best-effort: falha aqui NUNCA derruba o webhook.
 */
/**
 * 🤖 A IA de triagem — o I/O que o cérebro puro não pode ter.
 *
 * Devolve `{ fila, rotulo, confianca, motivo }` SÓ quando tem certeza; em
 * qualquer outro caso devolve `null` e o bot segue como sempre (menu). Nunca
 * lança: falha de IA não pode calar o bot, que é o que responde ao cliente.
 *
 * ⏱️ TEM PRAZO. O cliente está esperando do outro lado, e um modelo lento
 * transformaria "a IA melhorou a triagem" em "o bot demora a responder". Passou
 * do tempo, cai no menu — o pior caso da IA é o comportamento de hoje.
 */
async function triarComIa({ app, config, texto }) {
    try {
        if (!config?.triagemIaAtiva) return null;
        if (!valeClassificar(texto)) return null;         // dígito, "oi", "ok"
        const ai = app?.get?.('ai');
        if (!ai) return null;                             // sem GEMINI_API_KEY

        const filas = filasParaTriagem(config);
        if (!filas.length) return null;

        // O modelo sai do MESMO resolvedor do resto do app (já pina no mais
        // novo da família alvo na conta do Paulo). Cravar um id aqui seria a
        // segunda régua do modelo, que já custou caro em 15/08.
        const modelos = app.get('geminiModelos');
        const modelo = (typeof modelos === 'function' ? modelos().flash : null) || undefined;

        const corrida = ai.models.generateContent({
            model: modelo,
            contents: montarPromptTriagem({ texto, filas }),
            // temperatura 0: classificação não é criatividade. E SEM grounding
            // de propósito — a IA aqui não busca nada, ela lê a frase e escolhe
            // da lista. Busca abriria a porta para ela "saber" matéria fiscal.
            config: { temperature: 0 },
        });
        const prazo = new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), TEMPO_MAX_TRIAGEM_MS));
        const r = await Promise.race([corrida, prazo]);

        const destino = decidirDestinoDaTriagem({
            resultado: interpretarRespostaTriagem(r?.text ?? '', filas),
            filas,
        });
        if (destino.situacao !== 'classificada') {
            // Não é erro — é a IA sendo honesta. Fica no log porque é assim
            // que se descobre que a triagem parou de pegar (silêncio aqui
            // faria "a IA não está funcionando" virar palpite).
            console.log('[whatsapp/triagem-ia]', destino.situacao, JSON.stringify(destino));
            return null;
        }
        return destino;
    } catch (e) {
        console.warn('[whatsapp/triagem-ia] falhou (bot segue no menu):', e.message);
        return null;
    }
}

/** Teto de espera da IA — passou disso, o cliente recebe o menu. */
const TEMPO_MAX_TRIAGEM_MS = 6000;

async function rodarBot(db, msg, deps = {}) {
    try {
        const cfgDoc = await db.collection('whatsapp_config').doc('atendimento').get();
        const config = resolverConfig(cfgDoc.data());
        if (!config.botAtivo) return;

        const convRef = db.collection('whatsapp_conversas').doc(msg.de);
        const conversa = (await convRef.get()).data() || {};
        // O bot responde pelo MESMO número em que o cliente falou (2º número
        // em diante). Canal quebrado cala o bot NESTA conversa, nomeado no
        // log — responder pelo número errado seria pior que não responder.
        const canalEnv = await cfgDeEnvioDaConversa(db, conversa);
        if (canalEnv.erro) { console.warn('[whatsapp/bot] bot calado nesta conversa:', canalEnv.erro); return; }
        const depsEnvio = canalEnv.cfg ? { cfg: canalEnv.cfg } : {};
        // 🤖 A IA só é consultada no MESMO estado em que o bot mostraria o
        // menu: conversa sem fila, sem dono e sem sub-menu aberto. Fora disso
        // a mensagem tem outro significado (resposta ao atendente, escolha de
        // sub-menu) e perguntar seria gastar chamada para atrapalhar.
        const emTriagem = !conversa.fila && !conversa.atribuidoA && !conversa.submenuAberto;
        const filaSugerida = emTriagem
            ? await triarComIa({ app: deps.app, config, texto: msg.texto })
            : null;

        const acoes = decidirAutomacao({
            // `numero` decide o ALCANCE: no modo piloto o bot só responde aos
            // números cadastrados — é o que deixa a Ultra Fox de pé sem o
            // cliente receber menu em dobro.
            conversa, numero: msg.de, textoMensagem: msg.texto, nomeContato: msg.nomePerfil,
            config, agora: new Date(), protocoloNovo: gerarProtocolo(),
            filaSugerida,
        });

        for (const acao of acoes) {
            const agora = new Date().toISOString();
            if (acao.tipo === 'definirFila') {
                // Fila escolhida FECHA o sub-menu junto — estado de sub-menu
                // sobrando faria o próximo dígito do cliente cair no lugar errado.
                await convRef.set({ fila: acao.fila, submenuAberto: null, atualizadoEm: agora }, { merge: true });
            } else if (acao.tipo === 'gravarProtocolo') {
                await convRef.set({ protocolo: acao.protocolo, atualizadoEm: agora }, { merge: true });
            } else if (acao.tipo === 'marcarAusenciaEnviada') {
                await convRef.set({ ausenciaAvisadaEm: acao.dia }, { merge: true });
            } else if (acao.tipo === 'abrirSubmenu') {
                await convRef.set({ submenuAberto: String(acao.opcao), atualizadoEm: agora }, { merge: true });
            } else if (acao.tipo === 'fecharSubmenu') {
                await convRef.set({ submenuAberto: null, atualizadoEm: agora }, { merge: true });
            } else if (acao.tipo === 'resetarTriagem') {
                // #menu zera a triagem INTEIRA — inclusive sub-menu aberto.
                await convRef.set({ fila: null, submenuAberto: null, atualizadoEm: agora }, { merge: true });
            } else if (acao.tipo === 'liberarConducao') {
                // Cliente pediu #menu: a conversa volta pra triagem SEM dono,
                // igual à transferência. Quem conduzia continua no histórico.
                await convRef.set({ atribuidoA: null, atualizadoEm: agora }, { merge: true });
            } else if (acao.tipo === 'resolverConversa') {
                await convRef.set({ status: 'resolvida', resolvidaPor: acao.por || 'cliente', atualizadoEm: agora }, { merge: true });
            } else if (acao.tipo === 'marcarAguardandoAvaliacao') {
                await convRef.set({ aguardandoAvaliacao: true }, { merge: true });
            } else if (acao.tipo === 'enviarImagem') {
                // Banner do departamento: URL PÚBLICA nossa (gravada na ⚙️),
                // nunca mediaId — é a imagem FIXA reenviada sempre, e a Meta
                // busca por link sob demanda, sem depender de upload prévio
                // nem de quanto tempo um mediaId permanece válido lá.
                const envio = await enviarMidiaWhatsapp({ para: msg.de, tipo: 'image', link: acao.url }, depsEnvio);
                if (envio.ok) {
                    await db.collection('whatsapp_mensagens').doc(envio.messageId).set({
                        conversaId: msg.de, direcao: 'saida', tipo: 'image',
                        texto: null,
                        midia: { nomeArquivo: null, mime: 'image/*', baixada: true, link: acao.url },
                        timestamp: agora, statusEntrega: 'enviado', enviadoPor: 'bot',
                    }, { merge: true });
                    await convRef.set({
                        ultimaMensagem: { resumo: '🖼️ Imagem', direcao: 'saida', em: agora },
                        atualizadoEm: agora,
                    }, { merge: true });
                } else {
                    console.warn('[whatsapp/bot] imagem de fila não saiu:', envio.erro);
                }
            } else if (acao.tipo === 'responder') {
                const envio = await enviarTextoLivre({ para: msg.de, texto: acao.texto }, depsEnvio);
                if (envio.ok) {
                    await db.collection('whatsapp_mensagens').doc(envio.messageId).set({
                        conversaId: msg.de, direcao: 'saida', tipo: 'text',
                        texto: acao.texto, midia: null, timestamp: agora,
                        statusEntrega: 'enviado', enviadoPor: 'bot',
                    }, { merge: true });
                    await convRef.set({
                        ultimaMensagem: { resumo: acao.texto.slice(0, 140), direcao: 'saida', em: agora },
                        atualizadoEm: agora,
                    }, { merge: true });
                } else {
                    console.warn('[whatsapp/bot] resposta não saiu:', envio.erro);
                }
            } else if (acao.tipo === 'registrarTriagemIa') {
                // 🤖 CARIMBO DA ORIGEM — a mesma régua do resto da casa: valor
                // que o app DEDUZIU nunca se confunde com valor que a pessoa
                // informou. Aqui a diferença é operacional: quem assume a
                // conversa precisa saber que o encaminhamento foi automático,
                // porque automático pode estar errado e o cliente não escolheu.
                await convRef.set({
                    triagemIa: {
                        fila: acao.fila, confianca: acao.confianca ?? null,
                        motivo: acao.motivo || null, em: agora,
                    },
                }, { merge: true });
                // Nota INTERNA (o cliente não vê) na própria thread: é onde o
                // atendente olha, e sem ela o carimbo ficaria num campo que
                // nenhuma tela lê — a "flag que ninguém lê" de 22/08.
                await db.collection('whatsapp_mensagens').add({
                    conversaId: msg.de, direcao: 'interna', tipo: 'nota',
                    texto: `🤖 Encaminhado pela IA para ${acao.fila}`
                        + (acao.confianca != null ? ` (confiança ${Math.round(acao.confianca * 100)}%)` : '')
                        + (acao.motivo ? ` — ${acao.motivo}` : '')
                        + '. O cliente não escolheu no menu: confira se é a fila certa.',
                    midia: null, timestamp: agora, statusEntrega: null, enviadoPor: 'bot',
                });
            }
        }
    } catch (e) {
        console.warn('[whatsapp/bot] falhou (webhook segue intacto):', e.message);
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
    // As DUAS chaves valem: a do app principal (WhatsApp/Messenger) e a do
    // app do Instagram do caso de uso "login do Instagram" — cada produto
    // assina o MESMO endpoint com a sua. Recusar a segunda foi o que deixaria
    // a DM invisível até pro diagnóstico (401 antes do evento cru).
    if (!assinaturaValida(req.rawBody, req.headers['x-hub-signature-256'], [cfg.appSecret, cfg.instagramAppSecret])) {
        console.warn('[whatsapp/webhook POST] assinatura inválida — descartado');
        // 📋 O 401 fica GRAVADO (um doc só, sem o payload — corpo não
        // assinado é conteúdo não confiável): "a Meta bateu e a chave não
        // conferiu" e "a Meta nunca bateu" eram o MESMO silêncio, e é
        // exatamente a diferença entre INSTAGRAM_APP_SECRET errada e o
        // webhook do caso de uso nem configurado.
        setImmediate(async () => {
            try {
                await getDb().collection('whatsapp_config').doc('webhook_post_recusado').set({
                    em: new Date().toISOString(),
                    motivo: 'assinatura-nao-confere',
                    objeto: typeof req.body?.object === 'string' ? String(req.body.object).slice(0, 60) : null,
                });
            } catch (e) {
                console.warn('[whatsapp/webhook POST] diagnóstico do 401 não gravado:', e.message);
            }
        });
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

        // ── 📷 Instagram: MESMO endpoint, outro objeto ──────────────────────
        // A assinatura já foi validada (o app secret assina TODOS os webhooks
        // do app). DM entra nas MESMAS coleções com id ig_{IGSID}; o bot NÃO
        // roda (decisão registrada no instagram-dm.js) — triagem é humana.
        if (req.body?.object === 'instagram') {
            const ig = extrairEventosInstagram(req.body);
            const gravadas = [];
            for (const m of ig.mensagens) {
                const r = await gravarMensagemInstagram(db, m);
                gravadas.push({ m, ...r });
            }
            const entradas = gravadas.filter((g) => g.m.direcao === 'entrada');
            if (gravadas.length) {
                setImmediate(async () => {
                    for (const g of gravadas) {
                        if (g.contatoNovo) await preencherPerfilInstagram(db, g.m.conversaId, g.m.igsid);
                    }
                    for (const g of entradas) {
                        try {
                            const conversa = (await db.collection('whatsapp_conversas').doc(g.m.conversaId).get()).data() || {};
                            const cfgDoc = await db.collection('whatsapp_config').doc('atendimento').get();
                            await notificarMensagem({
                                msg: { de: g.m.conversaId, nomePerfil: g.contatoNome, texto: g.m.texto, midia: g.m.anexos[0] || null },
                                conversa, config: resolverConfig(cfgDoc.data()), canalRotulo: 'Instagram',
                            });
                        } catch (e) {
                            console.warn('[whatsapp/push] IG falhou (webhook intacto):', e.message);
                        }
                    }
                });
            }
            return res.status(200).json({ ok: true, instagram: gravadas.length });
        }

        // 2) Extrai e grava.
        const ev = extrairEventos(req.body);
        if (!ev.valido) {
            console.warn('[whatsapp/webhook POST] payload fora do esperado:', ev.motivo);
            return res.sendStatus(200); // assinado pela Meta, mas não é da WABA — nada a fazer
        }
        const catalogo = await catalogoDeCanais(db);
        for (const msg of ev.mensagens) await gravarMensagemRecebida(db, msg, catalogo);
        for (const st of ev.statuses) await gravarStatus(db, st);

        // ── ☎️ Eventos de CHAMADA (field "calls") — viram linha na conversa.
        // O extrator é tolerante e o ilegível volta NOMEADO no log (o cru já
        // está em whatsapp_webhook_eventos, gravado no passo 1).
        const ch = extrairEventosChamada(req.body);
        const chamadasGravadas = [];
        for (const c of ch.chamadas) {
            const g = await gravarEventoChamada(db, c);
            chamadasGravadas.push({ c, ...g });
        }
        if (ch.ilegiveis.length) {
            console.warn('[whatsapp/chamadas] eventos de chamada ilegíveis:', ch.ilegiveis.length,
                '— o cru está em whatsapp_webhook_eventos (é dele que sai a régua).');
        }
        // 🔔 Ligação do cliente notifica como mensagem — MESMA régua de filas e
        // horário do push (a regra do Paulo vale aqui também). Best-effort.
        const chamadasNovasDoCliente = chamadasGravadas.filter((g) => !g.jaExiste && g.c.direcao === 'entrada');
        if (chamadasNovasDoCliente.length) {
            setImmediate(async () => {
                for (const g of chamadasNovasDoCliente) {
                    try {
                        const conversa = (await db.collection('whatsapp_conversas').doc(g.c.conversaId).get()).data() || {};
                        const cfgDoc = await db.collection('whatsapp_config').doc('atendimento').get();
                        await notificarMensagem({
                            msg: { de: g.c.conversaId, nomePerfil: null, texto: resumoDaChamada(g.c), midia: null },
                            conversa, config: resolverConfig(cfgDoc.data()),
                        });
                    } catch (e) {
                        console.warn('[whatsapp/push] chamada falhou (webhook intacto):', e.message);
                    }
                }
            });
        }

        // Mídia DEPOIS da resposta (setImmediate, padrão da casa): a Meta quer
        // o 200 rápido, e o anexo é best-effort — a mensagem já está gravada.
        const comMidia = ev.mensagens.filter((m) => m.midia?.metaMediaId);
        if (comMidia.length) {
            setImmediate(async () => {
                for (const m of comMidia) await baixarMidiaRecebida(db, m);
            });
        }

        // ── F3: o BOT (triagem/saudação/ausência) — também pós-200 ─────────
        // decidirAutomacao é puro; aqui só se executa. Com botAtivo=false
        // (o padrão) NADA responde — a plataforma atual segue sozinha.
        if (ev.mensagens.length) {
            setImmediate(async () => {
                for (const msg of ev.mensagens) {
                    // A avaliação vem ANTES do bot: se a mensagem for a nota
                    // da pesquisa, ela não pode virar gatilho de triagem.
                    const foiNota = await capturarAvaliacao(db, msg);
                    // `req.app` viaja porque é dele que sai o cliente do
                    // Gemini e o resolvedor de modelo (a IA de triagem).
                    if (!foiNota) await rodarBot(db, msg, { app: req.app });
                    // 🔔 Push no celular (a régua de QUEM recebe é a mesma
                    // fila do inbox). Best-effort: a mensagem já está salva.
                    try {
                        const conversa = (await db.collection('whatsapp_conversas').doc(msg.de).get()).data() || {};
                        const cfgDoc = await db.collection('whatsapp_config').doc('atendimento').get();
                        await notificarMensagem({ msg, conversa, config: resolverConfig(cfgDoc.data()) });
                    } catch (e) {
                        console.warn('[whatsapp/push] falhou (webhook intacto):', e.message);
                    }
                }
            });
        }

        return res.status(200).json({ ok: true, mensagens: ev.mensagens.length, statuses: ev.statuses.length, chamadas: ch.chamadas.length });
    } catch (e) {
        // 500 de propósito: a Meta reentrega e a gravação é idempotente.
        console.error('[whatsapp/webhook POST]', e);
        return res.sendStatus(500);
    }
});

export default router;
