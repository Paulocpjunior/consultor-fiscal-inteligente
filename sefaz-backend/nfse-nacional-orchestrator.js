// ============================================================================
// sefaz-backend/nfse-nacional-orchestrator.js
// Orquestra emissao + persistencia de NFSe Nacional.
// ============================================================================

import admin from 'firebase-admin';
import { getNfseNacionalProvider, getNfseNacionalMode } from './nfse-nacional-provider.js';

const COLLECTION = 'nfse_nacional_emitidas';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

export async function emitirNfse(req) {
    const provider = getNfseNacionalProvider();
    const mode = getNfseNacionalMode();
    const nfse = await provider.emitirNfse(req);

    const db = fa().firestore();
    const docId = nfse.chave;
    const payload = {
        empresaId: req.empresaId,
        ...nfse,
        modeUsado: mode,
        emitidaEm: nfse.dataEmissao,
        criadoEm: new Date().toISOString(),
    };
    await db.collection(COLLECTION).doc(docId).set(payload, { merge: true });
    return { id: docId, ...payload };
}

export async function cancelarNfse(chave, motivo) {
    const provider = getNfseNacionalProvider();
    const r = await provider.cancelarNfse({ chave, motivo });
    const db = fa().firestore();
    await db.collection(COLLECTION).doc(chave).update({
        status: 'cancelada',
        canceladaEm: r.canceladaEm,
        motivoCancelamento: r.motivo,
    });
    return r;
}

export async function listarNfse({ empresaId, status, dataInicio, dataFim } = {}) {
    const db = fa().firestore();
    let q = db.collection(COLLECTION);
    if (empresaId) q = q.where('empresaId', '==', empresaId);
    if (status) q = q.where('status', '==', status);

    const snap = await q.limit(500).get();
    let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (dataInicio) docs = docs.filter(d => (d.emitidaEm || '') >= dataInicio);
    if (dataFim) docs = docs.filter(d => (d.emitidaEm || '') <= dataFim);
    docs.sort((a, b) => (b.emitidaEm || '').localeCompare(a.emitidaEm || ''));
    return docs;
}

export async function getResumoNfse() {
    const db = fa().firestore();
    const snap = await db.collection(COLLECTION).limit(1000).get();
    const docs = snap.docs.map(d => d.data());
    let autorizadas = 0, canceladas = 0;
    let valorBrutoTotal = 0, valorIssTotal = 0;
    for (const d of docs) {
        if (d.status === 'cancelada') canceladas++;
        else autorizadas++;
        valorBrutoTotal += d.servico?.valor || 0;
        valorIssTotal += d.servico?.issValor || 0;
    }
    return {
        total: docs.length,
        autorizadas, canceladas,
        valorBrutoTotal: +valorBrutoTotal.toFixed(2),
        valorIssTotal: +valorIssTotal.toFixed(2),
        mode: getNfseNacionalMode(),
    };
}
