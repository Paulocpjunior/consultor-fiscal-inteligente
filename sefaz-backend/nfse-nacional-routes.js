// ============================================================================
// sefaz-backend/nfse-nacional-routes.js
// Express router pra NFSe Nacional. Montado em /api/admin/nfse-nacional.
// ============================================================================

import express from 'express';
import { requireAdmin, requireAuth } from './require-admin.js';
import {
    emitirNfse, cancelarNfse, listarNfse, getResumoNfse,
} from './nfse-nacional-orchestrator.js';
import { getNfseNacionalMode, NBS_CODIGOS_COMUNS } from './nfse-nacional-provider.js';

const router = express.Router();

// requireAdmin agora vem do middleware compartilhado (verifyIdToken)

router.get('/status', (_req, res) => {
    res.json({ mode: getNfseNacionalMode(), ok: true });
});

router.get('/resumo', requireAuth, async (_req, res) => {
    try { res.json(await getResumoNfse()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/listar', requireAuth, async (req, res) => {
    try {
        res.json(await listarNfse({
            empresaId: req.query.empresaId,
            status: req.query.status,
            dataInicio: req.query.dataInicio,
            dataFim: req.query.dataFim,
        }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/nbs', async (_req, res) => {
    // Se houver tabela oficial importada via /import-nbs-csv, usa ela.
    // Senao, retorna a tabela curada hardcoded.
    try {
        const admin = (await import('firebase-admin')).default;
        if (!admin.apps.length) {
            admin.initializeApp({ credential: admin.credential.applicationDefault() });
        }
        const db = admin.firestore();
        const snap = await db.collection('nbs_codigos_oficiais').limit(2000).get();
        if (!snap.empty) {
            const docs = snap.docs.map(d => d.data());
            docs.sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''));
            return res.json(docs);
        }
    } catch (err) {
        console.warn('[nfse-nacional/nbs] falha lendo Firestore, fallback hardcoded:', err.message);
    }
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

// Importa CSV NBS oficial (XLSX -> CSV).
// Formato esperado:
//   codigo,descricao,cIndOpSugerido,cClassTribSugerido
//   101010100,Contabilidade...,050201,00100001
//
// Persiste em colecao 'nbs_codigos_oficiais' (Firestore).
// Quando colecao tiver registros, getNbsCodigos retorna ela ao inves do hardcoded.
router.post('/import-nbs-csv', requireAdmin, express.text({ type: 'text/csv', limit: '10mb' }), async (req, res) => {
    try {
        const csvText = req.body || '';
        if (!csvText || typeof csvText !== 'string') {
            return res.status(400).json({ error: 'CSV vazio. Envie como text/csv no body.' });
        }
        const linhas = csvText.split(/\r?\n/).filter(l => l.trim());
        if (linhas.length < 2) return res.status(400).json({ error: 'CSV sem dados (precisa header + linhas)' });

        const header = linhas[0].split(',').map(s => s.trim().toLowerCase());
        const idxCodigo = header.indexOf('codigo');
        const idxDesc = header.indexOf('descricao');
        const idxIndOp = header.indexOf('cindopsugerido');
        const idxClass = header.indexOf('cclasstribsugerido');
        if (idxCodigo < 0 || idxDesc < 0) {
            return res.status(400).json({ error: 'Header deve ter ao menos: codigo,descricao' });
        }

        const admin = (await import('firebase-admin')).default;
        if (!admin.apps.length) {
            admin.initializeApp({ credential: admin.credential.applicationDefault() });
        }
        const db = admin.firestore();

        let inseridos = 0, ignorados = 0;
        let batch = db.batch();
        for (let i = 1; i < linhas.length; i++) {
            const cols = linhas[i].split(',');
            const codigo = (cols[idxCodigo] || '').trim();
            const descricao = (cols[idxDesc] || '').trim();
            if (!codigo || !descricao) { ignorados++; continue; }

            const ref = db.collection('nbs_codigos_oficiais').doc(codigo);
            batch.set(ref, {
                codigo,
                descricao,
                cIndOpSugerido: idxIndOp >= 0 ? (cols[idxIndOp] || '').trim() : '',
                cClassTribSugerido: idxClass >= 0 ? (cols[idxClass] || '').trim() : '',
                importadoEm: new Date().toISOString(),
            }, { merge: true });
            inseridos++;
            if (inseridos % 400 === 0) {
                await batch.commit();
                batch = db.batch();
            }
        }
        await batch.commit();
        return res.json({ ok: true, inseridos, ignorados, totalLinhas: linhas.length - 1 });
    } catch (err) {
        console.error('[nfse-nacional/import-nbs-csv]', err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;
