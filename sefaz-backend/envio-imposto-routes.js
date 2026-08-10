// ============================================================================
// sefaz-backend/envio-imposto-routes.js  (ESM)
// ----------------------------------------------------------------------------
// Rotas da ORDEM TÉCNICA do envio de imposto (ver envio-imposto.js):
//   POST /api/admin/envio-imposto/registrar — registra um envio feito pelo
//        colaborador (mailto/whatsapp/portal) e executa o rito completo:
//        cópia no SharePoint (pasta IMPOSTOS) + baixa da obrigação + auditoria.
//        O envio via Graph do DAS chama o rito direto no server.js.
//   GET  /api/admin/envio-imposto/historico — auditoria (impostos_enviados).
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { podeAcessarCnpj } from './carteira-auth.js';
import { montarPainelEnvios } from './envio-imposto-painel.js';
import { executarRitoEnvioImposto, GESTOR_EMAIL } from './envio-imposto.js';
import { enviarEmail } from './graph-provider.js';
import { montarEmailGuia, anexoLogo } from './email-layout.js';
import { parseDestinatarios } from './email-destinatarios-helper.js';
import { escolherRemetente, dominiosPermitidos, ehErroDeCaixaInexistente } from './graph-remetente.js';
import { enviarGuiaWhatsapp, configWhatsapp, faltasDaConfig } from './whatsapp-cloud.js';

const router = Router();

/** Base64 do PDF sem o prefixo data: e sem quebras. */
function limparPdf(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    return s.replace(/^data:application\/pdf;base64,/i, '').replace(/\s+/g, '');
}

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

router.post('/registrar', requireAuth, async (req, res) => {
    try {
        const {
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            canal, para, pdfBase64, pdfFileName, valor,
        } = req.body || {};
        if (!empresaCnpj || !tipo || !competencia) {
            return res.status(400).json({ ok: false, error: 'empresaCnpj + tipo + competencia são obrigatórios' });
        }
        const acesso = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        const r = await executarRitoEnvioImposto({
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            canal: canal || 'email-app',
            para: para || null,
            pdfBase64, pdfFileName,
            valor,
            enviadoPor: req.user?.email || req.user?.uid || null,
        });
        console.log(`[envio-imposto] ${tipo} ${empresaCnpj} ${competencia} via ${canal || 'email-app'} por ${req.user?.email} — sp=${r.sharePoint.status} baixa=${r.baixa.status}`);
        return res.json({ ok: true, gestor: GESTOR_EMAIL, ...r });
    } catch (e) {
        console.error('[envio-imposto/registrar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/admin/envio-imposto/enviar-graph
//
// Envio PELO SERVIDOR de qualquer guia (DARF, DARE, …) — o que o DAS já tinha
// e DARF/DARE não. Diferença que importa pra equipe (05/08): aqui o app ENVIA
// (Graph aceita e a cópia fica em Itens Enviados), então existe PROVA; o
// mailto/Outlook Web só abre a composição.
//
// O remetente é a caixa do COLABORADOR que clicou (Paulo, 05/08: o cliente
// respondia ao dono achando que era ele quem mandava). Caixa inexistente no
// tenant não derruba a entrega: refaz pela caixa institucional e o payload DIZ
// que caiu no fallback.
// ────────────────────────────────────────────────────────────────────────────
router.post('/enviar-graph', requireAuth, async (req, res) => {
    try {
        const {
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            para, assunto, mensagem, pdfBase64, pdfFileName, valor, vencimento,
        } = req.body || {};
        if (!empresaCnpj || !tipo || !competencia) {
            return res.status(400).json({ ok: false, error: 'empresaCnpj + tipo + competencia são obrigatórios' });
        }
        if (!para || !String(para).includes('@')) {
            return res.status(400).json({ ok: false, error: 'E-mail do cliente ausente — preencha em Dados Fiscais da empresa.' });
        }
        if (!mensagem) return res.status(400).json({ ok: false, error: 'Mensagem obrigatória.' });

        const acesso = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        const pdfLimpo = limparPdf(pdfBase64);
        if (pdfLimpo && pdfLimpo.length > 4_000_000) {
            return res.status(413).json({ ok: false, error: 'PDF muito grande para envio automático por e-mail.' });
        }

        const padrao = process.env.GRAPH_REMETENTE || process.env.NOTIF_REMETENTE_EMAIL || 'junior@spassessoriacontabil.com.br';
        const escolha = escolherRemetente({
            emailColaborador: req.user?.email,
            padrao,
            dominios: dominiosPermitidos(),
        });

        const bcc = parseDestinatarios(process.env.DAS_ENVIO_BCC || process.env.DAS_ENVIO_CC, GESTOR_EMAIL)
            .filter((c) => c.toLowerCase() !== String(para).trim().toLowerCase());

        const assuntoFinal = assunto || `${String(tipo).toUpperCase()} ${competencia} — ${empresaNome || ''}`.trim();
        const corpoHtml = montarEmailGuia({
            tipo: String(tipo).toUpperCase(),
            empresaNome, competencia, mensagem,
            temPdf: Boolean(pdfLimpo),
            vencimento: vencimento || null,
        });
        const anexos = [
            ...(pdfLimpo ? [{
                name: pdfFileName || `${String(tipo).toLowerCase()}_${String(empresaCnpj).replace(/\D/g, '')}_${competencia}.pdf`,
                contentType: 'application/pdf',
                contentBytes: pdfLimpo,
            }] : []),
            ...anexoLogo(),
        ];

        let remetente = escolha.remetente;
        let fonteRemetente = escolha.fonte;
        let avisoRemetente = escolha.motivo;
        let envio = await enviarEmail({ remetente, para, bcc, assunto: assuntoFinal, corpoHtml, anexos });

        if (!envio.ok && fonteRemetente === 'colaborador' && ehErroDeCaixaInexistente(envio.error)) {
            // A caixa do colaborador não existe/não envia — a guia do cliente
            // não pode ficar presa por isso.
            avisoRemetente = `a caixa ${remetente} não pôde enviar; usamos ${padrao}`;
            remetente = padrao;
            fonteRemetente = 'padrao';
            envio = await enviarEmail({ remetente, para, bcc, assunto: assuntoFinal, corpoHtml, anexos });
        }
        if (!envio.ok) return res.status(502).json({ ok: false, error: envio.error || 'Falha ao enviar o e-mail.' });

        const rito = await executarRitoEnvioImposto({
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            canal: 'email-graph',
            para,
            pdfBase64: pdfLimpo || undefined,
            pdfFileName,
            valor,
            enviadoPor: req.user?.email || req.user?.uid || null,
            copiaPara: bcc,
        });
        console.log(`[envio-imposto/graph] ${tipo} ${empresaCnpj} ${competencia} de ${remetente} (${fonteRemetente}) → ${para}`);
        return res.json({
            ok: true, gestor: GESTOR_EMAIL,
            remetente, fonteRemetente, avisoRemetente,
            copiaPara: bcc, anexouPdf: Boolean(pdfLimpo),
            ...rito,
        });
    } catch (e) {
        console.error('[envio-imposto/enviar-graph]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/admin/envio-imposto/whatsapp-status
//
// O botão da tela pergunta ANTES de mostrar: canal pronto? Se não, a resposta
// lista o que falta — botão que some ensina a equipe que a função não existe.
// ────────────────────────────────────────────────────────────────────────────
router.get('/whatsapp-status', requireAuth, (_req, res) => {
    const faltas = faltasDaConfig(configWhatsapp());
    return res.json({ ok: true, pronto: faltas.length === 0, faltas });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/admin/envio-imposto/enviar-whatsapp
//
// Envio PELO SERVIDOR via WhatsApp OFICIAL (Cloud API, WABA da própria S&P) —
// pedido do Paulo (09/08): mesmo controle do e-mail. A Meta devolve o id da
// mensagem = PROVA de envio (≠ wa.me, que só abre a composição). Depois do
// aceite roda o MESMO rito #293: SharePoint (canal whatsapp-api), baixa da
// obrigação (farol sai do vermelho), auditoria — e o GESTOR é notificado por
// e-mail Graph (WhatsApp não tem BCC; a notificação vai pelo canal que prova).
// ────────────────────────────────────────────────────────────────────────────
router.post('/enviar-whatsapp', requireAuth, async (req, res) => {
    try {
        const {
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            paraWhatsapp, pdfBase64, pdfFileName, valor, vencimento,
        } = req.body || {};
        if (!empresaCnpj || !tipo || !competencia) {
            return res.status(400).json({ ok: false, error: 'empresaCnpj + tipo + competencia são obrigatórios' });
        }
        if (!paraWhatsapp) {
            return res.status(400).json({ ok: false, error: 'WhatsApp do cliente ausente — preencha no cadastro da empresa.' });
        }
        const acesso = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        const pdfLimpo = limparPdf(pdfBase64);
        const nomeArquivo = pdfFileName || `${String(tipo).toLowerCase()}_${String(empresaCnpj).replace(/\D/g, '')}_${competencia}.pdf`;

        // Variáveis na ordem do template envio_guia_imposto:
        // {{1}} cliente · {{2}} tipo da guia · {{3}} competência · {{4}} vencimento
        const envio = await enviarGuiaWhatsapp({
            para: paraWhatsapp,
            variaveis: [empresaNome || 'cliente', String(tipo).toUpperCase(), competencia, vencimento || 'no documento'],
            pdfBase64: pdfLimpo || null,
            nomeArquivo,
        });
        if (!envio.ok) {
            const status = envio.configuracaoIncompleta ? 503 : envio.indeterminado ? 502 : 422;
            return res.status(status).json({ ok: false, error: envio.erro, acao: envio.acao, indeterminado: Boolean(envio.indeterminado) });
        }

        const rito = await executarRitoEnvioImposto({
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            canal: 'whatsapp-api',
            para: envio.numeroEnviado,
            pdfBase64: pdfLimpo || undefined,
            pdfFileName: nomeArquivo,
            valor,
            enviadoPor: req.user?.email || req.user?.uid || null,
            whatsappMessageId: envio.messageId,
        });

        // Gestor SEMPRE sabe do envio — por e-mail Graph, o canal que prova.
        let gestorNotificado = false;
        try {
            const padrao = process.env.GRAPH_REMETENTE || process.env.NOTIF_REMETENTE_EMAIL || 'junior@spassessoriacontabil.com.br';
            const corpoHtml = montarEmailGuia({
                tipo: String(tipo).toUpperCase(), empresaNome, competencia,
                mensagem: `Guia enviada ao cliente pelo WHATSAPP OFICIAL (número ${envio.numeroEnviado}, mensagem ${envio.messageId}) por ${req.user?.email || 'colaborador'}. Esta é a cópia de controle do gestor.`,
                temPdf: Boolean(pdfLimpo), vencimento: vencimento || null,
            });
            const n = await enviarEmail({
                remetente: padrao, para: GESTOR_EMAIL,
                assunto: `[WhatsApp] ${String(tipo).toUpperCase()} ${competencia} — ${empresaNome || empresaCnpj}`,
                corpoHtml,
                anexos: pdfLimpo ? [{ name: nomeArquivo, contentType: 'application/pdf', contentBytes: pdfLimpo }] : [],
            });
            gestorNotificado = Boolean(n?.ok);
        } catch { /* a falha da cópia não desfaz o envio — aparece no payload */ }

        console.log(`[envio-imposto/whatsapp] ${tipo} ${empresaCnpj} ${competencia} → ${envio.numeroEnviado} (${envio.messageId}) gestor=${gestorNotificado}`);
        return res.json({
            ok: true, gestor: GESTOR_EMAIL, gestorNotificado,
            whatsappMessageId: envio.messageId, numeroEnviado: envio.numeroEnviado,
            ...rito,
        });
    } catch (e) {
        console.error('[envio-imposto/enviar-whatsapp]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/historico', requireAuth, async (req, res) => {
    try {
        const cnpj = String(req.query.cnpj || '').replace(/\D/g, '');
        const limite = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);
        const db = fa().firestore();
        let q = db.collection('impostos_enviados');
        if (cnpj) q = q.where('empresaCnpj', '==', cnpj);
        const snap = await q.limit(limite).get();
        const envios = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => {
                const ta = a.enviadoEm?.toMillis?.() || 0;
                const tb = b.enviadoEm?.toMillis?.() || 0;
                return tb - ta;
            })
            .map((x) => ({ ...x, enviadoEm: x.enviadoEm?.toDate?.()?.toISOString?.() || null }));
        return res.json({ ok: true, envios });
    } catch (e) {
        console.error('[envio-imposto/historico]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Painel do rito (#293): quantos envios saíram COMPLETOS na competência e,
 * quando não saíram, a causa agrupada com a ação. Admin — é visão de gestão.
 */
router.get('/painel', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ ok: false, error: 'Apenas administradores' });
        const competencia = String(req.query.competencia || '').trim() || null;
        const db = fa().firestore();
        // Sem índice composto: filtra a competência em memória (o volume é de
        // dezenas por mês, não de milhares).
        const snap = await db.collection('impostos_enviados').limit(2000).get();
        const envios = snap.docs.map((d) => {
            const x = d.data();
            return { id: d.id, ...x, enviadoEm: x.enviadoEm?.toDate?.()?.toISOString?.() || null };
        });
        const painel = montarPainelEnvios(envios, { competencia });
        return res.json({ ok: true, gestor: GESTOR_EMAIL, ...painel });
    } catch (e) {
        console.error('[envio-imposto/painel]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
