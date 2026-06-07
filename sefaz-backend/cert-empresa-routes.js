// ============================================================================
// sefaz-backend/cert-empresa-routes.js
// Express router para upload/list/delete de certificados POR EMPRESA.
// ============================================================================

import express from 'express';
import multer from 'multer';
import admin from 'firebase-admin';
import {
    uploadCertEmpresa,
    loadCertEmpresa,
    deleteCertEmpresa,
    getCertInfoEmpresa,
    listCertsEmpresas,
} from './cert-storage.js';
import { requireAdmin, requireAuth } from './require-admin.js';
import { podeAcessarEmpresaId } from './carteira-auth.js';

const router = express.Router();

// CNPJ do escritorio (S&P). O cert dele vive no Secret Manager (cert-manager.js
// → sefaz_certificados/atual), NAO em empresas_certificados. Subir por esta
// rota per-empresa cria um cert que a captura real, manifesto e monitor de
// vencimento nao usam — gap reportado: cert novo subido aqui, monitor seguia
// mostrando o antigo. Bloqueamos no backend tambem (defesa em profundidade
// alem do guard de UI).
const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

// Resolve o CNPJ de uma empresa pelo id (simples_empresas | lucro_empresas).
async function cnpjDaEmpresa(empresaId) {
    if (!empresaId) return null;
    const db = fa().firestore();
    for (const col of ['simples_empresas', 'lucro_empresas']) {
        try {
            const snap = await db.collection(col).doc(empresaId).get();
            if (snap.exists) return String(snap.data()?.cnpj || '').replace(/\D/g, '');
        } catch { /* tenta a proxima colecao */ }
    }
    return null;
}

// Middleware: usado APOS requireAuth. Garante que admin OU colaborador-com-
// a-empresa-na-carteira pode acessar a rota. Pega empresaId de req.params
// (rotas /:empresaId) ou de req.body (upload).
async function requireCarteira(req, res, next) {
    const empresaId = req.params.empresaId || req.body?.empresaId;
    const check = await podeAcessarEmpresaId(req.user, empresaId);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
    next();
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});

// ── POST /upload — sobe um cert pra uma empresa ──────────────────────────
// Body: multipart/form-data
//   - cert: arquivo .pfx (binary)
//   - password: senha do .pfx (string)
//   - empresaId: id da empresa
//
// AUDITORIA 06/2026: troca requireCarteira -> requireAdmin no UPLOAD.
// Antes, qualquer colaborador da carteira podia SOBRESCREVER o .pfx da
// empresa (perde acesso ate o admin reuplodar). Visualizacao (GET /info,
// POST /test) continua com requireCarteira - so a operacao destrutiva
// virou admin-only. Em paralelo, GET /list e DELETE ja eram admin.
router.post('/upload', requireAdmin, upload.single('cert'), async (req, res) => {
    try {
        const { empresaId, password } = req.body || {};
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });
        if (!password) return res.status(400).json({ error: 'password obrigatoria' });
        if (!req.file?.buffer) return res.status(400).json({ error: 'arquivo cert ausente' });

        // Bloqueia upload per-empresa do escritorio (S&P). O cert dele deve ir
        // pro Secret Manager via POST /api/admin/sefaz/cert. Aqui criaria um
        // cert fantasma fora do radar da captura/manifesto/monitor.
        const cnpjEmp = await cnpjDaEmpresa(empresaId);
        if (cnpjEmp && cnpjEmp === CNPJ_ESCRITORIO) {
            return res.status(400).json({
                ok: false,
                error: 'Este é o certificado do escritório (S&P). Envie-o pela aba ' +
                       'Configurações → Certificado Digital (vai pro Secret Manager e atualiza ' +
                       'captura, manifesto e o monitor de vencimento). Upload per-empresa não é usado pra S&P.',
            });
        }

        const result = await uploadCertEmpresa(empresaId, req.file.buffer, password, {
            email: req.user.email,
            uid: req.user.uid,
        });

        return res.json(result);
    } catch (err) {
        console.error('[cert-empresa/upload]', err);
        const msg = err.message || 'erro desconhecido';

        // Classificacao precisa do erro pra NAO mascarar problema de infra
        // como "senha errada". Tres familias:
        //  1) Senha/.pfx invalido (node-forge)  -> 400, culpa do input
        //  2) Secret Manager / Storage / infra  -> 503, culpa do ambiente
        //  3) Resto                              -> 500
        const ehSenhaOuPfx = /MAC could not be verified|Invalid password|PKCS#12|pkcs12|asn1|Too few bytes|unsupported|integrity|DER/i.test(msg);
        const ehInfra = /Secret\b|secretmanager|cfi-empresa-cert-key|PERMISSION_DENIED|NOT_FOUND|accessSecretVersion|bucket|storage|AES key invalida|Could not (load|refresh) default credentials/i.test(msg);

        if (ehSenhaOuPfx) {
            return res.status(400).json({ ok: false, error: 'Senha incorreta ou arquivo .pfx invalido.' });
        }
        if (ehInfra) {
            // Mensagem acionavel pro operador — sem expor o erro cru do GCP no toast.
            return res.status(503).json({
                ok: false,
                error: 'Falha de infraestrutura ao guardar o certificado (Secret Manager/Storage). ' +
                       'Verifique se o secret "cfi-empresa-cert-key" existe no projeto e se a service account do Cloud Run tem acesso. Detalhe nos logs.',
                _infra: true,
            });
        }
        return res.status(500).json({ ok: false, error: msg });
    }
});

// ── GET /list — lista todos os certs cadastrados (so metadados) ──────────
router.get('/list', requireAdmin, async (req, res) => {
    try {
        const lista = await listCertsEmpresas();
        return res.json({ ok: true, total: lista.length, certs: lista });
    } catch (err) {
        console.error('[cert-empresa/list]', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /info/:empresaId — info de 1 cert especifico ─────────────────────
// Retorna SEMPRE 200 quando a rota e auth estao ok:
//   - cert existe:    { ok: true, exists: true, ...info }
//   - cert nao existe: { ok: true, exists: false }
// O caso "ainda nao tem cert" e NORMAL (empresa recem-cadastrada antes do
// admin enviar o .pfx) e nao deve poluir o console com 404 nem disparar
// alarmes — mesma familia dos "erros mentirosos" da varredura.
router.get('/info/:empresaId', requireAuth, requireCarteira, async (req, res) => {
    try {
        const info = await getCertInfoEmpresa(req.params.empresaId);
        if (!info) return res.json({ ok: true, exists: false });
        return res.json({ ok: true, exists: true, ...info });
    } catch (err) {
        console.error('[cert-empresa/info]', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// ── DELETE /:empresaId — deleta o cert ───────────────────────────────────
router.delete('/:empresaId', requireAdmin, async (req, res) => {
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
router.post('/test/:empresaId', requireAuth, requireCarteira, async (req, res) => {
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
