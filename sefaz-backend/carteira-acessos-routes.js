import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAdmin, requireAuth } from './require-admin.js';

const router = Router();
const idValido = value => typeof value === 'string' && value.length > 0 && value.length < 200 && !value.includes('/');
const db = () => admin.firestore();

// Carteira e indice de autorizacao mudam na MESMA transacao.
router.post('/vinculos', requireAdmin, async (req, res) => {
    const novo = req.body || {};
    if (!idValido(novo.empresaId) || !idValido(novo.colaboradorUid) || !['simples_empresas', 'lucro_empresas'].includes(novo.empresaColecao) || !['principal', 'backup'].includes(novo.papel)) {
        return res.status(400).json({ error: 'Vinculo de carteira invalido' });
    }
    try {
        const result = await db().runTransaction(async tx => {
            const empresa = await tx.get(db().collection(novo.empresaColecao).doc(novo.empresaId));
            const usuario = await tx.get(db().collection('users').doc(novo.colaboradorUid));
            if (!empresa.exists || !usuario.exists) throw new Error('Empresa ou colaborador nao encontrado');
            const acl = db().collection('carteira_acessos').doc(novo.colaboradorUid);
            await tx.get(acl);
            const vinculos = await tx.get(db().collection('carteiras').where('colaboradorUid', '==', novo.colaboradorUid));
            const jaExistia = vinculos.docs.some(d => d.data().empresaId === novo.empresaId);
            const empresaIds = [...new Set([...vinculos.docs.map(d => d.data().empresaId).filter(idValido), novo.empresaId])].sort();
            if (!jaExistia) tx.set(db().collection('carteiras').doc(), {
                empresaId: novo.empresaId, empresaColecao: novo.empresaColecao,
                empresaNome: empresa.data().nome || '', empresaCnpj: empresa.data().cnpj || '',
                colaboradorUid: novo.colaboradorUid, colaboradorNome: usuario.data().name || '',
                papel: novo.papel, atribuidoPor: req.user.uid, atribuidoEm: admin.firestore.FieldValue.serverTimestamp(),
            });
            tx.set(acl, { empresaIds, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() });
            return { ok: true, jaExistia };
        });
        return res.json(result);
    } catch (err) { return res.status(500).json({ error: err.message }); }
});

router.delete('/vinculos/:id', requireAdmin, async (req, res) => {
    if (!idValido(req.params.id)) return res.status(400).json({ error: 'Vinculo invalido' });
    try {
        await db().runTransaction(async tx => {
            const ref = db().collection('carteiras').doc(req.params.id);
            const vinculo = await tx.get(ref);
            if (!vinculo.exists) return;
            const uid = vinculo.data().colaboradorUid;
            if (!idValido(uid)) throw new Error('Vinculo legado sem UID: requer revisao administrativa');
            const acl = db().collection('carteira_acessos').doc(uid);
            await tx.get(acl);
            const vinculos = await tx.get(db().collection('carteiras').where('colaboradorUid', '==', uid));
            const empresaIds = [...new Set(vinculos.docs.filter(d => d.id !== ref.id).map(d => d.data().empresaId).filter(idValido))].sort();
            tx.delete(ref);
            tx.set(acl, { empresaIds, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() });
        });
        return res.json({ ok: true });
    } catch (err) { return res.status(500).json({ error: err.message }); }
});

// A verificacao global nao devolve dados de empresas fora da carteira.
router.post('/verificar-cnpj', requireAuth, async (req, res) => {
    const cnpj = String(req.body?.cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ invalido' });
    try {
        for (const [colecao, regime] of [['simples_empresas', 'SIMPLES'], ['lucro_empresas', 'LUCRO']]) {
            const snap = await db().collection(colecao).select('cnpj', '_deleted', '_merged_into').get();
            if (snap.docs.some(d => d.id !== req.body.ignorarEmpresaId && !d.data()._deleted && !d.data()._merged_into && String(d.data().cnpj || '').replace(/\D/g, '') === cnpj)) return res.json({ duplicado: true, regime });
        }
        return res.json({ duplicado: false });
    } catch { return res.status(503).json({ error: 'Nao foi possivel verificar a unicidade do CNPJ' }); }
});
export default router;
