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
import { montarCatalogoCanais, canalDoEvento, normalizarCanalCadastrado } from './whatsapp-canais.js';
import { notificarMensagem } from './whatsapp-push-envio.js';
import { extrairEventosInstagram, resumoDaMensagemIg, paginaDoInstagram } from './instagram-dm.js';

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
    }, { merge: true });
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
        const envio = await enviarTextoLivre({ para: msg.de, texto: config.mensagens.avaliacaoObrigado });
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
async function rodarBot(db, msg) {
    try {
        const cfgDoc = await db.collection('whatsapp_config').doc('atendimento').get();
        const config = resolverConfig(cfgDoc.data());
        if (!config.botAtivo) return;

        const convRef = db.collection('whatsapp_conversas').doc(msg.de);
        const conversa = (await convRef.get()).data() || {};
        const acoes = decidirAutomacao({
            // `numero` decide o ALCANCE: no modo piloto o bot só responde aos
            // números cadastrados — é o que deixa a Ultra Fox de pé sem o
            // cliente receber menu em dobro.
            conversa, numero: msg.de, textoMensagem: msg.texto, nomeContato: msg.nomePerfil,
            config, agora: new Date(), protocoloNovo: gerarProtocolo(),
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
                const envio = await enviarMidiaWhatsapp({ para: msg.de, tipo: 'image', link: acao.url });
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
                const envio = await enviarTextoLivre({ para: msg.de, texto: acao.texto });
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
                    if (!foiNota) await rodarBot(db, msg);
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

        return res.status(200).json({ ok: true, mensagens: ev.mensagens.length, statuses: ev.statuses.length });
    } catch (e) {
        // 500 de propósito: a Meta reentrega e a gravação é idempotente.
        console.error('[whatsapp/webhook POST]', e);
        return res.sendStatus(500);
    }
});

export default router;
