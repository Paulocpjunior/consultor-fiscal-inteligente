// GET /api/admin/credencial-email/vigia — o veredito gravado pelo vigia
// noturno, para a faixa da Rotina do Mês. Qualquer usuário logado lê (quem
// manda guia precisa saber que o e-mail está fora); só admin pode sondar agora.
import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { COLECAO_VIGIA, DOC_VIGIA, faixaDoVigia, vigiarCredencialGraph } from './graph-credencial-vigia.js';

const router = Router();
function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

router.get('/vigia', requireAuth, async (_req, res) => {
    try {
        const snap = await getDb().collection(COLECAO_VIGIA).doc(DOC_VIGIA).get();
        const doc = snap.exists ? snap.data() : null;
        return res.json({ ok: true, vigia: doc, faixa: faixaDoVigia(doc) });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/vigia/sondar', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ ok: false, error: 'Apenas administradores' });
        const doc = await vigiarCredencialGraph(getDb());
        return res.json({ ok: true, vigia: doc, faixa: faixaDoVigia(doc) });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
