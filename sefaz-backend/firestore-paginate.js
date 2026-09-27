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

// ============================================================================
// 🚨 VARREDURA COM ORÇAMENTO — a fila que ANDA (18/09, J.N. VINATEX · 08/2026)
//
// Paulo, à noite, com o Relatório de Erros do PVA: **159 recusas** no campo 10
// do 0150 (ENDERECO) — *"continua com os erros mesmo relendo"*. De manhã eram
// 732; o ♻️ recuperou 573 e PAROU, e clicar de novo não mudava nada.
//
// 🔴 A CAUSA É A FORMA DO BACKFILL, e ela estava nos QUATRO ♻️ do acervo:
//
//     const snap = await q.limit(teto).get();
//     for (const doc of snap.docs) {
//         if (jaRelido(doc)) { jaTinham++; continue; }   // ← filtro EM MEMÓRIA
//         ...
//     }
//
// O `limit(1000)` corta a fila ANTES do filtro: a query devolve SEMPRE os
// mesmos 1000 primeiros documentos (na ordem do id), a rodada 1 relê esses
// 1000 e carimba, e a rodada 2 recebe os MESMOS 1000 — todos "já relidos" —,
// examina ZERO e para. Os 2501 restantes da competência (3501 no recorte)
// **nunca são alcançados**, e o `restaram: 2501` que a rota devolvia mandava
// *"rode de novo até a fila zerar"* sobre uma fila que não tinha como andar.
//
// É a fila da reconferência de 20/08 (MV LIDER) outra vez: *"rodar de novo
// NÃO continuava — a seleção devolvia exatamente as MESMAS 60"*. Lá o carimbo
// resolveu porque a seleção ORDENAVA pelo carimbo; aqui o carimbo é filtrado
// DEPOIS do corte, então ele não move a fila — ele só a esconde.
//
// ✂️ A CORREÇÃO É PAGINAR POR CURSOR (`startAfter`, o que o `fetchAllDocs`
// acima já faz) e gastar o ORÇAMENTO só no trabalho CARO (baixar o XML do
// Storage): o já-relido é pulado de graça, página a página, até a varredura
// chegar no que falta. Cada rodada avança de verdade, e `restaram` passa a
// ser o que sobrou DEPOIS do que a rodada viu — não o que ela nem olhou.
//
// ⚠️ Firestore: `where(campo,'==',x)` NÃO devolve documento que não TEM o
// campo — por isso o filtro do carimbo continua em memória (a ARMADILHA
// escrita no próprio backfill). O que mudou é a fila não parar no corte.
// ============================================================================

/**
 * Percorre TODOS os documentos de uma query por cursor, chamando `aoDoc` em
 * cada um, e para de buscar páginas quando o ORÇAMENTO de trabalho caro se
 * esgota.
 *
 * `aoDoc(docSnap)` devolve `true` quando CONSUMIU orçamento (fez o trabalho
 * caro — baixou o XML, gravou) e `false` quando só pulou. Documento pulado
 * não conta: é isso que faz a rodada seguinte chegar no que a anterior não
 * alcançou.
 *
 * @param {FirebaseFirestore.Query} baseQuery  query SEM .limit()
 * @param {{
 *   orcamento?: number,     // trabalho caro por rodada (default 1000)
 *   batchSize?: number,     // tamanho da página (default 500)
 *   maxDocs?: number,       // teto de segurança da varredura inteira
 *   aoDoc: (doc: FirebaseFirestore.QueryDocumentSnapshot) => Promise<boolean>|boolean,
 * }} opts
 * @returns {Promise<{ vistos: number, consumidos: number, esgotou: boolean }>}
 *   `esgotou` = a varredura chegou ao FIM da fila (nada ficou por ver).
 */
export async function varrerComOrcamento(baseQuery, { orcamento = 1000, batchSize = 500, maxDocs = 50000, aoDoc }) {
    if (typeof aoDoc !== 'function') throw new Error('varrerComOrcamento: aoDoc é obrigatório');
    let vistos = 0;
    let consumidos = 0;
    let last = null;
    while (vistos < maxDocs) {
        let q = baseQuery.limit(batchSize);
        if (last) q = q.startAfter(last);
        const snap = await q.get();
        if (snap.empty) return { vistos, consumidos, esgotou: true };
        for (const doc of snap.docs) {
            // O orçamento se confere ANTES de olhar o documento: o que não foi
            // visto não conta em `vistos`, e é `vistos` que decide `restaram`.
            if (consumidos >= orcamento) return { vistos, consumidos, esgotou: false };
            vistos++;
            if (await aoDoc(doc)) consumidos++;
        }
        if (snap.size < batchSize) return { vistos, consumidos, esgotou: true };
        last = snap.docs[snap.docs.length - 1];
    }
    console.warn(`[varrerComOrcamento] teto de ${maxDocs} docs atingido — pode haver mais.`);
    return { vistos, consumidos, esgotou: false };
}

/**
 * Quantos documentos da fila a rodada NÃO viu.
 *
 * Fila esgotada ⇒ `0` (resposta, não default). Senão, `count()` — que é
 * AGREGAÇÃO, não lê documento — menos o que foi visto. Contagem indisponível
 * ⇒ `-1` ("há mais e não sei quantos"): nunca 0, que seria a mesma mentira
 * com outra causa.
 *
 * @param {FirebaseFirestore.Query} baseQuery
 * @param {{ vistos: number, esgotou: boolean }} varredura
 * @returns {Promise<number>}
 */
export async function restaramDaVarredura(baseQuery, { vistos, esgotou }) {
    if (esgotou) return 0;
    try {
        const agg = await baseQuery.count().get();
        const total = Number(agg.data()?.count || 0);
        return Math.max(0, total - vistos);
    } catch (e) {
        console.warn('[restaramDaVarredura] count() falhou:', e?.message);
        return -1;
    }
}
