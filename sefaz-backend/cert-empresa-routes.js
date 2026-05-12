// ============================================================================
// sefaz-backend/cert-empresa-routes.js
// Express router para upload/list/delete de certificados POR EMPRESA.
// ============================================================================

import express from 'express';
import multer from 'multer';
import {
    uploadCertEmpresa,
    loadCertEmpresa,
    deleteCertEmpresa,
    getCertInfoEmpresa,
    listCertsEmpresas,
} from './cert-storage.js';

const router = express.Router();

// Multer em memoria, ate 5MB (certs A1 sao tipicamente 5-10KB)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});

// Middleware de auth (segue padrao do projeto)
function requireAuth(req, res, next) {
    const role = req.headers['x-user-role'] || 'colaborador';
    const userEmail = req.headers['x-user-email'] || 'unknown';
    const userUid = req.headers['x-user-uid'] || null;
    if (!['admin', 'colaborador'].includes(role)) {
        return res.status(403).json({ error: 'sem permissao' });
    }
    req.user = { role, email: userEmail, uid: userUid };
    next();
}

// ── POST /upload — sobe um cert pra uma empresa ──────────────────────────
// Body: multipart/form-data
//   - cert: arquivo .pfx (binary)
//   - password: senha do .pfx (string)
//   - empresaId: id da empresa
router.post('/upload', requireAuth, upload.single('cert'), async (req, res) => {
    try {
        const { empresaId, password } = req.body || {};
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });
        if (!password) return res.status(400).json({ error: 'password obrigatoria' });
        if (!req.file?.buffer) return res.status(400).json({ error: 'arquivo cert ausente' });

        const result = await uploadCertEmpresa(empresaId, req.file.buffer, password, {
            email: req.user.email,
            uid: req.user.uid,
        });

        return res.json(result);
    } catch (err) {
        console.error('[cert-empresa/upload]', err);
        // Erros de cripto/forge geralmente sao senha errada
        const msg = err.message || 'erro desconhecido';
        const status = /password|senha|MAC|pkcs12|asn1|cert/i.test(msg) ? 400 : 500;
        return res.status(status).json({ ok: false, error: msg });
    }
});

// ── GET /list — lista todos os certs cadastrados (so metadados) ──────────
router.get('/list', requireAuth, async (req, res) => {
    try {
        const lista = await listCertsEmpresas();
        return res.json({ ok: true, total: lista.length, certs: lista });
    } catch (err) {
        console.error('[cert-empresa/list]', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /info/:empresaId — info de 1 cert especifico ─────────────────────
router.get('/info/:empresaId', requireAuth, async (req, res) => {
    try {
        const info = await getCertInfoEmpresa(req.params.empresaId);
        if (!info) return res.status(404).json({ ok: false, error: 'cert nao encontrado' });
        return res.json({ ok: true, ...info });
    } catch (err) {
        console.error('[cert-empresa/info]', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// ── DELETE /:empresaId — deleta o cert ───────────────────────────────────
router.delete('/:empresaId', requireAuth, async (req, res) => {
    try {
        const result = await deleteCertEmpresa(req.params.empresaId);
        if (!result.ok) return res.status(404).json(result);
        return res.json(result);
    } catch (err) {
        console.error('[cert-empresa/delete]', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /test/:empresaId — testa o cert chamando SEFAZ ──────────────────
// Util pra UI confirmar visualmente que o cert funciona
router.post('/test/:empresaId', requireAuth, async (req, res) => {
    try {
        const empresaId = req.params.empresaId;
        const cert = await loadCertEmpresa(empresaId);
        if (!cert) return res.status(404).json({ ok: false, error: 'cert nao encontrado' });

        // Importa dinamicamente pra evitar circular import
        const { consultaDistDFeComCert } = await import('./sefaz-client.js');
        if (typeof consultaDistDFeComCert !== 'function') {
            return res.json({ ok: true, motivo: 'cert carregado mas funcao de teste nao disponivel ainda', cnpj: cert.cnpj });
        }

        const result = await consultaDistDFeComCert({ cnpj: cert.cnpj, ultNSU: '0', certOverride: cert });
        return res.json({
            ok: result.cStat === '138' || result.cStat === '137',
            cStat: result.cStat,
            xMotivo: result.xMotivo,
            ultNSU: result.ultNSU,
            maxNSU: result.maxNSU,
            docsCount: result.xmls?.length || 0,
        });
    } catch (err) {
        console.error('[cert-empresa/test]', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

export default router;
