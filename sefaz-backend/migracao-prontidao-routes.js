// ============================================================================
// sefaz-backend/migracao-prontidao-routes.js  (ESM)
//
// GET /api/admin/sped/prontidao-migracao?competencia=AAAA-MM
//
// F0 automático: uma leitura de documentos_fiscais da competência (campos
// mínimos) + cadastro das empresas → prontidão de migração por empresa e
// candidatos a piloto (núcleo puro migracao-prontidao.js). Mesma régua da
// rota de faturamento: server-side pra não esbarrar no teto de list do
// front; farol honesto no payload (lidos/ignorados).
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { montarProntidaoMigracao } from './migracao-prontidao.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

router.get('/prontidao-migracao', requireAuth, async (req, res) => {
    try {
        const competencia = String(req.query.competencia || '').trim();
        if (!/^\d{4}-\d{2}$/.test(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });
        }
        const db = getDb();

        const empresas = [];
        for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
            const snap = await db.collection(col).get();
            snap.forEach((doc) => {
                const d = doc.data() || {};
                if (d._deleted || d._merged_into) return;
                const df = d.dadosFiscais || {};
                empresas.push({
                    id: doc.id,
                    nome: d.razaoSocial || d.nome || d.fantasia || '—',
                    cnpj: d.cnpj,
                    regime,
                    uf: df.uf || d.uf || '',
                    industriaCadastro: df.indAtividade === 'industrial' || df.naturezaAtividade === 'industria',
                });
            });
        }

        const snaps = await fetchAllDocs(
            db.collection('documentos_fiscais')
                .where('competencia', '==', competencia)
                .select('empresaId', 'direcao', 'tpNF', 'status', 'modelo',
                    'totais.vST', 'totais.vBCST', 'totais.vIPI',
                    'emitente.cnpjCpf', 'emitente.uf'),
            { label: `prontidao-migracao ${competencia}`, maxDocs: 80000 },
        );
        const docs = snaps.map((s) => ({ ...s.data() }));

        const resultado = montarProntidaoMigracao(docs, empresas);
        return res.json({
            ok: true,
            competencia,
            lidos: snaps.length,
            ...resultado,
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[sped/prontidao-migracao]', e);
        return res.status(500).json({ ok: false, error: `Falha ao montar a prontidão: ${e.message}` });
    }
});

export default router;
