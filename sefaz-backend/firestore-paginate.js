// ============================================================================
// sefaz-backend/firestore-paginate.js  (ESM)
//
// Utilitarios pra eliminar o antipattern `.limit(N)` hardcoded que truncava
// silenciosamente listagens/agregacoes/crons quando a base passava de N docs.
//
//   fetchAllDocs(query)        — pagina TODOS os docs via cursor startAfter
//   commitUpdatesInChunks(...)  — commita updates respeitando o teto de 500/batch
//
// Funciona com firebase-admin (Node). startAfter por DocumentSnapshot usa o
// orderBy da query (ou __name__ implicito quando nao ha orderBy) como cursor.
// ============================================================================

/**
 * Itera TODOS os docs de uma query admin-SDK em lotes via cursor, sem teto
 * artificial. Para quando o lote vem menor que batchSize (= fim da colecao).
 *
 * Teto de seguranca (maxDocs) evita varredura infinita / OOM se a colecao
 * crescer demais — loga warning ao inves de truncar mudo, pra ficar visivel.
 *
 * @param {FirebaseFirestore.Query} baseQuery  query SEM .limit() (where/orderBy ok)
 * @param {{ batchSize?: number, maxDocs?: number, label?: string }} [opts]
 * @returns {Promise<FirebaseFirestore.QueryDocumentSnapshot[]>}
 */
export async function fetchAllDocs(baseQuery, { batchSize = 1000, maxDocs = 50000, label = 'query' } = {}) {
    const docs = [];
    let last = null;
    while (docs.length < maxDocs) {
        let q = baseQuery.limit(batchSize);
        if (last) q = q.startAfter(last);
        const snap = await q.get();
        if (snap.empty) break;
        docs.push(...snap.docs);
        if (snap.size < batchSize) break;
        last = snap.docs[snap.docs.length - 1];
    }
    if (docs.length >= maxDocs) {
        console.warn(`[fetchAllDocs] ${label}: teto de ${maxDocs} docs atingido — pode haver mais.`);
    }
    return docs;
}

/**
 * Aplica updates em lotes de <= chunkSize (Firestore limita 500 ops/batch).
 * Substitui o padrao "1 batch unico" que estourava silenciosamente quando
 * mais de 500 docs precisavam ser atualizados.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {Array<{ ref: FirebaseFirestore.DocumentReference, data: object }>} updates
 * @param {number} [chunkSize=450]
 * @returns {Promise<number>} total de docs atualizados
 */
export async function commitUpdatesInChunks(db, updates, chunkSize = 450) {
    let committed = 0;
    for (let i = 0; i < updates.length; i += chunkSize) {
        const slice = updates.slice(i, i + chunkSize);
        const batch = db.batch();
        for (const u of slice) batch.update(u.ref, u.data);
        await batch.commit();
        committed += slice.length;
    }
    return committed;
}
