// ============================================================================
// sefaz-backend/darf-orchestrator.js
// Orquestra emissao + persistencia de DARFs no Firestore.
// ============================================================================

import admin from 'firebase-admin';
import { getDarfProvider, getDarfMode } from './darf-provider.js';

const COLLECTION = 'darfs_emitidos';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Emite uma DARF e persiste no Firestore.
 *
 * @param {object} req
 *   empresaId, empresaCnpj, empresaNome,
 *   regime ('Presumido'|'Real'),
 *   tributo ('IRPJ'|'CSLL'|'PIS'|'COFINS'|'IRRF'),
 *   competencia ('YYYY-MM'),
 *   valor (decimal, principal),
 *   periodicidade? ('mensal'|'trimestral'),
 *   codigoReceita? (override),
 *   vencimento? (override),
 *   dataPagamento? (se atrasado),
 *   descricao?, observacao?
 */
export async function emitirDarf(req) {
    const {
        empresaId, empresaCnpj, empresaNome,
        regime, tributo, competencia, valor,
    } = req;
    if (!empresaId || !empresaCnpj || !regime || !tributo || !competencia || !valor) {
        throw new Error('Campos obrigatorios: empresaId, empresaCnpj, regime, tributo, competencia, valor');
    }

    const provider = getDarfProvider();
    const mode = getDarfMode();
    const darf = await provider.gerarDarf(req);

    const db = fa().firestore();
    const docId = `${empresaCnpj}_${competencia}_${tributo}_${Date.now()}`
        .replace(/[^a-zA-Z0-9_-]/g, '_');

    const payload = {
        empresaId,
        empresaCnpj,
        empresaNome: empresaNome || '',
        regime,
        tributo,
        competencia,
        periodicidade: req.periodicidade || (tributo === 'IRPJ' || tributo === 'CSLL' ? 'trimestral' : 'mensal'),
        descricao: req.descricao || '',
        observacao: req.observacao || '',
        ...darf,
        emitidoEm: new Date().toISOString(),
        modeUsado: mode,
        statusPagamento: 'pendente',
        dataPagamento: null,
    };
    await db.collection(COLLECTION).doc(docId).set(payload, { merge: true });
    return { id: docId, ...payload };
}

/**
 * Lista DARFs com filtros opcionais.
 */
export async function listarDarfs({ empresaId, competencia, tributo, status, regime } = {}) {
    const db = fa().firestore();
    let q = db.collection(COLLECTION);
    if (empresaId)   q = q.where('empresaId',       '==', empresaId);
    if (competencia) q = q.where('competencia',     '==', competencia);
    if (tributo)     q = q.where('tributo',         '==', tributo);
    if (regime)      q = q.where('regime',          '==', regime);
    if (status)      q = q.where('statusPagamento', '==', status);

    const snap = await q.limit(500).get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => (b.emitidoEm || '').localeCompare(a.emitidoEm || ''));
    return docs;
}

/**
 * Resumo agregado pra dashboard.
 */
export async function getResumoDarf() {
    const db = fa().firestore();
    const snap = await db.collection(COLLECTION).limit(1000).get();
    const docs = snap.docs.map(d => d.data());

    const hoje = new Date().toISOString().slice(0, 10);
    let pendentes = 0, vencidos = 0, pagos = 0;
    let valorPendente = 0, valorVencido = 0, valorPago = 0;
    const porTributo = {};

    for (const d of docs) {
        const status = d.statusPagamento || 'pendente';
        const venc = d.vencimento || '';
        if (status === 'pago') {
            pagos++;
            valorPago += d.valor || 0;
        } else if (venc && venc < hoje) {
            vencidos++;
            valorVencido += d.valor || 0;
        } else {
            pendentes++;
            valorPendente += d.valor || 0;
        }
        const t = d.tributo || 'OUTROS';
        if (!porTributo[t]) porTributo[t] = { qtd: 0, valor: 0 };
        porTributo[t].qtd += 1;
        porTributo[t].valor += d.valor || 0;
    }
    return {
        totalDarfs: docs.length,
        pendentes, vencidos, pagos,
        valorPendente, valorVencido, valorPago,
        porTributo,
        mode: getDarfMode(),
    };
}

/**
 * Marca DARF como paga.
 */
export async function marcarPago(docId, dataPagamento) {
    const db = fa().firestore();
    await db.collection(COLLECTION).doc(docId).update({
        statusPagamento: 'pago',
        dataPagamento: dataPagamento || new Date().toISOString().slice(0, 10),
    });
    return { ok: true };
}

/**
 * Atualiza vencidos (similar ao cron do DAS).
 */
export async function processarVencimentos() {
    const db = fa().firestore();
    const hoje = new Date().toISOString().slice(0, 10);
    const snap = await db.collection(COLLECTION).limit(2000).get();
    const stats = { total: snap.size, atualizados: 0 };
    const batch = db.batch();
    let comOps = false;

    for (const doc of snap.docs) {
        const d = doc.data();
        if ((d.statusPagamento || 'pendente') !== 'pendente') continue;
        if (!d.vencimento) continue;
        if (d.vencimento < hoje) {
            batch.update(doc.ref, {
                statusPagamento: 'vencido',
                atualizadoEm: new Date().toISOString(),
            });
            stats.atualizados++;
            comOps = true;
        }
    }
    if (comOps) await batch.commit();
    return stats;
}
