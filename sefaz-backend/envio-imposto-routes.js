// ============================================================================
// sefaz-backend/envio-imposto-routes.js  (ESM)
// ----------------------------------------------------------------------------
// Rotas da ORDEM TÉCNICA do envio de imposto (ver envio-imposto.js):
//   POST /api/admin/envio-imposto/registrar — registra um envio feito pelo
//        colaborador (mailto/whatsapp/portal) e executa o rito completo:
//        cópia no SharePoint (pasta IMPOSTOS) + baixa da obrigação + auditoria.
//        O envio via Graph do DAS chama o rito direto no server.js.
//   GET  /api/admin/envio-imposto/historico — auditoria (impostos_enviados).
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { podeAcessarCnpj } from './carteira-auth.js';
import { executarRitoEnvioImposto, GESTOR_EMAIL } from './envio-imposto.js';

const router = Router();

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

router.post('/registrar', requireAuth, async (req, res) => {
    try {
        const {
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            canal, para, pdfBase64, pdfFileName, valor,
        } = req.body || {};
        if (!empresaCnpj || !tipo || !competencia) {
            return res.status(400).json({ ok: false, error: 'empresaCnpj + tipo + competencia são obrigatórios' });
        }
        const acesso = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        const r = await executarRitoEnvioImposto({
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            canal: canal || 'email-app',
            para: para || null,
            pdfBase64, pdfFileName,
            valor,
            enviadoPor: req.user?.email || req.user?.uid || null,
        });
        console.log(`[envio-imposto] ${tipo} ${empresaCnpj} ${competencia} via ${canal || 'email-app'} por ${req.user?.email} — sp=${r.sharePoint.status} baixa=${r.baixa.status}`);
        return res.json({ ok: true, gestor: GESTOR_EMAIL, ...r });
    } catch (e) {
        console.error('[envio-imposto/registrar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/historico', requireAuth, async (req, res) => {
    try {
        const cnpj = String(req.query.cnpj || '').replace(/\D/g, '');
        const limite = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);
        const db = fa().firestore();
        let q = db.collection('impostos_enviados');
        if (cnpj) q = q.where('empresaCnpj', '==', cnpj);
        const snap = await q.limit(limite).get();
        const envios = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => {
                const ta = a.enviadoEm?.toMillis?.() || 0;
                const tb = b.enviadoEm?.toMillis?.() || 0;
                return tb - ta;
            })
            .map((x) => ({ ...x, enviadoEm: x.enviadoEm?.toDate?.()?.toISOString?.() || null }));
        return res.json({ ok: true, envios });
    } catch (e) {
        console.error('[envio-imposto/historico]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
