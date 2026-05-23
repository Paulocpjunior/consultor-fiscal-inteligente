// ============================================================================
// sefaz-backend/cert-manager.js  (ESM)
// ----------------------------------------------------------------------------
// Express router para gerenciamento do certificado digital A1 ICP-Brasil.
// Endpoints: POST /cert, GET /cert/status, DELETE /cert  (todos exigem admin)
// ============================================================================

import express from 'express';
import multer from 'multer';
import forge from 'node-forge';
import admin from 'firebase-admin';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { requireAdmin } from './require-admin.js';

const router = express.Router();

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'consultorfiscalapp';
const SECRET_CERT = process.env.SEFAZ_CERT_NAME || 'sefaz-cert-a1';
const SECRET_PASS = process.env.SEFAZ_PASS_NAME || 'sefaz-cert-password';

const secretClient = new SecretManagerServiceClient();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// Lazy-init firebase-admin (só inicializa quando uma request chega)
function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

// --- Parse PKCS#12 (A1) ---
function parseA1Certificate(pfxBuffer, password) {
  const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
  if (!certBags || certBags.length === 0) throw new Error('Nenhum certificado no .pfx');
  const cert = certBags[0].cert;

  const keyShrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const keyPlain = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
  if (keyShrouded.length === 0 && keyPlain.length === 0) {
    throw new Error('Chave privada ausente — não é A1 válido');
  }

  const cnAttr = cert.subject.getField('CN');
  const cn = cnAttr ? cnAttr.value : '';

  let cnpj = null, cpfTitular = null, tipo = 'desconhecido';
  const m14 = cn.match(/:(\d{14})$/);
  const m11 = cn.match(/:(\d{11})$/);
  if (m14) { cnpj = m14[1]; tipo = 'PJ'; }
  else if (m11) { cpfTitular = m11[1]; tipo = 'PF'; }

  const titular = cn.replace(/:\d+$/, '').trim();
  const issuerCN = cert.issuer.getField('CN');
  const issuerO = cert.issuer.getField('O');
  const notBefore = cert.validity.notBefore;
  const notAfter = cert.validity.notAfter;
  const diasRestantes = Math.floor((notAfter.getTime() - Date.now()) / 86_400_000);

  const md = forge.md.sha1.create();
  md.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  const fingerprint = md.digest().toHex().toUpperCase().match(/.{2}/g).join(':');

  const isICPBrasil = !!(issuerO && /icp[\s-]?brasil/i.test(issuerO.value));

  return {
    cnpj, cpfTitular, titular, cnCompleto: cn,
    issuer: { cn: issuerCN ? issuerCN.value : null, o: issuerO ? issuerO.value : null },
    validade: {
      inicio: notBefore.toISOString(),
      fim: notAfter.toISOString(),
      diasRestantes,
      expirado: diasRestantes <= 0,
      proximoVencimento: diasRestantes > 0 && diasRestantes <= 30,
    },
    fingerprint, tipo, isICPBrasil,
  };
}

// --- POST /cert ---
router.post('/cert', requireAdmin, upload.single('cert'), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'Arquivo .pfx ausente (campo "cert")' });
    const password = req.body.password || '';
    if (!password) return res.status(400).json({ error: 'Senha ausente' });

    let info;
    try { info = parseA1Certificate(req.file.buffer, password); }
    catch (e) {
      const msg = String(e.message || e);
      if (/PKCS#12 MAC|Invalid password|Decrypt/i.test(msg)) {
        return res.status(400).json({ error: 'Senha incorreta' });
      }
      return res.status(400).json({ error: 'Certificado inválido: ' + msg });
    }

    if (info.validade.expirado) return res.status(400).json({ error: `Certificado expirado em ${info.validade.fim}` });
    if (!info.isICPBrasil) return res.status(400).json({ error: `Não é ICP-Brasil (issuer O: ${info.issuer.o})` });

    const certParent = `projects/${PROJECT_ID}/secrets/${SECRET_CERT}`;
    const passParent = `projects/${PROJECT_ID}/secrets/${SECRET_PASS}`;

    const [certVersion] = await secretClient.addSecretVersion({
      parent: certParent, payload: { data: req.file.buffer },
    });
    const [passVersion] = await secretClient.addSecretVersion({
      parent: passParent, payload: { data: Buffer.from(password, 'utf-8') },
    });

    const meta = {
      ...info,
      uploadedAt: fa().firestore.FieldValue.serverTimestamp(),
      uploadedBy: { uid: req.user.uid, email: req.user.email },
      secretVersions: { cert: certVersion.name, pass: passVersion.name },
    };
    await fa().firestore().collection('sefaz_certificados').doc('atual').set(meta, { merge: true });
    await fa().firestore().collection('sefaz_certificados_historico').add(meta);

    console.log(`[sefaz/cert] upload OK por ${req.user.email} — ${info.tipo} ${info.cnpj || info.cpfTitular} val ${info.validade.fim}`);
    return res.json({ ok: true, info });
  } catch (e) {
    console.error('[POST /cert] erro:', e);
    return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
  }
});

// --- GET /cert/status ---
router.get('/cert/status', requireAdmin, async (req, res) => {
  try {
    const doc = await fa().firestore().collection('sefaz_certificados').doc('atual').get();
    if (!doc.exists) return res.json({ configured: false });
    const data = doc.data();
    if (data.validade?.fim) {
      const fim = new Date(data.validade.fim);
      data.validade.diasRestantes = Math.floor((fim.getTime() - Date.now()) / 86_400_000);
      data.validade.expirado = data.validade.diasRestantes <= 0;
      data.validade.proximoVencimento = data.validade.diasRestantes > 0 && data.validade.diasRestantes <= 30;
    }
    return res.json({ configured: true, ...data });
  } catch (e) {
    console.error('[GET /cert/status] erro:', e);
    return res.status(500).json({ error: 'Falha interna' });
  }
});

// --- DELETE /cert ---
router.delete('/cert', requireAdmin, async (req, res) => {
  try {
    await fa().firestore().collection('sefaz_certificados').doc('atual').delete();
    console.log(`[sefaz/cert] desabilitado por ${req.user.email}`);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /cert] erro:', e);
    return res.status(500).json({ error: 'Falha interna' });
  }
});

router.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Arquivo excede 5MB' });
  next(err);
});

export default router;
