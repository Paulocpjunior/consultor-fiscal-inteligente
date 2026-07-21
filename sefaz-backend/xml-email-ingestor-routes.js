// ============================================================================
// sefaz-backend/xml-email-ingestor-routes.js  (ESM)
//
// Ingestão de XML por e-mail (o "cofre" do CFI que substitui o da SIEG).
//
//   POST /api/admin/sefaz/xml-email-ingest-cron  (x-cron-secret)  — automático
//   POST /api/admin/sefaz/xml-email-ingest       (requireAdmin)   — manual/UI
//   GET  /api/admin/sefaz/xml-email-ingest/status     (requireAdmin) — último resumo
//   GET  /api/admin/sefaz/xml-email-ingest/historico  (requireAdmin) — runs + KPIs
//   GET  /api/admin/sefaz/xml-email-ingest/pendencias (requireAdmin) — e-mails travados
//   POST /api/admin/sefaz/xml-email-ingest/alerta-cron (x-cron-secret) — alertas
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { secretsMatch } from './cron-secret.js';
import { ingerirXmlPorEmail } from './xml-email-ingestor.js';
import { arquivarNoSharePoint } from './cofre-sharepoint-arquivo.js';
import { listarEmailsComXml } from './graph-mail-reader.js';
import { agregarKpisDeRuns } from './cofre-email-metrics.js';
import { detectarInatividade, decidirAlertasCofre, montarCorpoAlerta } from './cofre-alerta.js';
import { enviarEmail, isGraphConfigured } from './graph-provider.js';
import { parseDestinatarios } from './email-destinatarios-helper.js';

const router = express.Router();

const CAIXA = process.env.XML_INGEST_MAILBOX || 'xml@spassessoriacontabil.com.br';
const REMETENTE = process.env.GRAPH_REMETENTE || 'junior@spassessoriacontabil.com.br';
// Destinatário padrão dos alertas (gancho: por-empresa via responsável entra depois).
const ALERTA_PARA = parseDestinatarios(process.env.COFRE_ALERT_TO, REMETENTE);
const INATIVIDADE_DIAS = Math.max(Number(process.env.COFRE_INATIVIDADE_DIAS) || 7, 1);

function getDb() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin.firestore();
}

function requireCronAuth(req, res, next) {
  const secret = process.env.SEFAZ_CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'Cron secret not configured' });
  const header = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'];
  if (secretsMatch(header, secret)) return next();
  return res.status(403).json({ error: 'Cron auth failed' });
}

router.post('/xml-email-ingest-cron', requireCronAuth, async (req, res) => {
  try {
    const r = await ingerirXmlPorEmail({ capturadoPor: { uid: 'cron', email: 'xml-email-ingest-cron' } });
    // Falha lógica (ex.: 403 sem Mail.ReadWrite, caixa inexistente) NÃO pode
    // voltar 200 — senão o cliente a lê como sucesso e o erro some.
    if (r && r.ok === false) return res.status(502).json(r);
    return res.json(r);
  } catch (e) {
    console.error('[xml-email-ingest-cron] erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.post('/xml-email-ingest', requireAdmin, async (req, res) => {
  try {
    const { mailbox, maxMensagens } = req.body || {};
    const r = await ingerirXmlPorEmail({
      mailbox: mailbox || null,
      maxMensagens: Number(maxMensagens) || undefined,
      capturadoPor: { uid: req.user?.uid || null, email: req.user?.email || 'admin' },
    });
    if (r && r.ok === false) return res.status(502).json(r);
    return res.json(r);
  } catch (e) {
    console.error('[xml-email-ingest] erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.get('/xml-email-ingest/status', requireAdmin, async (req, res) => {
  try {
    const snap = await getDb().doc('sefaz_xml_email_state/estado').get();
    return res.json({ ok: true, caixa: CAIXA, estado: snap.exists ? snap.data() : null });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Histórico das execuções + KPIs agregados (Fase 1 — painel de controle).
router.get('/xml-email-ingest/historico', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 500);
    const snap = await getDb().collection('cofre_email_runs')
      .orderBy('ranAtMs', 'desc').limit(limit).get();
    const runs = snap.docs.map((d) => d.data());
    const kpis = agregarKpisDeRuns(runs, Date.now(), 14);
    return res.json({ ok: true, caixa: CAIXA, kpis, runs });
  } catch (e) {
    console.error('[xml-email-ingest/historico]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// Pendências AO VIVO: e-mails não-lidos com anexo mas SEM .xml importável
// (PDF, encaminhado, etc.). Leitura sem marcar/importar nada.
router.get('/xml-email-ingest/pendencias', requireAdmin, async (req, res) => {
  try {
    const msgs = await listarEmailsComXml(CAIXA, { maxMensagens: 50 });
    const pendencias = msgs
      .filter((m) => m.anexosXml.length === 0 && (m.anexosInfo || []).length > 0)
      .map((m) => ({
        assunto: m.subject || '(sem assunto)',
        from: m.from || null,
        recebidoEm: m.recebidoEm || null,
        anexos: (m.anexosInfo || []).map((a) => `${a.name} [${a.tipo}]`),
      }));
    return res.json({ ok: true, caixa: CAIXA, total: pendencias.length, pendencias });
  } catch (e) {
    console.error('[xml-email-ingest/pendencias]', e.message);
    return res.status(502).json({ ok: false, error: `Falha lendo a caixa: ${e.message}` });
  }
});

// Alertas (Fase 2): erros de import + pendências + inatividade. Anti-spam por
// assinatura. Destinatário padrão hoje; gancho por-empresa (responsável) depois.
router.post('/xml-email-ingest/alerta-cron', requireCronAuth, async (req, res) => {
  try {
    const db = getDb();
    const estadoRef = db.doc('sefaz_xml_email_state/estado');
    const estadoSnap = await estadoRef.get();
    const estado = estadoSnap.exists ? estadoSnap.data() : {};

    // Última run (erros/errosDetalhe).
    const runSnap = await db.collection('cofre_email_runs').orderBy('ranAtMs', 'desc').limit(1).get();
    const ultimaRun = runSnap.empty ? null : runSnap.docs[0].data();

    // Pendências ao vivo (best-effort: se a caixa falhar, segue sem elas).
    let pendencias = [];
    try {
      const msgs = await listarEmailsComXml(CAIXA, { maxMensagens: 50 });
      pendencias = msgs.filter((m) => m.anexosXml.length === 0 && (m.anexosInfo || []).length > 0)
        .map((m) => ({ assunto: m.subject || '(sem assunto)', from: m.from || null, anexos: (m.anexosInfo || []).map((a) => `${a.name} [${a.tipo}]`) }));
    } catch (e) {
      console.warn('[cofre-alerta] pendências indisponíveis:', e.message);
    }

    const inativos = detectarInatividade(estado.ultimaSaidaPorEmpresa || {}, Date.now(), INATIVIDADE_DIAS);
    const decisao = decidirAlertasCofre({
      run: ultimaRun, pendencias, inativos, estadoAnterior: estado.alertaEstado || null,
    });

    let emailEnviado = false;
    if (decisao.enviar && isGraphConfigured()) {
      const r = await enviarEmail({
        remetente: REMETENTE, para: ALERTA_PARA,
        assunto: `[CFI] Cofre: ${decisao.alertas.map((a) => a.tipo).join(', ')}`,
        corpoHtml: montarCorpoAlerta(decisao.alertas),
      });
      emailEnviado = r.ok;
      if (!r.ok) console.warn('[cofre-alerta] envio falhou:', r.error);
    }
    // Persiste a assinatura mesmo sem enviar (Graph off) pra não spammar depois.
    await estadoRef.set({ alertaEstado: { assinatura: decisao.assinatura, avaliadoEm: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });

    return res.json({ ok: true, enviar: decisao.enviar, emailEnviado, para: ALERTA_PARA, alertas: decisao.alertas, assinatura: decisao.assinatura });
  } catch (e) {
    console.error('[xml-email-ingest/alerta-cron]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// Fase 3 — arquivo automático no SharePoint dos XMLs do cofre.
router.post('/xml-email-arquivo-sp-cron', requireCronAuth, async (req, res) => {
  try {
    const r = await arquivarNoSharePoint({});
    return res.json(r);
  } catch (e) {
    console.error('[xml-email-arquivo-sp-cron] erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.post('/xml-email-arquivo-sp', requireAdmin, async (req, res) => {
  try {
    const r = await arquivarNoSharePoint({ maxDocs: Number(req.body?.maxDocs) || undefined });
    return res.json(r);
  } catch (e) {
    console.error('[xml-email-arquivo-sp] erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
