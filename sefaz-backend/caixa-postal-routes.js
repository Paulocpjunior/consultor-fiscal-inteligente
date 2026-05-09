// ============================================================================
// sefaz-backend/caixa-postal-routes.js
// Express router pra Caixa Postal e-CAC.
// Montado em /api/admin/caixa-postal pelo server.js raiz.
// ============================================================================

import express from 'express';
import {
    sincronizarEmpresa,
    sincronizarTodasEmpresas,
    listarMensagensLocais,
    getResumoGlobal,
    marcarComoLida,
} from './caixa-postal-orchestrator.js';
import { getProviderMode } from './caixa-postal-provider.js';

const router = express.Router();

// Auth básica — só admin
function requireAdmin(req, res, next) {
    const role = req.headers['x-user-role'] || 'colaborador';
    if (role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    next();
}

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

export default router;
