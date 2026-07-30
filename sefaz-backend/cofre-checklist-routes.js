// ============================================================================
// sefaz-backend/cofre-checklist-routes.js  (ESM)
//
// CHECKLIST DE MIGRAÇÃO DO COFRE DE SAÍDA: quem já recebe saída mod 55 via
// cofre de e-mail × quem ainda depende da SIEG (falta configurar o e-mail
// no emissor do cliente).
//
//   GET /api/admin/sefaz/cofre-checklist?inatividadeDias=30   (requireAdmin)
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { analisarChecklistCofre } from './cofre-checklist.js';

const router = express.Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

async function carregarEmpresas(db) {
    const out = [];
    for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
        const snap = await db.collection(col).get();
        snap.forEach((doc) => {
            const d = doc.data() || {};
            if (d._merged_into || d._deleted) return;
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

router.get('/cofre-checklist', requireAdmin, async (req, res) => {
    try {
        const inatividadeDias = Math.min(Math.max(Number(req.query.inatividadeDias) || 30, 1), 365);
        const db = getDb();
        const empresas = await carregarEmpresas(db);

        const snaps = await fetchAllDocs(
            db.collection('documentos_fiscais')
                .where('direcao', '==', 'saida')
                // capturadoPor entra pra classificar o trilho (importação manual
                // não confirma migração — mesma régua da Cobertura de Saída).
                .select('empresaCnpj', 'chave', 'origem', 'dhEmi', 'capturadoPor'),
            { label: 'cofre-checklist' },
        );
        const docsSaida = snaps.map((s) => s.data() || {});

        const relatorio = analisarChecklistCofre({
            empresas, docsSaida, agoraMs: Date.now(), inatividadeDias,
        });
        return res.json({ ...relatorio, geradoEm: new Date().toISOString() });
    } catch (e) {
        console.error('[cofre-checklist]', e);
        return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
    }
});

export default router;
