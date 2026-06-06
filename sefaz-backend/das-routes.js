// ============================================================================
// sefaz-backend/das-routes.js
// Express router pra DAS Simples Nacional.
// Montado em /api/admin/das pelo server.js raiz.
// ============================================================================

import express from 'express';
import { requireAdmin, requireAuth } from './require-admin.js';
import admin from 'firebase-admin';
import { ultimasCompetencias as ultimasCompetenciasHelper } from './competencias-helper.js';
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

// GET /cobertura-pgdas?meses=6
// Pra cada empresa Simples ativa, lista as competencias dos ultimos N meses
// onde NAO ha das_emitidos. Esse e o gap classico: contador esquece de
// transmitir o PGDAS-D de uma empresa e a Receita autua automaticamente.
// Default: ultimos 6 meses. Maximo: 24. So admin.
router.get('/cobertura-pgdas', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });
        const meses = Math.min(Math.max(Number(req.query.meses || 6), 1), 24);
        const competencias = ultimasCompetencias(meses);

        if (admin.apps.length === 0) {
            admin.initializeApp({ credential: admin.credential.applicationDefault() });
        }
        const db = admin.firestore();

        // 1. Empresas Simples ativas (ignora _merged_into)
        const simplesSnap = await db.collection('simples_empresas').get();
        const empresas = [];
        simplesSnap.forEach((doc) => {
            const d = doc.data();
            if (d._merged_into) return;
            const cnpj = (d.cnpj || '').replace(/\D/g, '');
            if (cnpj.length !== 14) return;
            empresas.push({ id: doc.id, cnpj, nome: d.razaoSocial || d.nome || '' });
        });

        // 2. DAS emitidos das competencias relevantes (chunks de 10 — limite do 'in')
        const dasMap = new Map(); // empresaId|competencia -> { valor, statusPagamento }
        const chunksFalhos = []; // competencias cujo chunk falhou — UI mostra "leitura parcial"
        for (let i = 0; i < competencias.length; i += 10) {
            const chunk = competencias.slice(i, i + 10);
            try {
                const snap = await db.collection('das_emitidos')
                    .where('competencia', 'in', chunk).get();
                snap.forEach((d) => {
                    const x = d.data();
                    const k = `${x.empresaId}|${x.competencia}`;
                    if (!dasMap.has(k)) {
                        dasMap.set(k, { valor: x.valor || 0, statusPagamento: x.statusPagamento || 'pendente' });
                    }
                });
            } catch (e) {
                chunksFalhos.push(...chunk);
                console.warn('[das/cobertura-pgdas] chunk', chunk, 'falhou:', e.message);
            }
        }

        // 3. Monta a matriz empresa x competencia
        const resultado = [];
        let totalGaps = 0;
        let totalVencidos = 0;
        for (const emp of empresas) {
            const mesesArr = competencias.map((comp) => {
                const k = `${emp.id}|${comp}`;
                const das = dasMap.get(k);
                return das
                    ? { competencia: comp, transmitido: true, valor: das.valor, statusPagamento: das.statusPagamento }
                    : { competencia: comp, transmitido: false };
            });
            const gaps = mesesArr.filter((m) => !m.transmitido).length;
            const vencidos = mesesArr.filter((m) => m.transmitido && m.statusPagamento === 'vencido').length;
            totalGaps += gaps;
            totalVencidos += vencidos;
            resultado.push({ id: emp.id, cnpj: emp.cnpj, nome: emp.nome, gaps, vencidos, meses: mesesArr });
        }

        // ordena: mais gaps primeiro, depois mais vencidos
        resultado.sort((a, b) => (b.gaps - a.gaps) || (b.vencidos - a.vencidos) || (a.nome || '').localeCompare(b.nome || ''));

        return res.json({
            mesesAnalisados: competencias.length,
            competencias,
            totalEmpresas: empresas.length,
            empresasComGap: resultado.filter((e) => e.gaps > 0).length,
            totalGaps,
            totalVencidos,
            // honesto: se algum chunk de mes falhou, marca degraded e lista
            // as competencias que ficaram sem leitura — UI evita "falso vermelho"
            degraded: chunksFalhos.length > 0,
            competenciasIncompletas: Array.from(new Set(chunksFalhos)),
            empresas: resultado,
        });
    } catch (e) {
        console.error('[das/cobertura-pgdas]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

// Reexport pra preservar compatibilidade interna.
// Logica: ultimas N competencias YYYY-MM (decrescente). Mes atual NAO entra —
// PGDAS dele ainda nao venceu (vence dia 20 do seguinte).
function ultimasCompetencias(n) {
    return ultimasCompetenciasHelper(n);
}

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
