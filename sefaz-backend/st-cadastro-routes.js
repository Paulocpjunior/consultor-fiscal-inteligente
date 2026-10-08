// ============================================================================
// sefaz-backend/st-cadastro-routes.js
// ----------------------------------------------------------------------------
//   GET /api/sped-st-por-uf/:empresaId
//   PUT /api/sped-st-por-uf/:empresaId   { linhas: [{uf, ie, codOr, codRec, diaVencimento}] }
//
// 🏛️ Cadastro FIXO de IE de substituto tributário por UF (08/10, FLANACAR):
// com ele o E250 (a guia do ICMS-ST) sai sozinho em toda competência — ver
// `st-cadastro-uf.js`. Cada gravação fica no histórico do doc (quem, quando,
// o que), porque código de receita trocado muda a guia de todo mês seguinte.
// ============================================================================
import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { podeAcessarEmpresaId } from './carteira-auth.js';
import { validarCadastroStUf } from './st-cadastro-uf.js';
import { COLECAO_ST_POR_UF } from './st-cadastro-store.js';

// O corpo JSON já chega parseado pelo parser global do server.js.
const router = Router();

async function conferirAcesso(req, res) {
    const empresaId = String(req.params?.empresaId || '').trim();
    if (!empresaId) { res.status(400).json({ ok: false, erro: 'Empresa não informada.' }); return null; }
    if (req.user?.role !== 'admin') {
        const check = await podeAcessarEmpresaId(req.user, empresaId);
        if (!check.ok) { res.status(check.status || 403).json({ ok: false, erro: check.error }); return null; }
    }
    return empresaId;
}

router.get('/:empresaId', requireAuth, async (req, res) => {
    try {
        const empresaId = await conferirAcesso(req, res);
        if (!empresaId) return undefined;
        const snap = await admin.firestore().collection(COLECAO_ST_POR_UF).doc(empresaId).get();
        const d = snap.exists ? (snap.data() || {}) : {};
        return res.json({
            ok: true,
            ufs: d.ufs || {},
            atualizadoPor: d.atualizadoPor || null,
            atualizadoEm: d.atualizadoEm || null,
        });
    } catch (e) {
        console.error('[sped-st-por-uf/ler]', e);
        return res.status(500).json({ ok: false, erro: e?.message || 'Falha ao ler o cadastro.' });
    }
});

router.put('/:empresaId', requireAuth, async (req, res) => {
    try {
        const empresaId = await conferirAcesso(req, res);
        if (!empresaId) return undefined;
        const v = validarCadastroStUf(req.body?.linhas);
        if (!v.ok) return res.status(400).json({ ok: false, erros: v.erros, erro: v.erros.join(' ') });
        const em = new Date().toISOString();
        const por = req.user?.email || req.user?.uid || null;
        // `mergeFields`: o mapa `ufs` é SUBSTITUÍDO inteiro (UF removida da tela
        // sai do cadastro — um merge comum a preservaria) e o histórico acumula.
        const campos = ['empresaId', 'ufs', 'atualizadoPor', 'atualizadoEm', 'historico'];
        await admin.firestore().collection(COLECAO_ST_POR_UF).doc(empresaId).set({
            empresaId,
            ufs: v.ufs,
            atualizadoPor: por,
            atualizadoEm: em,
            historico: admin.firestore.FieldValue.arrayUnion({ em, por, ufs: v.ufs }),
        }, { mergeFields: campos });
        return res.json({ ok: true, ufs: v.ufs, atualizadoPor: por, atualizadoEm: em });
    } catch (e) {
        console.error('[sped-st-por-uf/gravar]', e);
        return res.status(500).json({ ok: false, erro: e?.message || 'Falha ao gravar o cadastro.' });
    }
});

export default router;
