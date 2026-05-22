// ============================================================================
// sefaz-backend/agent-keys-storage.js
// ----------------------------------------------------------------------------
// API keys pra o agente local cfi-a3 (captura via A3).
//
// Esquema Firestore:
//   agent_keys/{keyId}
//     ownerUid:       string   (uid do colaborador dono da key)
//     ownerEmail:     string   (denormalizado pra log)
//     keyHash:        string   (SHA-256 hex da key, NÃO da key crua)
//     label:          string   (ex: "Mac da Eunice", definido pelo admin)
//     createdAt:      Timestamp
//     createdBy:      string   (uid do admin que gerou)
//     lastUsedAt:     Timestamp | null
//     revoked:        boolean  (true = key inválida)
//     revokedAt:      Timestamp | null
//
// A key crua é mostrada UMA VEZ pro admin no momento da criação. Depois disso,
// só o hash fica gravado. Quem perdeu, gera de novo.
// ============================================================================
import admin from 'firebase-admin';
import crypto from 'node:crypto';

const COLLECTION = 'agent_keys';
const KEY_BYTES = 32; // 256 bits → 64 hex chars

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

function hashKey(rawKey) {
    return crypto.createHash('sha256').update(rawKey, 'utf-8').digest('hex');
}

/**
 * Gera uma API key nova pra um colaborador. Retorna a key crua UMA VEZ.
 *
 * @param {object} args - { ownerUid, ownerEmail, label, createdBy }
 * @returns {Promise<{keyId, rawKey}>}
 */
export async function gerarAgentKey({ ownerUid, ownerEmail, label, createdBy }) {
    if (!ownerUid) throw new Error('ownerUid obrigatório');
    const rawKey = `cfi_a3_${crypto.randomBytes(KEY_BYTES).toString('hex')}`;
    const keyHash = hashKey(rawKey);

    const db = fa().firestore();
    const doc = await db.collection(COLLECTION).add({
        ownerUid,
        ownerEmail: ownerEmail || null,
        keyHash,
        label: label || 'sem rótulo',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: createdBy || null,
        lastUsedAt: null,
        revoked: false,
        revokedAt: null,
    });

    return { keyId: doc.id, rawKey };
}

/**
 * Valida uma key crua recebida no header Authorization.
 * Retorna { ownerUid, ownerEmail, keyId } se válida e ativa.
 * Retorna null se inválida ou revogada.
 */
export async function validarAgentKey(rawKey) {
    if (!rawKey || typeof rawKey !== 'string' || !rawKey.startsWith('cfi_a3_')) return null;
    const keyHash = hashKey(rawKey);

    const db = fa().firestore();
    const snap = await db.collection(COLLECTION).where('keyHash', '==', keyHash).limit(1).get();
    if (snap.empty) return null;

    const docSnap = snap.docs[0];
    const data = docSnap.data();
    if (data.revoked) return null;

    // Atualiza lastUsedAt em background (não bloqueia)
    docSnap.ref.update({ lastUsedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});

    return {
        keyId: docSnap.id,
        ownerUid: data.ownerUid,
        ownerEmail: data.ownerEmail,
        label: data.label,
    };
}

/**
 * Lista as keys (sem expor hashes). Admin vê todas; user vê só as próprias.
 */
export async function listarAgentKeys({ ownerUid = null } = {}) {
    const db = fa().firestore();
    let q = db.collection(COLLECTION).orderBy('createdAt', 'desc');
    if (ownerUid) q = q.where('ownerUid', '==', ownerUid);
    const snap = await q.get();
    return snap.docs.map((d) => {
        const x = d.data();
        return {
            keyId: d.id,
            ownerUid: x.ownerUid,
            ownerEmail: x.ownerEmail,
            label: x.label,
            createdAt: x.createdAt?.toMillis ? x.createdAt.toMillis() : null,
            lastUsedAt: x.lastUsedAt?.toMillis ? x.lastUsedAt.toMillis() : null,
            revoked: !!x.revoked,
            revokedAt: x.revokedAt?.toMillis ? x.revokedAt.toMillis() : null,
        };
    });
}

export async function revogarAgentKey(keyId) {
    const db = fa().firestore();
    await db.collection(COLLECTION).doc(keyId).update({
        revoked: true,
        revokedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true };
}
