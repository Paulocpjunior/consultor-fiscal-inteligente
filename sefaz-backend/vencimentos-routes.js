// ============================================================================
// sefaz-backend/vencimentos-routes.js
// Endpoints:
//   POST /api/admin/vencimentos/cron        (cron-secret) — dispara alertas
//   POST /api/admin/vencimentos/cron-now    (Bearer admin) — disparo manual
//   GET  /api/admin/vencimentos/resumo      (Bearer) — pra dashboard/banner
// ============================================================================

import express from 'express';
import { processarVencimentos, resumoVencimentos } from './vencimentos-orchestrator.js';
import { requireAuth } from './require-admin.js';

const router = express.Router();
router.use(express.json());

const CRON_SECRET = process.env.SEFAZ_CRON_SECRET;

function requireCronAuth(req, res, next) {
    const headerSecret = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'];
    if (!CRON_SECRET || headerSecret !== CRON_SECRET) {
        return res.status(403).json({ error: 'Cron auth failed' });
    }
    next();
}

router.post('/cron', requireCronAuth, async (req, res) => {
    res.json({ ok: true, motivo: 'Iniciado em background' });
    setImmediate(async () => {
        try {
            const log = await processarVencimentos({ disparadoPor: 'cron-scheduler' });
            console.log(`[vencimentos-cron] fim — examinadas=${log.examinadas} alertadas=${log.alertadas} emails=${log.emailsEnviados}`);
        } catch (e) {
            console.error('[vencimentos-cron] erro:', e);
        }
    });
});

router.post('/cron-now', requireAuth, async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });
    // force=true (body ou query) ignora a idempotência diária e re-dispara
    // (re-marca tarefas + re-envia o email-resumo pros admins).
    const force = req.body?.force === true || req.query?.force === '1' || req.query?.force === 'true';
    res.json({ ok: true, motivo: 'Disparado em background', force });
    setImmediate(async () => {
        try {
            const log = await processarVencimentos({ disparadoPor: req.user.email, force });
            console.log(`[vencimentos-cron-now] fim — force=${force} examinadas=${log.examinadas} alertadas=${log.alertadas} emails=${log.emailsEnviados} digestEmail=${log.emailDigestEnviado || false} digestErro=${log.emailDigestErro || '-'}`);
        } catch (e) {
            console.error('[vencimentos-cron-now] erro:', e);
        }
    });
});

router.get('/resumo', requireAuth, async (req, res) => {
    try {
        const r = await resumoVencimentos({ uid: req.user.uid, role: req.user.role });
        return res.json(r);
    } catch (e) {
        console.error('[vencimentos/resumo] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

export default router;
