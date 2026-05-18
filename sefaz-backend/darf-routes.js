// ============================================================================
// sefaz-backend/darf-routes.js
// Express router pra emissao de DARF (Lucro Presumido / Real).
// Montado em /api/admin/darf pelo server.js raiz.
// ============================================================================

import express from 'express';
import { requireAdmin } from './require-admin.js';
import {
    emitirDarf, listarDarfs, getResumoDarf,
    marcarPago, processarVencimentos,
} from './darf-orchestrator.js';
import { getDarfMode } from './darf-provider.js';
import { listarCodigos, sugerirCodigoReceita } from './darf-codigos-receita.js';

const router = express.Router();
const CRON_SECRET = process.env.SEFAZ_CRON_SECRET || '';

router.get('/status', (_req, res) => {
    res.json({ mode: getDarfMode(), ok: true });
});

router.get('/codigos-receita', requireAdmin, (_req, res) => {
    res.json(listarCodigos());
});

router.get('/sugerir-codigo', requireAdmin, (req, res) => {
    const { regime, tributo, periodicidade } = req.query;
    const sug = sugerirCodigoReceita(regime, tributo, periodicidade);
    res.json(sug || {});
});

router.get('/resumo', requireAdmin, async (_req, res) => {
    try { res.json(await getResumoDarf()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/listar', requireAdmin, async (req, res) => {
    try {
        res.json(await listarDarfs({
            empresaId:   req.query.empresaId,
            competencia: req.query.competencia,
            tributo:     req.query.tributo,
            regime:      req.query.regime,
            status:      req.query.status,
        }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emitir', requireAdmin, express.json(), async (req, res) => {
    try { res.json(await emitirDarf(req.body)); }
    catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/marcar-pago', requireAdmin, express.json(), async (req, res) => {
    try {
        const { docId, dataPagamento } = req.body;
        if (!docId) return res.status(400).json({ error: 'docId obrigatorio' });
        res.json(await marcarPago(docId, dataPagamento));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cron noturno (Cloud Scheduler) — marca DARFs vencidas
router.post('/cron', async (req, res) => {
    const headerSecret = req.header('X-Cron-Secret') || '';
    if (!CRON_SECRET || headerSecret !== CRON_SECRET) {
        return res.status(403).json({ erro: 'cron secret invalido' });
    }
    try {
        const stats = await processarVencimentos();
        return res.json({ ok: true, ...stats });
    } catch (err) {
        return res.status(500).json({ ok: false, erro: err.message });
    }
});

export default router;
