// ============================================================================
// sefaz-backend/emission-routes.js
// Rotas da "Central de Emissões" — fachada unificada que agrega DAS+DARF.
// Montado em /api/admin/emission pelo server.js raiz.
// ============================================================================

import express from 'express';
import { requireEmissao } from './require-admin.js';
import {
    emitirGuia, getResumoConsolidado, getCatalogoEmissao,
} from './emission-orchestrator.js';
import { statusEmissaoGuard } from './emissao-guard.js';

const router = express.Router();

// Estado do freio de emissao (go-live gate). Admin ve quais tipos estao
// bloqueados sem precisar abrir o Cloud Run.
router.get('/guard-status', requireEmissao, (_req, res) => {
    res.json(statusEmissaoGuard());
});

router.get('/resumo', requireEmissao, async (_req, res) => {
    try { res.json(await getResumoConsolidado()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/catalogo', requireEmissao, (req, res) => {
    const regime = req.query.regime;
    if (!regime) return res.status(400).json({ error: 'regime obrigatorio' });
    res.json(getCatalogoEmissao(regime));
});

router.post('/emitir', requireEmissao, express.json(), async (req, res) => {
    try { res.json(await emitirGuia(req.body)); }
    catch (err) { res.status(err.httpStatus || 400).json({ error: err.message, code: err.code }); }
});

export default router;
