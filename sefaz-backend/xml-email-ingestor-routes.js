// ============================================================================
// sefaz-backend/xml-email-ingestor-routes.js  (ESM)
//
// Ingestão de XML por e-mail (o "cofre" do CFI que substitui o da SIEG).
//
//   POST /api/admin/sefaz/xml-email-ingest-cron  (x-cron-secret)  — automático
//   POST /api/admin/sefaz/xml-email-ingest       (requireAdmin)   — manual/UI
//     body: { mailbox?, maxMensagens? }
//   GET  /api/admin/sefaz/xml-email-ingest/status (requireAdmin)  — último resumo
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { secretsMatch } from './cron-secret.js';
import { ingerirXmlPorEmail } from './xml-email-ingestor.js';

const router = express.Router();

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
    const caixa = process.env.XML_INGEST_MAILBOX || 'xml@spassessoriacontabil.com.br';
    return res.json({ ok: true, caixa, estado: snap.exists ? snap.data() : null });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
