// ============================================================================
// sefaz-backend/diagnostico-cadastros-routes.js  (ESM)
//
// Varre simples_empresas + lucro_empresas e reporta empresas com cadastro
// incompleto (UF/codMunIBGE/anexo/tipoTributacao/etc) usando o helper PURO
// testado. So admin. Montado em: /api/admin/diagnostico-cadastros
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { pendenciasCadastro, gravidadeCadastro } from './diagnostico-cadastros-helper.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

router.get('/', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });

        const db = fa().firestore();
        const rank = { critico: 0, alto: 1, medio: 2, ok: 3 };
        const empresas = [];

        for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
            try {
                const snap = await db.collection(col).get();
                snap.forEach((doc) => {
                    const d = doc.data();
                    if (d._merged_into) return;
                    const pendencias = pendenciasCadastro(d, regime);
                    const gravidade = gravidadeCadastro(pendencias);
                    empresas.push({
                        id: doc.id,
                        cnpj: (d.cnpj || '').replace(/\D/g, ''),
                        nome: d.razaoSocial || d.nome || '',
                        regime,
                        gravidade,
                        pendencias,
                    });
                });
            } catch (e) {
                console.warn(`[diagnostico-cadastros] ${col} falhou:`, e.message);
            }
        }

        empresas.sort((a, b) => {
            const r = rank[a.gravidade] - rank[b.gravidade];
            if (r !== 0) return r;
            return (a.nome || '').localeCompare(b.nome || '');
        });

        const resumo = {
            total: empresas.length,
            criticos: empresas.filter((e) => e.gravidade === 'critico').length,
            altos: empresas.filter((e) => e.gravidade === 'alto').length,
            medios: empresas.filter((e) => e.gravidade === 'medio').length,
            ok: empresas.filter((e) => e.gravidade === 'ok').length,
        };

        return res.json({ resumo, empresas, geradoEm: new Date().toISOString() });
    } catch (e) {
        console.error('[diagnostico-cadastros]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

export default router;
