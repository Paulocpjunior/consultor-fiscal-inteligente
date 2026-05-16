// ============================================================================
// sefaz-backend/dctfweb-routes.js
// Router Express. Montado em /api/admin/dctfweb pelo server.js.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import {
    sincronizarEmpresa, sincronizarTodasLucro,
    listarDeclaracoes, transmitirDeclaracao, gerarDarf,
    consultarDeclaracaoCompleta, consultarRecibo,
    encerrarApuracaoMit, consultarStatusEncerramentoMit,
    consultarApuracaoMit, consultarApuracoesAno,
    getResumoGlobal,
} from './dctfweb-orchestrator.js';
import { getDctfwebMode } from './dctfweb-provider.js';
import { requireAdmin } from './require-admin.js';

const CRON_SECRET = process.env.SEFAZ_CRON_SECRET || '';
const router = express.Router();

// requireAdmin agora vem do middleware compartilhado (verifyIdToken)

router.get('/status', (_req, res) => res.json({ mode: getDctfwebMode(), ok: true }));

router.get('/resumo', requireAdmin, async (_req, res) => {
    try { res.json(await getResumoGlobal()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/declaracoes', requireAdmin, async (req, res) => {
    try {
        res.json(await listarDeclaracoes({
            empresaCnpj: req.query.empresaCnpj,
            situacao: req.query.situacao,
            anoPA: req.query.anoPA ? Number(req.query.anoPA) : undefined,
            mesPA: req.query.mesPA ? Number(req.query.mesPA) : undefined,
        }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sincronizar', requireAdmin, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj, anoPA, mesPA, categoria } = req.body || {};
        if (!empresaId || !empresaCnpj) return res.status(400).json({ error: 'empresaId+empresaCnpj' });
        res.json(await sincronizarEmpresa(empresaId, empresaCnpj, { anoPA, mesPA, categoria }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/transmitir', requireAdmin, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj, anoPA, mesPA, categoria } = req.body || {};
        if (!empresaId || !empresaCnpj || !anoPA || !mesPA) return res.status(400).json({ error: 'empresaId+empresaCnpj+anoPA+mesPA' });
        res.json(await transmitirDeclaracao({ empresaId, empresaCnpj, anoPA, mesPA, categoria }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/gerar-darf', requireAdmin, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj, anoPA, mesPA, categoria, emAndamento } = req.body || {};
        if (!empresaCnpj || !anoPA || !mesPA) return res.status(400).json({ error: 'empresaCnpj+anoPA+mesPA' });
        res.json(await gerarDarf({ empresaId, empresaCnpj, anoPA, mesPA, categoria, emAndamento: !!emAndamento }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/declaracao-completa', requireAdmin, async (req, res) => {
    try {
        const { empresaCnpj, anoPA, mesPA, categoria } = req.query;
        res.json(await consultarDeclaracaoCompleta({ empresaCnpj, anoPA: Number(anoPA), mesPA: Number(mesPA), categoria }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/recibo', requireAdmin, async (req, res) => {
    try {
        const { empresaCnpj, anoPA, mesPA, categoria } = req.query;
        res.json(await consultarRecibo({ empresaCnpj, anoPA: Number(anoPA), mesPA: Number(mesPA), categoria }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/mit/encerrar', requireAdmin, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj, anoPA, mesPA } = req.body || {};
        if (!empresaCnpj || !anoPA || !mesPA) return res.status(400).json({ error: 'empresaCnpj+anoPA+mesPA' });
        res.json(await encerrarApuracaoMit({ empresaId, empresaCnpj, anoPA, mesPA }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/mit/status', requireAdmin, async (req, res) => {
    try {
        const { empresaCnpj, protocolo, anoPA, mesPA } = req.query;
        res.json(await consultarStatusEncerramentoMit({
            empresaCnpj, protocolo,
            anoPA: anoPA ? Number(anoPA) : undefined,
            mesPA: mesPA ? Number(mesPA) : undefined,
        }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/mit/apuracao', requireAdmin, async (req, res) => {
    try {
        const { empresaCnpj, anoPA, mesPA } = req.query;
        res.json(await consultarApuracaoMit({ empresaCnpj, anoPA: Number(anoPA), mesPA: Number(mesPA) }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/mit/historico', requireAdmin, async (req, res) => {
    try {
        const { empresaCnpj, anoPA } = req.query;
        res.json(await consultarApuracoesAno({ empresaCnpj, anoPA: Number(anoPA) }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/cron', async (req, res) => {
    const headerSecret = req.header('X-Cron-Secret') || '';
    if (!CRON_SECRET || headerSecret !== CRON_SECRET) return res.status(403).json({ erro: 'cron secret invalido' });
    const t0 = Date.now();
    try {
        const stats = await sincronizarTodasLucro();
        const duracaoMs = Date.now() - t0;
        try {
            if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.applicationDefault() });
            await admin.firestore().collection('dctfweb_cron_logs').add({
                executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                duracaoMs, ...stats,
            });
        } catch (logErr) { console.warn('[dctfweb-cron] log falhou:', logErr.message); }
        return res.json({ ok: true, duracaoMs, ...stats });
    } catch (err) {
        return res.status(500).json({ ok: false, erro: err.message });
    }
});

export default router;
