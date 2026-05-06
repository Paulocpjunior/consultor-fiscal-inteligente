// ============================================================================
// sefaz-backend/cert-manager.js
// ----------------------------------------------------------------------------
// Express router para gerenciamento do certificado digital A1 ICP-Brasil.
//
// Endpoints (todos requerem Firebase ID token + role=admin):
//   POST /api/admin/sefaz/cert         multipart upload do .pfx + senha
//   GET  /api/admin/sefaz/cert/status  metadados do certificado atual
//   DELETE /api/admin/sefaz/cert       remove o certificado (rollback)
//
// Garantias de segurança:
//   - .pfx nunca toca disco (multer.memoryStorage)
//   - .pfx vai direto pro Secret Manager (binário) com nova versão
//   - senha vai pro Secret Manager separado (string utf-8)
//   - Firestore só guarda metadados (CNPJ, validade, fingerprint, auditoria)
//   - logs nunca incluem senha nem buffer do .pfx
// ============================================================================

const express = require('express');
const multer = require('multer');
const forge = require('node-forge');
const admin = require('firebase-admin');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const router = express.Router();

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'consultorfiscalapp';
const SECRET_CERT = process.env.SEFAZ_CERT_NAME || 'sefaz-cert-a1';
const SECRET_PASS = process.env.SEFAZ_PASS_NAME || 'sefaz-cert-password';

const secretClient = new SecretManagerServiceClient();

// Multer: in-memory, 5MB cap
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// Garantir firebase-admin inicializado (defensivo — server.js raiz pode não ter)
// Lazy init — só inicializa quando uma requisição chega
function getFirebaseAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

// ---------------------------------------------------------------------------
// Middleware: requer ID token Firebase + role=admin no Firestore
// ---------------------------------------------------------------------------
async function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'Token ausente' });

    const decoded = await getFirebaseAdmin().auth().verifyIdToken(m[1]);
    const uid = decoded.uid;

    const userDoc = await getFirebaseAdmin().firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) return res.status(403).json({ error: 'Usuário não encontrado no Firestore' });

    const role = userDoc.data().role;
    if (role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a administradores' });

    req.user = { uid, email: decoded.email || userDoc.data().email, role };
    next();
  } catch (e) {
    console.error('[requireAdmin] erro:', e.message);
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

// ---------------------------------------------------------------------------
// Parse PKCS#12 (A1) e extrai metadados
// ---------------------------------------------------------------------------
function parseA1Certificate(pfxBuffer, password) {
  // node-forge espera string binária
  const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

  // Cert chain
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
  if (!certBags || certBags.length === 0) {
    throw new Error('Nenhum certificado encontrado no .pfx');
  }
  const cert = certBags[0].cert;

  // Verifica chave privada (A1 obrigatoriamente tem)
  const keyBagsShrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const keyBagsPlain = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
  if (keyBagsShrouded.length === 0 && keyBagsPlain.length === 0) {
    throw new Error('Chave privada ausente — certificado não é A1 válido');
  }

  // Subject CN — ICP-Brasil:
  //   PJ: "RAZÃO SOCIAL:CNPJ" (14 dígitos)
  //   PF: "NOME COMPLETO:CPF" (11 dígitos)
  const cnAttr = cert.subject.getField('CN');
  const cn = cnAttr ? cnAttr.value : '';

  let cnpj = null;
  let cpfTitular = null;
  let tipo = 'desconhecido';

  const m14 = cn.match(/:(\d{14})$/);
  const m11 = cn.match(/:(\d{11})$/);
  if (m14) { cnpj = m14[1]; tipo = 'PJ'; }
  else if (m11) { cpfTitular = m11[1]; tipo = 'PF'; }

  const titular = cn.replace(/:\d+$/, '').trim();

  // Issuer
  const issuerCN = cert.issuer.getField('CN');
  const issuerO = cert.issuer.getField('O');

  // Validade
  const notBefore = cert.validity.notBefore;
  const notAfter = cert.validity.notAfter;
  const diasRestantes = Math.floor((notAfter.getTime() - Date.now()) / 86_400_000);

  // Fingerprint SHA-1 (formato XX:XX:XX...)
  const md = forge.md.sha1.create();
  md.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  const fingerprint = md.digest().toHex().toUpperCase().match(/.{2}/g).join(':');

  // ICP-Brasil check (issuer O contém "ICP-Brasil")
  const isICPBrasil = !!(issuerO && /icp[\s-]?brasil/i.test(issuerO.value));

  return {
    cnpj,
    cpfTitular,
    titular,
    cnCompleto: cn,
    issuer: {
      cn: issuerCN ? issuerCN.value : null,
      o: issuerO ? issuerO.value : null,
    },
    validade: {
      inicio: notBefore.toISOString(),
      fim: notAfter.toISOString(),
      diasRestantes,
      expirado: diasRestantes <= 0,
      proximoVencimento: diasRestantes > 0 && diasRestantes <= 30,
    },
    fingerprint,
    tipo,
    isICPBrasil,
  };
}

// ---------------------------------------------------------------------------
// POST /cert  — upload do .pfx
// ---------------------------------------------------------------------------
router.post('/cert', requireAdmin, upload.single('cert'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Arquivo .pfx ausente (campo "cert")' });
    }
    const password = req.body.password || '';
    if (!password) {
      return res.status(400).json({ error: 'Senha do certificado ausente' });
    }

    // Parse + valida
    let info;
    try {
      info = parseA1Certificate(req.file.buffer, password);
    } catch (e) {
      const msg = String(e.message || e);
      if (/PKCS#12 MAC|Invalid password|Decrypt/i.test(msg)) {
        return res.status(400).json({ error: 'Senha incorreta' });
      }
      return res.status(400).json({ error: 'Certificado inválido: ' + msg });
    }

    if (info.validade.expirado) {
      return res.status(400).json({ error: `Certificado expirado em ${info.validade.fim}` });
    }
    if (!info.isICPBrasil) {
      return res.status(400).json({
        error: `Não é certificado ICP-Brasil (issuer O: ${info.issuer.o || 'desconhecido'})`,
      });
    }

    // Grava nova versão dos secrets
    const certParent = `projects/${PROJECT_ID}/secrets/${SECRET_CERT}`;
    const passParent = `projects/${PROJECT_ID}/secrets/${SECRET_PASS}`;

    const [certVersion] = await secretClient.addSecretVersion({
      parent: certParent,
      payload: { data: req.file.buffer },
    });
    const [passVersion] = await secretClient.addSecretVersion({
      parent: passParent,
      payload: { data: Buffer.from(password, 'utf-8') },
    });

    // Firestore: metadados + auditoria (NUNCA o .pfx ou a senha)
    const meta = {
      ...info,
      uploadedAt: getFirebaseAdmin().firestore.FieldValue.serverTimestamp(),
      uploadedBy: { uid: req.user.uid, email: req.user.email },
      secretVersions: { cert: certVersion.name, pass: passVersion.name },
    };
    await getFirebaseAdmin().firestore().collection('sefaz_certificados').doc('atual').set(meta, { merge: true });
    await getFirebaseAdmin().firestore().collection('sefaz_certificados_historico').add(meta);

    console.log(`[sefaz/cert] upload OK por ${req.user.email} — ${info.tipo} ${info.cnpj || info.cpfTitular} val até ${info.validade.fim}`);

    return res.json({ ok: true, info });
  } catch (e) {
    console.error('[POST /cert] erro:', e);
    return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
  }
});

// ---------------------------------------------------------------------------
// GET /cert/status  — metadados do certificado atual (sem expor cert/senha)
// ---------------------------------------------------------------------------
router.get('/cert/status', requireAdmin, async (req, res) => {
  try {
    const doc = await getFirebaseAdmin().firestore().collection('sefaz_certificados').doc('atual').get();
    if (!doc.exists) return res.json({ configured: false });

    const data = doc.data();
    // Recalcular dias restantes em runtime (validade.diasRestantes salvo é momento do upload)
    if (data.validade && data.validade.fim) {
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

// ---------------------------------------------------------------------------
// DELETE /cert  — desabilita o certificado atual (NÃO apaga versões antigas
// no Secret Manager — ficam para auditoria/rollback)
// ---------------------------------------------------------------------------
router.delete('/cert', requireAdmin, async (req, res) => {
  try {
    await getFirebaseAdmin().firestore().collection('sefaz_certificados').doc('atual').delete();
    console.log(`[sefaz/cert] desabilitado por ${req.user.email}`);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /cert] erro:', e);
    return res.status(500).json({ error: 'Falha interna' });
  }
});

// Error handler para multer (file size, etc.)
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Arquivo excede 5MB' });
  }
  next(err);
});

module.exports = router;
