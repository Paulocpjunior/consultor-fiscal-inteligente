// ============================================================================
// sefaz-backend/cancelamento-gravacao.js  (I/O — gravação ÚNICA)
// ----------------------------------------------------------------------------
// A gravação do cancelamento confirmado pela SEFAZ, num lugar só.
//
// Caso MV LIDER 639 (21/08, "erro persistente"): em 18/08 o Paulo consultou as
// chaves suspeitas na tela 🔎 Consultar NFe por chave e a SEFAZ respondeu
// cStat 653 (cancelada) — e a rota NÃO GRAVAVA NADA. O conhecimento evaporou:
// a reconferência precisou redescobrir as mesmas canceladas a ~20 consultas
// por hora (a SEFAZ pausa com cStat 656), e a aba 🚫 continuou dizendo
// "1 cancelada conhecida" sobre notas que o próprio app já tinha visto
// canceladas. Rota que VÊ o cancelamento e não carimba é a família da "rota
// sem gravação".
//
// Quem GRAVA são as rotas (I/O); quem DECIDE o que a resposta significa é
// `lerRespostaCancelamento` (puro, reconferir-cancelamento.js). Este módulo é
// só a escrita — duas rotas escrevendo cada uma do seu jeito foi o que deixou
// o 🔎 mudo.
// ============================================================================

/**
 * Grava o EVENTO de cancelamento no documento (não um status órfão): assim
 * `docCancelado` decide na leitura como em todo o resto do app.
 */
export async function gravarCancelamentoConfirmado({ db, FieldValue, docId, evento, origem, usuario }) {
    const ref = db.collection('documentos_fiscais').doc(docId);
    const novo = {
        ...(evento || {}),
        origem,
        reconferidoPor: usuario || null,
        reconferidoEm: Date.now(),
    };
    // 🚨 `arrayUnion` só deduplica objeto IGUAL — e o carimbo `reconferidoEm`
    // faz cada gravação ser única. Reconferir a mesma nota duas vezes (a fila
    // GIRA de propósito) empilhava o MESMO evento de cancelamento, e a tela
    // que lista os eventos mostrava "2 cancelamentos" sobre um só. A identidade
    // do evento é tpEvento + protocolo + cStat; a transação evita que dois
    // cliques simultâneos passem os dois pelo "ainda não tem".
    const chave = (ev) => `${ev?.tpEvento || ''}|${ev?.nProt || ''}|${ev?.cStat || ''}`;
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const eventos = Array.isArray(snap.data?.()?.eventos) ? snap.data().eventos : [];
        const jaTem = eventos.some((ev) => chave(ev) === chave(novo));
        const patch = { status: 'cancelado' };
        if (!jaTem) patch.eventos = FieldValue.arrayUnion(novo);
        tx.set(ref, patch, { merge: true });
    });
    return { duplicado: false };
}

/**
 * Carimba que a SEFAZ FOI perguntada sobre esta nota (toda pergunta, não só a
 * cancelada) — é o carimbo que faz a fila da reconferência ANDAR.
 */
export async function carimbarPerguntaSefaz({ db, docId, situacao, cStat }) {
    await db.collection('documentos_fiscais').doc(docId).set({
        reconferenciaSefazEm: Date.now(),
        reconferenciaSefazSituacao: situacao,
        reconferenciaSefazCStat: cStat || null,
    }, { merge: true });
}
