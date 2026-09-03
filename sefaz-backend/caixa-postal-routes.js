// ============================================================================
// sefaz-backend/caixa-postal-routes.js
// Express router pra Caixa Postal multi-canal.
// Montado em /api/admin/caixa-postal pelo server.js raiz.
// ============================================================================

import express from 'express';
import { requireAdmin, requireAuth } from './require-admin.js';
import { getCnpjsDaCarteira, podeAcessarCnpj } from './carteira-auth.js';
import admin from 'firebase-admin';
import {
    sincronizarEmpresa,
    sincronizarTodasEmpresas,
    listarMensagensLocais,
    getResumoGlobal,
    marcarComoLida,
} from './caixa-postal-orchestrator.js';

const CRON_SECRET = process.env.SEFAZ_CRON_SECRET || '';
import { getProviderMode, CANAIS_DISPONIVEIS } from './caixa-postal-provider.js';
import { secretsMatch } from './cron-secret.js';

const router = express.Router();

// Auth básica — só admin
// requireAdmin agora vem do middleware compartilhado (verifyIdToken)

router.get('/status', requireAuth, (_req, res) => {
    res.json({ mode: getProviderMode(), ok: true });
});

// Lista de canais disponíveis com metadata (cor, portal, descrição)
router.get('/canais', requireAuth, (_req, res) => {
    res.json({
        mode: getProviderMode(),
        canais: CANAIS_DISPONIVEIS,
    });
});

// Resumo pra dashboard / popup.
// Admin: resumo global. Colaborador: filtrado pela carteira dele.
router.get('/resumo', requireAuth, async (req, res) => {
    try {
        let cnpjsPermitidos = null; // null = sem filtro (admin ve tudo)

        if (req.user && req.user.role !== 'admin') {
            // Colaborador: busca os CNPJs das empresas da carteira dele.
            const snap = await admin.firestore()
                .collection('carteiras')
                .where('colaboradorUid', '==', req.user.uid)
                .get();
            cnpjsPermitidos = snap.docs.map(d => d.data().empresaCnpj || '');
        }

        const r = await getResumoGlobal(cnpjsPermitidos);
        res.json(r);
    } catch (err) {
        console.error('[caixa-postal] /resumo:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Lista mensagens (com filtros opcionais).
// Admin ve tudo. Colaborador: se passar empresaCnpj precisa estar na carteira;
// se nao passar, devolve so as mensagens das empresas da carteira dele.
router.get('/mensagens', requireAuth, async (req, res) => {
    try {
        const isAdmin = req.user?.role === 'admin';
        let cnpjsPermitidos = null;
        if (!isAdmin) {
            cnpjsPermitidos = await getCnpjsDaCarteira(req.user);
            if (req.query.empresaCnpj) {
                const check = await podeAcessarCnpj(req.user, req.query.empresaCnpj);
                if (!check.ok) return res.status(check.status).json({ error: check.error });
            }
        }
        let r = await listarMensagensLocais({
            empresaCnpj: req.query.empresaCnpj,
            categoria: req.query.categoria,
            fonte: req.query.fonte,
            naoLidas: req.query.naoLidas === 'true',
        });
        if (!isAdmin && !req.query.empresaCnpj && cnpjsPermitidos) {
            const setOk = new Set(cnpjsPermitidos);
            r = r.filter(m => setOk.has((m.empresaCnpj || '').replace(/\D/g, '')));
        }
        res.json(r);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Sincroniza 1 empresa
router.post('/sincronizar', requireAdmin, async (req, res) => {
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
router.post('/marcar-lida', requireAdmin, async (req, res) => {
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
// Smoke test: sincroniza 1 empresa, protegido por X-Cron-Secret (sem ID token).
// Uso interno de diagnostico — mira UMA empresa, nao dispara as 213.
router.post('/sincronizar-uma', async (req, res) => {
    const headerSecret = req.headers['x-cron-secret'] || '';
    if (!secretsMatch(headerSecret, CRON_SECRET)) {
        return res.status(403).json({ erro: 'cron secret invalido' });
    }
    try {
        const { empresaId, empresaCnpj } = req.body || {};
        if (!empresaId || !empresaCnpj) {
            return res.status(400).json({ erro: 'empresaId e empresaCnpj obrigatorios' });
        }
        const r = await sincronizarEmpresa(empresaId, empresaCnpj);
        res.json(r);
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

router.post('/cron', async (req, res) => {
    const headerSecret = req.header('X-Cron-Secret') || '';
    if (!secretsMatch(headerSecret, CRON_SECRET)) {
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
