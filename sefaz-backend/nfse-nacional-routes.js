// ============================================================================
// sefaz-backend/nfse-nacional-routes.js
// Express router pra NFSe Nacional. Montado em /api/admin/nfse-nacional.
// ============================================================================

import express from 'express';
import {
    emitirNfse, cancelarNfse, listarNfse, getResumoNfse,
} from './nfse-nacional-orchestrator.js';
import { getNfseNacionalMode, NBS_CODIGOS_COMUNS } from './nfse-nacional-provider.js';

const router = express.Router();

function requireAdmin(req, res, next) {
    const role = req.headers['x-user-role'] || 'colaborador';
    if (role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    next();
}

router.get('/status', (_req, res) => {
    res.json({ mode: getNfseNacionalMode(), ok: true });
});

router.get('/resumo', requireAdmin, async (_req, res) => {
    try { res.json(await getResumoNfse()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/listar', requireAdmin, async (req, res) => {
    try {
        res.json(await listarNfse({
            empresaId: req.query.empresaId,
            status: req.query.status,
            dataInicio: req.query.dataInicio,
            dataFim: req.query.dataFim,
        }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/nbs', (_req, res) => {
    res.json(NBS_CODIGOS_COMUNS);
});

router.post('/emitir', requireAdmin, express.json(), async (req, res) => {
    try { res.json(await emitirNfse(req.body)); }
    catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/cancelar', requireAdmin, express.json(), async (req, res) => {
    try {
        const { chave, motivo } = req.body;
        if (!chave) return res.status(400).json({ error: 'chave obrigatoria' });
        res.json(await cancelarNfse(chave, motivo));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
