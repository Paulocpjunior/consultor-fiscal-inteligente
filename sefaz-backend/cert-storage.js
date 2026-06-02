// ============================================================================
// sefaz-backend/cert-storage.js
// Gestao de certificados A1 POR EMPRESA, criptografados com AES-256-GCM.
//
// Storage:
//   - Firebase Storage: certs/{empresaId}.pfx.enc  (binario criptografado)
//     Layout: [12 bytes IV][16 bytes auth tag][N bytes ciphertext]
//   - Firestore: empresas_certificados/{empresaId}  (metadados)
//   - Chave AES-256: Secret Manager cfi-empresa-cert-key (hex 64 chars)
//
// Senha do .pfx tambem e criptografada com o mesmo esquema e gravada no
// Firestore (campo passwordEnc base64). O .pfx em si vai pro Storage por
// ser binario maior.
// ============================================================================

import admin from 'firebase-admin';
import crypto from 'crypto';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import forge from 'node-forge';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'consultorfiscalapp';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const AES_KEY_SECRET = 'cfi-empresa-cert-key';
const CERT_STORAGE_PREFIX = 'certs';
const COLLECTION = 'empresas_certificados';

const secretClient = new SecretManagerServiceClient();

// ── Lazy init Firebase Admin ─────────────────────────────────────────────
function ensureAdmin() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
}
function getDb() { ensureAdmin(); return admin.firestore(); }
function getStorage() { ensureAdmin(); return admin.storage(); }

// ── Cache da chave AES (5 min) ────────────────────────────────────────────
let aesKeyCache = null;
let aesKeyCacheExpiry = 0;
const KEY_CACHE_TTL_MS = 5 * 60 * 1000;

async function getAesKey() {
    const now = Date.now();
    if (aesKeyCache && now < aesKeyCacheExpiry) return aesKeyCache;

    const name = `projects/${PROJECT_ID}/secrets/${AES_KEY_SECRET}/versions/latest`;
    let version;
    try {
        [version] = await secretClient.accessSecretVersion({ name });
    } catch (e) {
        // Causa #1 de upload de cert por empresa falhar: o secret nunca foi
        // provisionado. Mensagem nomeia a dependencia exata pro operador.
        throw new Error(
            `Nao foi possivel acessar o Secret Manager "${AES_KEY_SECRET}" no projeto ${PROJECT_ID}: ${e.message}. ` +
            `Crie o secret com uma chave AES-256 (64 hex) e de acesso (secretmanager.versions.access) a service account do Cloud Run.`,
        );
    }
    const hex = version.payload.data.toString('utf-8').trim();
    if (hex.length !== 64) throw new Error(`AES key invalida no secret "${AES_KEY_SECRET}": esperado 64 chars hex, got ${hex.length}`);
    aesKeyCache = Buffer.from(hex, 'hex');
    aesKeyCacheExpiry = now + KEY_CACHE_TTL_MS;
    return aesKeyCache;
}

// ── Cripto ───────────────────────────────────────────────────────────────

/**
 * Encripta plaintext usando AES-256-GCM.
 * Output: [12 bytes IV][16 bytes tag][N bytes ciphertext]
 */
async function encryptBuffer(plaintextBuffer) {
    const key = await getAesKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]);
}

/**
 * Decripta buffer no formato [IV][tag][ciphertext].
 */
async function decryptBuffer(encryptedBuffer) {
    if (encryptedBuffer.length < 28) throw new Error('Buffer criptografado muito curto');
    const key = await getAesKey();
    const iv = encryptedBuffer.slice(0, 12);
    const tag = encryptedBuffer.slice(12, 28);
    const ciphertext = encryptedBuffer.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ── Helpers de validacao do certificado ──────────────────────────────────

/**
 * Le metadados do .pfx (CNPJ, validade, subject) sem armazenar.
 */
function extrairMetadadosCert(pfxBuffer, password) {
    const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
    if (!certBags || certBags.length === 0) throw new Error('Nenhum certificado no .pfx');

    const cert = certBags[0].cert;
    const subjectStr = cert.subject.attributes
        .map(a => `${a.shortName || a.name}=${a.value}`)
        .join(', ');

    // CNPJ extraido especificamente do CN (Common Name).
    // Em certs PJ ICP-Brasil, o CN tem formato 'RAZAO SOCIAL:CNPJ'.
    // Outros campos (OU, etc) podem ter CNPJ do responsavel - nao confundir.
    const cnAttr = cert.subject.attributes.find(a => (a.shortName === 'CN' || a.name === 'commonName'));
    const cnValue = cnAttr?.value || '';
    const cnpjFromCN = cnValue.match(/:(\d{14})\b/);
    let cnpj = cnpjFromCN ? cnpjFromCN[1] : null;
    if (!cnpj) {
        const fallback = cnValue.match(/\b(\d{14})\b/);
        cnpj = fallback ? fallback[1] : null;
    }

    // Fingerprint SHA-256
    const md = forge.md.sha256.create();
    md.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
    const fingerprint = md.digest().toHex();

    return {
        subject: subjectStr,
        cnpj,
        notBefore: cert.validity.notBefore.toISOString(),
        notAfter: cert.validity.notAfter.toISOString(),
        fingerprint,
        issuer: cert.issuer.attributes.map(a => `${a.shortName || a.name}=${a.value}`).join(', '),
    };
}

// ── API publica ──────────────────────────────────────────────────────────

/**
 * Upload de um cert pra uma empresa.
 * 1. Valida o .pfx + senha (extrai metadados)
 * 2. Encripta .pfx + grava no Storage
 * 3. Encripta senha + grava metadados no Firestore
 */
export async function uploadCertEmpresa(empresaId, pfxBuffer, password, uploadInfo = {}) {
    if (!empresaId) throw new Error('empresaId obrigatorio');
    if (!pfxBuffer?.length) throw new Error('pfxBuffer vazio');
    if (!password) throw new Error('password obrigatoria');

    // 1. Valida
    const meta = extrairMetadadosCert(pfxBuffer, password);

    // 2. Encripta + sobe pro Storage
    const encrypted = await encryptBuffer(pfxBuffer);
    const storagePath = `${CERT_STORAGE_PREFIX}/${empresaId}.pfx.enc`;
    const bucket = getStorage().bucket(STORAGE_BUCKET);
    await bucket.file(storagePath).save(encrypted, {
        contentType: 'application/octet-stream',
        metadata: {
            cacheControl: 'private, no-store',
            metadata: { empresaId, fingerprint: meta.fingerprint },
        },
        resumable: false,
    });

    // 3. Encripta senha e grava metadados no Firestore
    const passwordEnc = (await encryptBuffer(Buffer.from(password, 'utf-8'))).toString('base64');

    const docData = {
        empresaId,
        storagePath,
        passwordEnc,
        subject: meta.subject,
        cnpj: meta.cnpj,
        issuer: meta.issuer,
        notBefore: meta.notBefore,
        notAfter: meta.notAfter,
        fingerprint: meta.fingerprint,
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        uploadedBy: uploadInfo.email || uploadInfo.uid || 'unknown',
        sizeBytes: pfxBuffer.length,
    };
    await getDb().collection(COLLECTION).doc(empresaId).set(docData);

    return {
        ok: true,
        empresaId,
        cnpj: meta.cnpj,
        notAfter: meta.notAfter,
        fingerprint: meta.fingerprint,
    };
}

/**
 * Carrega cert+senha decriptados pra usar no SEFAZ-client.
 * Retorna null se a empresa nao tem cert.
 */
export async function loadCertEmpresa(empresaId) {
    if (!empresaId) return null;

    const snap = await getDb().collection(COLLECTION).doc(empresaId).get();
    if (!snap.exists) return null;
    const data = snap.data();

    // Decripta senha
    const passwordEnc = Buffer.from(data.passwordEnc, 'base64');
    const passwordBuf = await decryptBuffer(passwordEnc);
    const password = passwordBuf.toString('utf-8');

    // Le e decripta .pfx do Storage
    const bucket = getStorage().bucket(STORAGE_BUCKET);
    const [encryptedPfx] = await bucket.file(data.storagePath).download();
    const pfxBuffer = await decryptBuffer(encryptedPfx);

    return {
        pfxBuffer,
        password,
        cnpj: data.cnpj,
        notAfter: data.notAfter,
        fingerprint: data.fingerprint,
    };
}

/**
 * Deleta o cert da empresa (Storage + Firestore).
 */
export async function deleteCertEmpresa(empresaId) {
    if (!empresaId) throw new Error('empresaId obrigatorio');

    const ref = getDb().collection(COLLECTION).doc(empresaId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, motivo: 'nao_encontrado' };
    const data = snap.data();

    // Deleta do Storage
    try {
        await getStorage().bucket(STORAGE_BUCKET).file(data.storagePath).delete();
    } catch (e) {
        if (e.code !== 404) console.warn('[cert-storage] erro deletando storage:', e.message);
    }

    // Move metadados pra historico antes de deletar (audit)
    await getDb().collection(`${COLLECTION}_historico`).add({
        ...data,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await ref.delete();

    return { ok: true, empresaId };
}

/**
 * Le apenas os metadados (sem secrets).
 */
export async function getCertInfoEmpresa(empresaId) {
    const snap = await getDb().collection(COLLECTION).doc(empresaId).get();
    if (!snap.exists) return null;
    const d = snap.data();
    return {
        empresaId,
        cnpj: d.cnpj,
        subject: d.subject,
        issuer: d.issuer,
        notBefore: d.notBefore,
        notAfter: d.notAfter,
        fingerprint: d.fingerprint,
        uploadedAt: d.uploadedAt?.toDate?.()?.toISOString?.() || null,
        uploadedBy: d.uploadedBy,
        sizeBytes: d.sizeBytes,
    };
}

/**
 * Lista todos os certs cadastrados (so metadados).
 */
export async function listCertsEmpresas() {
    const snap = await getDb().collection(COLLECTION).get();
    const lista = [];
    snap.forEach(s => {
        const d = s.data();
        lista.push({
            empresaId: s.id,
            cnpj: d.cnpj,
            subject: d.subject,
            notAfter: d.notAfter,
            fingerprint: d.fingerprint,
            uploadedAt: d.uploadedAt?.toDate?.()?.toISOString?.() || null,
            uploadedBy: d.uploadedBy,
        });
    });
    return lista;
}
