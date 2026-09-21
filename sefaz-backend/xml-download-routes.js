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
import multer from 'multer';
import { requireAuth } from './require-admin.js';
import { podeAcessarCnpj, podeAcessarEmpresaId } from './carteira-auth.js';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'consultorfiscalapp';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const storage = new Storage();

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

async function acessoEmpresa(user, empresaId) {
    if (typeof empresaId !== 'string' || !empresaId || empresaId.includes('/')) return { ok: false, status: 400, error: 'Empresa invalida' };
    const acesso = await podeAcessarEmpresaId(user, empresaId);
    if (acesso.ok) return acesso;
    for (const col of ['simples_empresas', 'lucro_empresas']) {
        const empresa = await getDb().collection(col).doc(empresaId).get();
        if (empresa.data()?.createdBy === user.uid) return { ok: true };
    }
    return acesso;
}

router.post('/arquivo-original-upload', requireAuth, upload.single('arquivo'), async (req, res) => {
    try {
        const { empresaId, storagePath } = req.body || {};
        const acesso = await acessoEmpresa(req.user, empresaId);
        if (!acesso.ok) return res.status(acesso.status).json({ error: acesso.error });
        const pdf = req.file?.mimetype === 'application/pdf';
        if (!pdf && req.file?.size > 10 * 1024 * 1024) return res.status(413).json({ error: 'XML excede 10 MB' });
        const mimeOk = pdf || ['application/xml', 'text/xml'].includes(req.file?.mimetype);
        const prefix = `${pdf ? 'nfse_pdfs' : 'xmls'}/${empresaId}/`;
        if (!mimeOk || typeof storagePath !== 'string' || !storagePath.startsWith(prefix)
            || !/^[a-zA-Z0-9_.-]+$/.test(storagePath.slice(prefix.length)) || storagePath.includes('..')) {
            return res.status(400).json({ error: 'Arquivo ou caminho invalido' });
        }
        // GCS, nao Firebase upload: nao cria token publico de download.
        await storage.bucket(STORAGE_BUCKET).file(storagePath).save(req.file.buffer, {
            resumable: false, metadata: { contentType: req.file.mimetype, metadata: {} },
        });
        return res.json({ storagePath, storageUrl: '' });
    } catch (err) {
        console.error('[arquivo-original-upload]', err.message);
        return res.status(500).json({ error: 'Nao foi possivel guardar o arquivo original' });
    }
});

router.get('/arquivo-original/:id', requireAuth, async (req, res) => {
    try {
        if (req.params.id.includes('/')) return res.status(400).json({ error: 'Documento invalido' });
        const db = getDb();
        const snap = await db.collection('documentos_fiscais').doc(req.params.id).get();
        if (!snap.exists) return res.status(404).json({ error: 'Documento nao encontrado' });
        const d = snap.data();
        const acesso = await acessoEmpresa(req.user, d.empresaId);
        if (!acesso.ok) return res.status(acesso.status).json({ error: acesso.error });
        const path = d.storagePath || '';
        if ((!path.startsWith(`xmls/${d.empresaId}/`) && !path.startsWith(`nfse_pdfs/${d.empresaId}/`)) || path.includes('..')) return res.status(404).json({ error: 'Arquivo original nao localizado na empresa deste documento' });
        const pdf = d.storagePath.startsWith('nfse_pdfs/');
        const [conteudo] = await storage.bucket(STORAGE_BUCKET).file(d.storagePath).download();
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Content-Type', pdf ? 'application/pdf' : 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="documento.${pdf ? 'pdf' : 'xml'}"`);
        return res.send(conteudo);
    } catch (err) {
        console.error('[arquivo-original]', err.message);
        return res.status(500).json({ error: 'Nao foi possivel recuperar o arquivo original' });
    }
});

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
