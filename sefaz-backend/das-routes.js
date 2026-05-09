// ============================================================================
// sefaz-backend/das-routes.js
// Express router pra DAS Simples Nacional.
// Montado em /api/admin/das pelo server.js raiz.
// ============================================================================

import express from 'express';
import {
    emitirDasRegular, emitirDasAvulso,
    listarDas, getResumoDas, marcarPago,
} from './das-orchestrator.js';
import { getDasMode } from './das-provider.js';

const router = express.Router();

function requireAdmin(req, res, next) {
    const role = req.headers['x-user-role'] || 'colaborador';
    if (role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    next();
}

router.get('/status', (_req, res) => {
    res.json({ mode: getDasMode(), ok: true });
});

router.get('/resumo', requireAdmin, async (_req, res) => {
    try { res.json(await getResumoDas()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/listar', requireAdmin, async (req, res) => {
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

export default router;
