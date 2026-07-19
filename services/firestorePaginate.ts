// services/firestorePaginate.ts
//
// Pagina TODOS os docs de uma colecao Firestore (web SDK) via cursor startAfter,
// eliminando o antipattern fbLimit(N) que truncava listagens silenciosamente.
//
// startAfter(snapshot) usa o orderBy da query (ou __name__ implicito quando nao
// ha orderBy) como cursor — funciona com os mesmos `where` que a query original.
//
// NOTA: pra bases muito grandes (dezenas de milhares), o ideal e agregacao
// server-side. Aqui resolvemos o truncamento mantendo o contrato client-side,
// com teto de seguranca (maxDocs) pra nao explodir memoria/custo no navegador.
//
// IMPORTANTE — batchSize default = 500 NAO e arbitrario: as firestore.rules
// exigem `request.query.limit <= 500` em simples_empresas/lucro_empresas/
// carteiras (e <=1000/<=5000 em outras). fbLimit(batchSize) vira request.query.limit;
// se passar de 500 nessas colecoes a query INTEIRA e negada (permission-denied)
// e o caller engole no catch -> tela vazia silenciosa (bug "Empresas elegiveis (0)").
// 500 satisfaz o cap mais estrito. Pra colecoes com cap maior e alto volume
// (documentos_fiscais, cap 5000) passe batchSize explicito pra ganhar eficiencia.
import {
    collection,
    query,
    getDocs,
    limit as fbLimit,
    startAfter,
    type QueryConstraint,
    type DocumentData,
    type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebaseConfig';

/**
 * Acumulador opcional preenchido pelo fetchAllDocs. `truncated=true` significa
 * que o teto (maxDocs) foi atingido e PODE haver mais docs não lidos — o caller
 * deve avisar o usuário (ex.: export incompleto) em vez de tratar como completo.
 */
export interface FetchAllMeta {
    truncated: boolean;
    count: number;
    maxDocs: number;
}

export async function fetchAllDocs(
    collectionName: string,
    baseConstraints: QueryConstraint[] = [],
    { batchSize = 500, maxDocs = 20000, meta }:
        { batchSize?: number; maxDocs?: number; meta?: FetchAllMeta } = {},
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
    if (meta) { meta.truncated = false; meta.count = 0; meta.maxDocs = maxDocs; }
    if (!db) return [];
    const out: QueryDocumentSnapshot<DocumentData>[] = [];
    let last: QueryDocumentSnapshot<DocumentData> | null = null;
    while (out.length < maxDocs) {
        const constraints = [...baseConstraints];
        if (last) constraints.push(startAfter(last));
        constraints.push(fbLimit(batchSize));
        const snap = await getDocs(query(collection(db, collectionName), ...constraints));
        if (snap.empty) break;
        out.push(...snap.docs);
        if (snap.size < batchSize) break;
        last = snap.docs[snap.docs.length - 1] || null;
    }
    const truncated = out.length >= maxDocs;
    if (meta) { meta.truncated = truncated; meta.count = out.length; }
    if (truncated) {
        console.warn(`[fetchAllDocs] ${collectionName}: teto de ${maxDocs} docs atingido — pode haver mais.`);
    }
    return out;
}
