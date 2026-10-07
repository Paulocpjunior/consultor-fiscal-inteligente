import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { validarPermissoesCfi, permissoesEfetivasCfi } from './cfi-acesso.js';
const router = express.Router();
router.get('/:uid/historico', requireAdmin, async (req, res) => {
    try {
        const snap = await admin.firestore().collection('permissoes_auditoria').where('alvoUid', '==', req.params.uid).get();
        const itens = snap.docs.map(d => { const v = d.data(); return { id: d.id, em: v.em?.toMillis?.() || 0, autor: v.autorEmail || v.autorUid, evento: v.evento || 'permissoes', gestorDepois: v.gestorDepois ?? null, adminDepois: v.adminDepois ?? null, antes: v.antes, depois: v.depois }; });
        res.json(itens.sort((a, b) => b.em - a.em).slice(0, 20));
    } catch { res.status(503).json({ error: 'Não foi possível consultar o histórico.' }); }
});
router.put('/:uid', requireAdmin, express.json(), async (req, res) => {
    const { permissoes, revisao } = req.body || {};
    if (!validarPermissoesCfi(permissoes) || !Number.isInteger(revisao) || revisao < 0) {
        return res.status(400).json({ error: 'Nível ou ações inválidas. Reabra o cadastro e confira as permissões.' });
    }
    try {
        const db = admin.firestore();
        const ref = db.collection('users').doc(req.params.uid);
        const log = db.collection('permissoes_auditoria').doc();
        await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });
            const antes = snap.data();
            if ((antes.permissoesCfiRevisao || 0) !== revisao) throw Object.assign(new Error('Outra alteração foi salva. Reabra o usuário antes de continuar.'), { status: 409 });
            tx.update(ref, { permissoesCfi: permissoes, permissoesCfiRevisao: revisao + 1 });
            tx.set(log, { aplicativo: 'cfi', alvoUid: req.params.uid, autorUid: req.user.uid,
                antes: permissoesEfetivasCfi(antes), configuracaoAnterior: antes.permissoesCfi || null, autorEmail: req.user.email || null,
                depois: permissoes, revisao: revisao + 1, em: admin.firestore.FieldValue.serverTimestamp() });
        });
        return res.json({ ok: true, permissoes, revisao: revisao + 1 });
    } catch (e) { return res.status(e.status || 503).json({ error: e.status ? e.message : 'Não foi possível salvar as permissões e o histórico. Tente novamente.' }); }
});
export default router;
