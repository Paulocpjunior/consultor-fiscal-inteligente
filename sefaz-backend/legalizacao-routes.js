// ============================================================================
// sefaz-backend/legalizacao-routes.js
// Endpoints do módulo Legalização:
//   GET  /api/admin/legalizacao/status    (Bearer) — flags de configuração
//   GET  /api/admin/legalizacao/resumo    (Bearer) — farol pro painel
//   POST /api/admin/legalizacao/cron      (cron-secret) — sync Jotform + alertas
//   POST /api/admin/legalizacao/cron-now  (Bearer admin) — disparo manual
// ============================================================================

import express from 'express';
import { requireAuth } from './require-admin.js';
import { secretsMatch } from './cron-secret.js';
import { isJotformConfigured } from './jotform-provider.js';
import { isGraphConfigured } from './graph-provider.js';
import {
    executarCronLegalizacao,
    resumoLegalizacao,
    FORM_CERTIDOES,
    FORM_PARCELAMENTOS,
} from './legalizacao-orchestrator.js';

const router = express.Router();
router.use(express.json());

const CRON_SECRET = process.env.SEFAZ_CRON_SECRET;

function requireCronAuth(req, res, next) {
    const headerSecret = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'];
    if (!secretsMatch(headerSecret, CRON_SECRET)) {
        return res.status(403).json({ error: 'Cron auth failed' });
    }
    next();
}

router.get('/status', requireAuth, (_req, res) => {
    res.json({
        jotformConfigured: isJotformConfigured(),
        graphConfigured: isGraphConfigured(),
        forms: {
            certidoesCertificados: FORM_CERTIDOES,
            parcelamentos: FORM_PARCELAMENTOS,
        },
    });
});

router.get('/resumo', requireAuth, async (_req, res) => {
    try {
        res.json(await resumoLegalizacao());
    } catch (e) {
        console.error('[legalizacao/resumo] erro:', e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/cron', requireCronAuth, async (_req, res) => {
    res.json({ ok: true, motivo: 'Iniciado em background' });
    setImmediate(async () => {
        try {
            const log = await executarCronLegalizacao({ disparadoPor: 'cron-scheduler' });
            console.log(`[legalizacao-cron] fim — sync=${log.sync?.gravados ?? 0} alertas=${log.alertas?.emailsEnviados ?? 0} falhas=${log.alertas?.falhasEmail ?? 0} ok=${log.ok}`);
        } catch (e) {
            console.error('[legalizacao-cron] erro:', e);
        }
    });
});

router.post('/cron-now', requireAuth, async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });
    const force = req.body?.force === true || req.query?.force === '1' || req.query?.force === 'true';
    res.json({ ok: true, motivo: 'Disparado em background', force });
    setImmediate(async () => {
        try {
            const log = await executarCronLegalizacao({ disparadoPor: req.user.email, force });
            console.log(`[legalizacao-cron-now] fim — force=${force} sync=${log.sync?.gravados ?? 0} alertas=${log.alertas?.emailsEnviados ?? 0} falhas=${log.alertas?.falhasEmail ?? 0} ok=${log.ok}`);
        } catch (e) {
            console.error('[legalizacao-cron-now] erro:', e);
        }
    });
});

export default router;
