// ============================================================================
// sefaz-backend/caixa-postal-routes.js
// Express router pra Caixa Postal e-CAC.
// Montado em /api/admin/caixa-postal pelo server.js raiz.
// ============================================================================

import express from 'express';
import { requireAdmin } from './require-admin.js';
import admin from 'firebase-admin';
import {
    sincronizarEmpresa,
    sincronizarTodasEmpresas,
    listarMensagensLocais,
    getResumoGlobal,
    marcarComoLida,
} from './caixa-postal-orchestrator.js';

const CRON_SECRET = process.env.SEFAZ_CRON_SECRET || '';
import { getProviderMode } from './caixa-postal-provider.js';

const router = express.Router();

// Auth básica — só admin
// requireAdmin agora vem do middleware compartilhado (verifyIdToken)

router.get('/status', (_req, res) => {
    res.json({ mode: getProviderMode(), ok: true });
});

// Resumo global pra dashboard
router.get('/resumo', requireAdmin, async (_req, res) => {
    try {
        const r = await getResumoGlobal();
        res.json(r);
    } catch (err) {
        console.error('[caixa-postal] /resumo:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Lista mensagens (com filtros opcionais)
router.get('/mensagens', requireAdmin, async (req, res) => {
    try {
        const r = await listarMensagensLocais({
            empresaCnpj: req.query.empresaCnpj,
            categoria: req.query.categoria,
            naoLidas: req.query.naoLidas === 'true',
        });
        res.json(r);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Sincroniza 1 empresa
router.post('/sincronizar', requireAdmin, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj } = req.body;
        if (!empresaId || !empresaCnpj) {
            return res.status(400).json({ error: 'empresaId e empresaCnpj obrigatorios' });
        }
        const r = await sincronizarEmpresa(empresaId, empresaCnpj);
        res.json(r);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Sincroniza todas
router.post('/sincronizar-todas', requireAdmin, async (_req, res) => {
    try {
        const r = await sincronizarTodasEmpresas();
        res.json(r);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Marca mensagem como lida
router.post('/marcar-lida', requireAdmin, express.json(), async (req, res) => {
    try {
        const { docId } = req.body;
        if (!docId) return res.status(400).json({ error: 'docId obrigatorio' });
        const r = await marcarComoLida(docId);
        res.json(r);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cron noturno (Cloud Scheduler)
router.post('/cron', async (req, res) => {
    const headerSecret = req.header('X-Cron-Secret') || '';
    if (!CRON_SECRET || headerSecret !== CRON_SECRET) {
        return res.status(403).json({ erro: 'cron secret invalido' });
    }
    const t0 = Date.now();
    try {
        const stats = await sincronizarTodasEmpresas();
        const duracaoMs = Date.now() - t0;
        try {
            if (admin.apps.length === 0) {
                admin.initializeApp({ credential: admin.credential.applicationDefault() });
            }
            await admin.firestore().collection('caixa_postal_cron_logs').add({
                executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                iniciadoEm: new Date(t0).toISOString(),
                duracaoMs,
                ...stats,
            });
        } catch (logErr) {
            console.warn('[caixa-postal-cron] log falhou:', logErr.message);
        }
        console.log(`[caixa-postal-cron] OK em ${duracaoMs}ms - totalEmpresas=${stats.totalEmpresas} sucesso=${stats.sucesso} falha=${stats.falha}`);
        return res.json({ ok: true, duracaoMs, ...stats });
    } catch (err) {
        console.error('[caixa-postal-cron] erro:', err.message);
        return res.status(500).json({ ok: false, erro: err.message });
    }
});

export default router;
