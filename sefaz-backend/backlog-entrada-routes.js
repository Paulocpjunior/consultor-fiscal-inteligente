// ============================================================================
// sefaz-backend/backlog-entrada-routes.js  (ESM)
//
// Relatorio de BACKLOG DE ENTRADA: por empresa, completas × resumos pendentes
// de ciência × travadas (nsuTravado/pendenciaNSU) — o termômetro do
// "substituir a SIEG" na captura de entrada.
//
//   GET /api/admin/sefaz/backlog-entrada   (requireAdmin)
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { analisarBacklogEntrada } from './backlog-entrada.js';

const router = express.Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

// Mesma enumeração do cobertura-saida (Simples + Lucro, CNPJ válido).
async function carregarEmpresas(db) {
    const out = [];
    for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
        const snap = await db.collection(col).get();
        snap.forEach((doc) => {
            const d = doc.data() || {};
            if (d._merged_into) return;
            const cnpj = String(d.cnpj || '').replace(/\D/g, '');
            if (cnpj.length !== 14) return;
            out.push({
                empresaId: doc.id,
                cnpj,
                nome: d.razaoSocial || d.nome || d.fantasia || '—',
                regime,
            });
        });
    }
    return out;
}

router.get('/backlog-entrada', requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const empresas = await carregarEmpresas(db);

        // Só entrada; select reduz o payload (eventos é necessário pra saber se
        // o resumo já tem Ciência).
        const snaps = await fetchAllDocs(
            db.collection('documentos_fiscais')
                .where('direcao', '==', 'entrada')
                .select('empresaCnpj', 'empresaId', 'schema', 'tipoDoc', 'eventos', 'dhEmi'),
            { label: 'backlog-entrada' },
        );
        const docs = snaps.map((s) => s.data() || {});

        // Estado NSU por CNPJ (última sync, pendência, trava).
        const states = {};
        const stSnap = await db.collection('sefaz_state').get();
        stSnap.forEach((doc) => {
            const d = doc.data() || {};
            states[doc.id] = {
                ultimaSyncMs: d.ultimaSync?.toMillis ? d.ultimaSync.toMillis() : null,
                cStatUltimaSync: d.cStatUltimaSync || null,
                pendenciaNSU: Number(d.pendenciaNSU) || 0,
                nsuTravado: d.nsuTravado || null,
            };
        });

        const relatorio = analisarBacklogEntrada({ empresas, docs, states, agoraMs: Date.now() });
        return res.json({ ...relatorio, geradoEm: new Date().toISOString() });
    } catch (e) {
        console.error('[backlog-entrada]', e);
        return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
    }
});

export default router;
