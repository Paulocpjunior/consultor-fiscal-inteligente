// ============================================================================
// sefaz-backend/xml-download-routes.js  (ESM)
// ----------------------------------------------------------------------------
// GET /api/admin/sefaz/xml-bruto?chave=<44 dígitos>
//
// Download do XML original pela ROTA, não pelo SDK do Storage no navegador.
// O caminho antigo (getBlob no cliente) dependia de três coisas fora do nosso
// controle na tela: o bucket do build do front (VITE_FIREBASE_STORAGE_BUCKET
// pode divergir do STORAGE_BUCKET que o importer usa), o CORS do bucket e as
// storage.rules (que não cobriam xmls/{empresa}/eventos/…). Qualquer uma das
// três vira "storage/retry-limit-exceeded" genérico no navegador (31/07,
// colaborador baixando nota do EDUARDO GUERRA).
//
// Aqui o Admin SDK lê do MESMO bucket em que o importer gravou, sem CORS e sem
// rules — e a autorização é a da carteira, igual ao resto do app. O caminho no
// Storage sai do PRÓPRIO doc (nunca do cliente): sem path traversal.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { Storage } from '@google-cloud/storage';
import { requireAuth } from './require-admin.js';
import { podeAcessarCnpj } from './carteira-auth.js';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'consultorfiscalapp';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const storage = new Storage();

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

router.get('/xml-bruto', requireAuth, async (req, res) => {
    try {
        const chave = soDigitos(req.query.chave);
        if (chave.length !== 44) {
            return res.status(400).json({ ok: false, error: 'Informe a chave de acesso completa (44 dígitos).' });
        }

        const db = getDb();
        const snap = await db.collection('documentos_fiscais')
            .where('chave', '==', chave)
            .limit(1)
            .get();
        if (snap.empty) {
            return res.status(404).json({ ok: false, error: 'Documento não encontrado no banco por esta chave.' });
        }
        const d = snap.docs[0].data() || {};

        const acesso = await podeAcessarCnpj(req.user, d.empresaCnpj || chave.slice(6, 20));
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        if (!d.storagePath) {
            return res.status(404).json({
                ok: false,
                error: 'Este documento não tem XML guardado — é um resumo da SEFAZ (resNFe) ou uma importação sem arquivo. '
                    + 'Manifeste a ciência para liberar o XML completo, ou importe o arquivo do cliente.',
            });
        }

        const file = storage.bucket(STORAGE_BUCKET).file(d.storagePath);
        const [existe] = await file.exists();
        if (!existe) {
            return res.status(404).json({
                ok: false,
                error: `O XML não está no Storage (${d.storagePath}). O registro existe no banco, mas o arquivo se perdeu — `
                    + 'recapture a nota (Consulta por chave) ou importe o arquivo do cliente.',
            });
        }
        const [conteudo] = await file.download();

        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${chave}.xml"`);
        return res.send(conteudo);
    } catch (e) {
        console.error('[xml-bruto]', e);
        return res.status(500).json({ ok: false, error: `Falha ao ler o XML no servidor: ${e.message}` });
    }
});

export default router;
