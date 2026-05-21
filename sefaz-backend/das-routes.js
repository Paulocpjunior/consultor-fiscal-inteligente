// ============================================================================
// sefaz-backend/das-routes.js
// Express router pra DAS Simples Nacional.
// Montado em /api/admin/das pelo server.js raiz.
// ============================================================================

import express from 'express';
import { requireAdmin, requireAuth } from './require-admin.js';
import admin from 'firebase-admin';
import {
    emitirDasRegular, emitirDasAvulso,
    listarDas, getResumoDas, marcarPago,
    processarCronDas,
} from './das-orchestrator.js';
import { getDasMode } from './das-provider.js';

const CRON_SECRET = process.env.SEFAZ_CRON_SECRET || '';

const router = express.Router();

// requireAdmin agora vem do middleware compartilhado (verifyIdToken)

router.get('/status', (_req, res) => {
    res.json({ mode: getDasMode(), ok: true });
});

router.get('/resumo', requireAuth, async (_req, res) => {
    try { res.json(await getResumoDas()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/listar', requireAuth, async (req, res) => {
    try {
        res.json(await listarDas({
            empresaId: req.query.empresaId,
            competencia: req.query.competencia,
            status: req.query.status,
        }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emitir-regular', requireAdmin, express.json(), async (req, res) => {
    try { res.json(await emitirDasRegular(req.body)); }
    catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/emitir-avulso', requireAdmin, express.json(), async (req, res) => {
    try { res.json(await emitirDasAvulso(req.body)); }
    catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/marcar-pago', requireAdmin, express.json(), async (req, res) => {
    try {
        const { docId, dataPagamento } = req.body;
        if (!docId) return res.status(400).json({ error: 'docId obrigatorio' });
        res.json(await marcarPago(docId, dataPagamento));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Cron noturno (Cloud Scheduler) ─────────────────────────────────────
// Disparado pelo job 'das-cron-noturno' as 03:30 BRT.
router.post('/cron', async (req, res) => {
    const headerSecret = req.header('X-Cron-Secret') || '';
    if (!CRON_SECRET || headerSecret !== CRON_SECRET) {
        return res.status(403).json({ erro: 'cron secret invalido' });
    }
    const t0 = Date.now();
    try {
        const stats = await processarCronDas();
        const duracaoMs = Date.now() - t0;

        try {
            if (admin.apps.length === 0) {
                admin.initializeApp({ credential: admin.credential.applicationDefault() });
            }
            await admin.firestore().collection('das_cron_logs').add({
                executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                iniciadoEm: new Date(t0).toISOString(),
                duracaoMs,
                ...stats,
            });
        } catch (logErr) {
            console.warn('[das-cron] log falhou:', logErr.message);
        }

        console.log(`[das-cron] OK em ${duracaoMs}ms - totalDas=${stats.totalDas} vencidos=${stats.vencidos} aVencer=${stats.aVencer} atualizados=${stats.atualizadosParaVencido}`);
        return res.json({ ok: true, duracaoMs, ...stats });
    } catch (err) {
        console.error('[das-cron] erro:', err.message);
        return res.status(500).json({ ok: false, erro: err.message });
    }
});

export default router;
