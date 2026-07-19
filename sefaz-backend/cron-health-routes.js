// ============================================================================
// sefaz-backend/cron-health-routes.js  (ESM)
//
// GET /api/admin/crons/health — visão única de saúde de todos os crons de
// captura/apuração (verde/amarelo/vermelho), lendo o último log de cada
// coleção *_cron_logs. Somente admin.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { coletarSaudeCrons } from './cron-health.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

router.get('/health', requireAdmin, async (req, res) => {
    try {
        const saude = await coletarSaudeCrons(fa().firestore());
        return res.json({ ok: true, ...saude });
    } catch (e) {
        console.error('[cron-health] erro:', e.message);
        return res.status(500).json({ ok: false, erro: e.message });
    }
});

export default router;
