// ============================================================================
// sefaz-backend/empresas-merge-routes.js  (ESM)
// ----------------------------------------------------------------------------
// Mesclagem de empresas DUPLICADAS (mesmo CNPJ, as duas com dados) — ADMIN.
//   POST /api/admin/empresas-merge/preview  — o que seria mesclado (sem tocar)
//   POST /api/admin/empresas-merge/executar — aplica: patch no vencedor +
//        lápide _merged_into no perdedor + auditoria (empresas_mesclagens).
// Preview OBRIGATÓRIO no front antes do executar (mesmo padrão da
// retificação MIT). Lógica pura em empresa-merge.js (testada).
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { mesclarDadosEmpresas } from './empresa-merge.js';

const router = Router();

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

const COLECOES = { lucro: 'lucro_empresas', simples: 'simples_empresas' };

async function carregarPar(db, regime, vencedorId, perdedorId) {
    const col = COLECOES[regime];
    if (!col) throw new Error(`regime deve ser 'lucro' ou 'simples' (recebido: ${regime})`);
    if (!vencedorId || !perdedorId || vencedorId === perdedorId) {
        throw new Error('vencedorId e perdedorId (diferentes) são obrigatórios.');
    }
    const [vSnap, pSnap] = await Promise.all([
        db.collection(col).doc(vencedorId).get(),
        db.collection(col).doc(perdedorId).get(),
    ]);
    if (!vSnap.exists) throw new Error(`Vencedor ${vencedorId} não encontrado em ${col}.`);
    if (!pSnap.exists) throw new Error(`Perdedor ${perdedorId} não encontrado em ${col}.`);
    return { col, vencedor: vSnap.data(), perdedor: pSnap.data(), vRef: vSnap.ref, pRef: pSnap.ref };
}

router.post('/preview', requireAdmin, async (req, res) => {
    try {
        const { regime, vencedorId, perdedorId } = req.body || {};
        const db = fa().firestore();
        const { vencedor, perdedor } = await carregarPar(db, regime, vencedorId, perdedorId);
        const r = mesclarDadosEmpresas(regime, vencedor, perdedor);
        if (!r.ok) return res.status(400).json({ ok: false, error: r.erro });
        return res.json({
            ok: true,
            resumo: r.resumo,
            conflitos: r.conflitos,
            vencedor: { id: vencedorId, nome: vencedor.razaoSocial || vencedor.nome || '—' },
            perdedor: { id: perdedorId, nome: perdedor.razaoSocial || perdedor.nome || '—' },
        });
    } catch (e) {
        return res.status(400).json({ ok: false, error: e.message });
    }
});

router.post('/executar', requireAdmin, async (req, res) => {
    try {
        const { regime, vencedorId, perdedorId } = req.body || {};
        const db = fa().firestore();
        const { col, vencedor, perdedor, vRef, pRef } = await carregarPar(db, regime, vencedorId, perdedorId);
        // Remonta TUDO no servidor — nada é confiado do preview do cliente.
        const r = mesclarDadosEmpresas(regime, vencedor, perdedor);
        if (!r.ok) return res.status(400).json({ ok: false, error: r.erro });

        const batch = db.batch();
        if (Object.keys(r.patch).length > 0) batch.set(vRef, r.patch, { merge: true });
        batch.set(pRef, {
            _merged_into: vencedorId,
            _merged_at: new Date().toISOString(),
            _merged_by: req.user?.email || req.user?.uid || 'admin',
        }, { merge: true });
        await batch.commit();

        // Auditoria: o que foi copiado, conflitos, quem executou.
        let logId = null;
        try {
            const log = await db.collection('empresas_mesclagens').add({
                colecao: col,
                vencedorId, perdedorId,
                cnpj: String(vencedor.cnpj || '').replace(/\D/g, ''),
                resumo: r.resumo,
                conflitos: r.conflitos,
                executadoPor: req.user?.email || req.user?.uid || null,
                executadoEm: admin.firestore.FieldValue.serverTimestamp(),
            });
            logId = log.id;
        } catch (e) {
            console.warn('[empresas-merge] auditoria falhou:', e.message);
        }
        console.log(`[empresas-merge] ${col}: ${perdedorId} → ${vencedorId} por ${req.user?.email} (${JSON.stringify(r.resumo)})`);
        return res.json({ ok: true, resumo: r.resumo, conflitos: r.conflitos, logId });
    } catch (e) {
        return res.status(400).json({ ok: false, error: e.message });
    }
});

export default router;
