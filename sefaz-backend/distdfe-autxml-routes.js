// ============================================================================
// sefaz-backend/distdfe-autxml-routes.js  (ESM)
//
// Colheita de saida via <autXML> (DistribuicaoDFe com o cert do escritorio).
//
//   POST /api/admin/sefaz/autxml-harvest-cron   (x-cron-secret)  — automatico
//   POST /api/admin/sefaz/autxml-harvest         (requireAdmin)   — manual/UI
//     body: { resetNSU?, maxPaginas? }
// ============================================================================

import express from 'express';
import { requireAdmin } from './require-admin.js';
import { colherSaidaAutXML } from './distdfe-autxml-orchestrator.js';

const router = express.Router();

function requireCronAuth(req, res, next) {
  const secret = process.env.SEFAZ_CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'Cron secret not configured' });
  const header = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'];
  if (header === secret) return next();
  return res.status(403).json({ error: 'Cron auth failed' });
}

router.post('/autxml-harvest-cron', requireCronAuth, async (req, res) => {
  try {
    const r = await colherSaidaAutXML({
      capturadoPor: { uid: 'cron', email: 'autxml-harvest-cron' },
      resetNSU: false,
    });
    return res.json(r);
  } catch (e) {
    console.error('[autxml-harvest-cron] erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.post('/autxml-harvest', requireAdmin, async (req, res) => {
  try {
    const { resetNSU, maxPaginas } = req.body || {};
    const r = await colherSaidaAutXML({
      capturadoPor: { uid: req.user?.uid || null, email: req.user?.email || 'admin' },
      resetNSU: !!resetNSU,
      maxPaginas: Number(maxPaginas) || undefined,
    });
    return res.json(r);
  } catch (e) {
    console.error('[autxml-harvest] erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
