// sefaz-backend/abrasf/routes.js
// Endpoints admin do adapter ABRASF (BETA).

import express from 'express';
import { requireAdmin, requireAuth } from '../require-admin.js';
import { listarMunicipiosNomes, configMunicipio, MUNICIPIOS_ABRASF } from './config-municipios.js';
import { capturarEmpresa, capturarTodas } from './orchestrator.js';
import admin from 'firebase-admin';

const router = express.Router();
router.use(express.json());

function getDb() {
    if (!admin.apps.length) admin.initializeApp();
    return admin.firestore();
}

// ── GET /municipios ────────────────────────────────────────────────────────
// Lista municipios suportados pelo adapter (catalogo estatico).
router.get('/municipios', requireAuth, (_req, res) => {
    res.json({ municipios: listarMunicipiosNomes() });
});

// ── GET /status ────────────────────────────────────────────────────────────
// Retorna empresas habilitadas + ultima sincronizacao.
router.get('/status', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });
        const db = getDb();
        const totalMunSuportados = Object.keys(MUNICIPIOS_ABRASF).length;

        // Empresas elegiveis
        const colecoes = ['simples_empresas', 'lucro_empresas'];
        const eligiveis = new Set();
        const habilitadas = new Set();
        for (const col of colecoes) {
            const snap = await db.collection(col).get();
            snap.forEach(d => {
                const e = d.data();
                if (e._merged_into || e._deleted) return;
                const cnpj = (e.cnpj || '').replace(/\D/g, '');
                if (cnpj.length !== 14) return;
                const codMunIBGE = e.dadosFiscais?.codMunIBGE;
                if (!codMunIBGE || !configMunicipio(codMunIBGE)) return;
                eligiveis.add(cnpj);
                if (e.abrasfAtivo === true) habilitadas.add(cnpj);
            });
        }

        // Ultimas sincronizacoes
        const ultimasSnap = await db.collection('abrasf_state')
            .orderBy('ultimaSync', 'desc')
            .limit(10)
            .get();
        const ultimas = [];
        ultimasSnap.forEach(d => {
            const x = d.data();
            ultimas.push({
                empresaId: x.empresaId,
                empresaCnpj: x.empresaCnpj,
                codMunIBGE: x.codMunIBGE,
                ultimaSync: x.ultimaSync?.toDate?.()?.toISOString?.() || null,
                ultimoPeriodo: x.ultimoPeriodo || null,
            });
        });

        return res.json({
            beta: true,
            municipiosSuportados: totalMunSuportados,
            empresasElegiveis: eligiveis.size,
            empresasHabilitadas: habilitadas.size,
            ultimasSincronizacoes: ultimas,
        });
    } catch (e) {
        console.error('[abrasf/status]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

// ── POST /toggle/:empresaId ────────────────────────────────────────────────
// Liga/desliga abrasfAtivo numa empresa. Body: { ativo: boolean }
router.post('/toggle/:empresaId', requireAdmin, async (req, res) => {
    try {
        const { empresaId } = req.params;
        const { ativo } = req.body || {};
        if (typeof ativo !== 'boolean') return res.status(400).json({ error: 'ativo (boolean) obrigatorio' });

        const db = getDb();
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).doc(empresaId).get();
            if (snap.exists) {
                await snap.ref.update({
                    abrasfAtivo: ativo,
                    abrasfAlteradoPor: req.user?.email || req.user?.uid || 'admin',
                    abrasfAlteradoEm: new Date(),
                });
                return res.json({ ok: true, colecao: col, ativo });
            }
        }
        return res.status(404).json({ error: 'empresa nao encontrada' });
    } catch (e) {
        console.error('[abrasf/toggle]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

// ── POST /sync-one ─────────────────────────────────────────────────────────
// Captura NFSes de UMA empresa em um periodo.
// Body: { empresaId, dataInicial, dataFinal }
router.post('/sync-one', requireAdmin, async (req, res) => {
    try {
        const { empresaId, dataInicial, dataFinal } = req.body || {};
        if (!empresaId || !dataInicial || !dataFinal) {
            return res.status(400).json({ error: 'empresaId, dataInicial e dataFinal obrigatorios' });
        }

        // Carrega dados da empresa
        const db = getDb();
        let empresa = null;
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).doc(empresaId).get();
            if (snap.exists) {
                const e = snap.data();
                empresa = {
                    id: empresaId,
                    cnpj: (e.cnpj || '').replace(/\D/g, ''),
                    codMunIBGE: e.dadosFiscais?.codMunIBGE,
                    inscricaoMunicipal: e.dadosFiscais?.inscricaoMunicipal,
                };
                break;
            }
        }
        if (!empresa) return res.status(404).json({ error: 'empresa nao encontrada' });
        if (!configMunicipio(empresa.codMunIBGE)) {
            return res.status(400).json({ error: `municipio ${empresa.codMunIBGE} nao suportado pelo adapter ABRASF` });
        }

        const r = await capturarEmpresa({ empresa, dataInicial, dataFinal });
        return res.json(r);
    } catch (e) {
        console.error('[abrasf/sync-one]', e);
        return res.status(500).json({ error: e.message || 'Falha interna' });
    }
});

// ── POST /sync-todas ───────────────────────────────────────────────────────
// Captura para TODAS empresas habilitadas. So admin. Cuidado: pode ser lento.
router.post('/sync-todas', requireAdmin, async (req, res) => {
    try {
        const { dataInicial, dataFinal } = req.body || {};
        if (!dataInicial || !dataFinal) {
            return res.status(400).json({ error: 'dataInicial e dataFinal obrigatorios' });
        }
        const r = await capturarTodas({ dataInicial, dataFinal });
        return res.json(r);
    } catch (e) {
        console.error('[abrasf/sync-todas]', e);
        return res.status(500).json({ error: e.message || 'Falha interna' });
    }
});

export default router;
