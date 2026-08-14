// ============================================================================
// sefaz-backend/lucro-empresas-routes.js  (ESM)
// ----------------------------------------------------------------------------
//   GET /api/admin/lucro/empresas-resumo   lista LEVE (cadastro, sem a ficha)
//
// A régua vive em `lucro-empresas-resumo.js` (puro, testado). Aqui é I/O.
//
// O `.select(...)` é o ponto da rota inteira: ele existe no Admin SDK e NÃO
// existe no SDK do navegador. É por isso que esta lista não podia ser montada
// no frontend — lá o documento vem inteiro, com todos os meses da ficha
// financeira junto.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { montarResumoLucro, CAMPOS_RESUMO } from './lucro-empresas-resumo.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

router.get('/empresas-resumo', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const snap = await db.collection('lucro_empresas').select(...CAMPOS_RESUMO).get();
        const resumo = montarResumoLucro(snap.docs.map((s) => ({ id: s.id, data: s.data() || {} })));
        return res.json({ ok: true, ...resumo });
    } catch (e) {
        console.error('[lucro/empresas-resumo]', e);
        // Falha DIZ o que fazer. O frontend cai no caminho antigo (documento
        // inteiro) — mais lento, porém funcionando: lista vazia aqui seria lida
        // como "não há empresas no Lucro", que é mentira e assusta.
        return res.status(500).json({
            ok: false,
            error: 'Não foi possível montar a lista do Lucro. A tela vai carregar pelo caminho antigo (mais lento). Se repetir, avise o administrador.',
        });
    }
});

export default router;
