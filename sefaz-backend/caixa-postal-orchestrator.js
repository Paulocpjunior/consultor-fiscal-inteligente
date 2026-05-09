// ============================================================================
// sefaz-backend/caixa-postal-orchestrator.js
// Sincroniza mensagens entre o provider (mock/SERPRO) e o Firestore.
// ============================================================================

import admin from 'firebase-admin';
import { getCaixaPostalProvider, getProviderMode } from './caixa-postal-provider.js';

const COLLECTION = 'caixa_postal_mensagens';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Sincroniza a caixa postal de uma empresa: chama o provider, persiste novos,
 * preserva o estado de leitura local (data leitura).
 */
export async function sincronizarEmpresa(empresaId, empresaCnpj) {
    const db = fa().firestore();
    const provider = getCaixaPostalProvider();
    const mode = getProviderMode();

    const mensagensRemotas = await provider.listarMensagens(empresaCnpj);

    // Lê estado de leitura atual do Firestore pra preservar
    const snap = await db.collection(COLLECTION)
        .where('empresaCnpj', '==', empresaCnpj)
        .get();

    const lidasLocais = new Map();
    snap.forEach(doc => {
        const d = doc.data();
        if (d.dataLeitura) lidasLocais.set(d.mensagemId, d.dataLeitura);
    });

    const batch = db.batch();
    let novas = 0, atualizadas = 0;

    for (const msg of mensagensRemotas) {
        const docId = `${empresaCnpj}_${msg.mensagemId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        const ref = db.collection(COLLECTION).doc(docId);
        const dataLeituraLocal = lidasLocais.get(msg.mensagemId) || msg.dataLeitura || null;

        const payload = {
            empresaId,
            empresaCnpj,
            mensagemId: msg.mensagemId,
            assunto: msg.assunto || '',
            remetente: msg.remetente || '',
            categoria: msg.categoria || 'informativo',
            corpo: msg.corpo || '',
            dataEnvio: msg.dataEnvio,
            dataLeitura: dataLeituraLocal,
            fonte: msg.fonte || mode,
            ultimaSincronizacao: new Date().toISOString(),
        };
        batch.set(ref, payload, { merge: true });

        if (lidasLocais.has(msg.mensagemId)) atualizadas++; else novas++;
    }
    await batch.commit();

    return { mode, total: mensagensRemotas.length, novas, atualizadas };
}

/**
 * Sincroniza TODAS as empresas (Simples + Lucro Presumido/Real).
 */
export async function sincronizarTodasEmpresas() {
    const db = fa().firestore();
    const empresas = [];

    const simplesSnap = await db.collection('simples_empresas').get();
    simplesSnap.forEach(d => empresas.push({ id: d.id, ...d.data() }));

    const lucroSnap = await db.collection('lucro_empresas').get();
    lucroSnap.forEach(d => empresas.push({ id: d.id, ...d.data() }));

    const stats = { totalEmpresas: empresas.length, sucesso: 0, falha: 0, detalhes: [] };
    for (const emp of empresas) {
        if (!emp.cnpj) continue;
        try {
            const r = await sincronizarEmpresa(emp.id, emp.cnpj);
            stats.sucesso++;
            stats.detalhes.push({ empresa: emp.nome, ...r });
        } catch (err) {
            stats.falha++;
            console.warn(`[caixa-postal] ${emp.nome}: ${err.message}`);
        }
    }
    return stats;
}

/**
 * Lista mensagens do Firestore com filtros.
 */
export async function listarMensagensLocais({ empresaCnpj, naoLidas, categoria } = {}) {
    const db = fa().firestore();
    let q = db.collection(COLLECTION);
    if (empresaCnpj) q = q.where('empresaCnpj', '==', empresaCnpj);
    if (categoria) q = q.where('categoria', '==', categoria);

    const snap = await q.limit(500).get();
    let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (naoLidas) docs = docs.filter(d => !d.dataLeitura);
    docs.sort((a, b) => (b.dataEnvio || '').localeCompare(a.dataEnvio || ''));
    return docs;
}

/**
 * Resumo agregado pra dashboard global.
 */
export async function getResumoGlobal() {
    const db = fa().firestore();
    const snap = await db.collection(COLLECTION).limit(1000).get();
    const docs = snap.docs.map(d => d.data());
    const naoLidas = docs.filter(d => !d.dataLeitura);

    const porCategoria = {};
    for (const d of naoLidas) {
        porCategoria[d.categoria] = (porCategoria[d.categoria] || 0) + 1;
    }

    const empresasComCriticas = new Set();
    for (const d of naoLidas) {
        if (d.categoria === 'intimacao' || d.categoria === 'malha' || d.categoria === 'exclusao') {
            empresasComCriticas.add(d.empresaCnpj);
        }
    }

    return {
        totalMensagens: docs.length,
        naoLidasTotal: naoLidas.length,
        naoLidasPorCategoria: porCategoria,
        empresasComCriticas: empresasComCriticas.size,
        mode: getProviderMode(),
    };
}

/**
 * Marca uma mensagem como lida no Firestore (e tenta no provider).
 */
export async function marcarComoLida(docId) {
    const db = fa().firestore();
    await db.collection(COLLECTION).doc(docId).update({
        dataLeitura: new Date().toISOString(),
    });

    const provider = getCaixaPostalProvider();
    try {
        // Pega o mensagemId remoto pra sinalizar pro provider
        const docSnap = await db.collection(COLLECTION).doc(docId).get();
        if (docSnap.exists) {
            await provider.marcarComoLida(docSnap.data().mensagemId);
        }
    } catch (err) {
        console.warn(`[caixa-postal] marcarComoLida no provider falhou: ${err.message}`);
    }
    return { ok: true };
}
