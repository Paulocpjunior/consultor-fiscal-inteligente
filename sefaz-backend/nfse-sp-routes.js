// ============================================================================
// sefaz-backend/nfse-sp-routes.js  (ESM)
//
// Endpoints REST pra captura de NFS-e da prefeitura de São Paulo capital.
// Mesmo padrão self-contained do manifesto-routes.js.
// ============================================================================

import { Router, json } from 'express';
import admin from 'firebase-admin';
import {
    listarEmpresasElegiveis,
    consultarUma,
    consultarTodasElegiveis,
} from './nfse-sp-orchestrator.js';
import { requireAuth as authUser } from './require-admin.js';

const CRON_SECRET = process.env.SEFAZ_CRON_SECRET;
const router = Router();

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

router.get('/nfsesp-elegiveis', authUser, async (_req, res) => {
    try {
        const db = fa().firestore();
        const lista = await listarEmpresasElegiveis(db);
        res.json({ total: lista.length, empresas: lista });
    } catch (e) {
        console.error('[nfse-sp-routes] elegiveis:', e);
        res.status(500).json({ erro: e.message });
    }
});

router.post('/nfsesp-consultar-uma', authUser, json(), async (req, res) => {
    try {
        const { empresaId, colecao, periodo } = req.body || {};
        if (!empresaId) return res.status(400).json({ erro: 'empresaId é obrigatório' });
        if (!colecao || !['simples_empresas', 'lucro_empresas'].includes(colecao)) {
            return res.status(400).json({ erro: "colecao deve ser simples_empresas ou lucro_empresas" });
        }

        const db = fa().firestore();
        const snap = await db.collection(colecao).doc(empresaId).get();
        if (!snap.exists) return res.status(404).json({ erro: 'empresa não encontrada' });

        const d = snap.data();
        const ccmSp = (d.ccmSp || '').toString().trim();
        const autorizado = d.nfseSpAutorizadoEm;
        if (!ccmSp || !autorizado) {
            return res.status(400).json({ erro: 'empresa não elegível: precisa ccmSp e nfseSpAutorizadoEm preenchidos' });
        }

        const empresa = {
            colecao,
            id: empresaId,
            cnpj: (d.cnpj || '').replace(/\D/g, ''),
            nome: d.razaoSocial || d.nome || empresaId,
            ccmSp,
            nfseSpAutorizadoEm: autorizado,
        };
        const r = await consultarUma(db, empresa, { periodo, importadoPor: req.user?.email || 'admin' });
        res.json(r);
    } catch (e) {
        console.error('[nfse-sp-routes] consultar-uma:', e);
        res.status(500).json({ erro: e.message });
    }
});

router.post('/nfsesp-consultar-todas', authUser, json(), async (req, res) => {
    try {
        const db = fa().firestore();
        const dryRun = req.body?.dryRun === true;
        const r = await consultarTodasElegiveis(db, {
            tipo: 'manual',
            dryRun,
            importadoPor: req.user?.email || 'admin',
        });
        res.json(r);
    } catch (e) {
        console.error('[nfse-sp-routes] consultar-todas:', e);
        res.status(500).json({ erro: e.message });
    }
});

router.post('/nfsesp-cron', json(), async (req, res) => {
    const headerSecret = req.header('X-Sefaz-Cron-Secret') || '';
    if (!CRON_SECRET || headerSecret !== CRON_SECRET) {
        return res.status(403).json({ erro: 'cron secret inválido' });
    }
    try {
        const db = fa().firestore();
        const dryRun = req.body?.dryRun !== false;
        const t0 = Date.now();
        const r = await consultarTodasElegiveis(db, {
            tipo: 'cron',
            dryRun,
            importadoPor: 'cron-scheduler',
        });

        try {
            await fa().firestore().collection('nfsesp_cron_logs').add({
                executadoEm: fa().firestore.FieldValue.serverTimestamp(),
                iniciadoEm: new Date(t0).toISOString(),
                dryRun,
                totalEmpresas: r.totalEmpresas,
                sucessos: r.sucessos,
                falhas: r.falhas,
                totalNFes: r.totalNFes,
                criadas: r.criadas,
                atualizadas: r.atualizadas,
                durationMs: r.durationMs,
            });
        } catch (logErr) {
            console.warn('[nfse-sp-routes] log do cron falhou:', logErr.message);
        }

        res.json(r);
    } catch (e) {
        console.error('[nfse-sp-routes] cron:', e);
        res.status(500).json({ erro: e.message });
    }
});

export default router;
