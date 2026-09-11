// ============================================================================
// sefaz-backend/documento-lado-io.js  (I/O)
// ----------------------------------------------------------------------------
// O QUE CHEGA PELA CHAVE É FATO DA NOTA, NÃO DE UM LADO.
//
// Desde 11/09 a mesma chave pode ter DOIS documentos em `documentos_fiscais`:
// o primeiro dono (id = chave) e o OUTRO LADO (id derivado, carimbado
// `ladoDe.chave`) — a contraparte que também é cliente (dono: documento-lado.js).
//
// O evento de cancelamento, a CC-e, a manifestação e a resposta da
// reconferência chegam pela CHAVE e valem para a NOTA. Escritor que gravasse
// só em `doc(chave)` deixaria o lado com a nota cancelada contando no
// faturamento — em silêncio, que é o defeito que esta casa mais paga.
//
// Este módulo é a régua ÚNICA de "quais documentos carregam esta chave?".
// Escritor novo por chave passa por aqui; travado por varredura.
// ============================================================================
import { chaveDoIdDeDocumento } from './documento-lado.js';

/**
 * As referências de TODOS os documentos desta chave — o principal (id = chave)
 * PRIMEIRO, depois os lados. Aceita a chave nua ou um id de lado (a
 * reconferência passa o id do documento que estava na fila dela).
 *
 * Id que não carrega chave (NFS-e do portal, nota digitada) devolve só ele.
 */
export async function refsDaChave(db, idOuChave) {
    const col = db.collection('documentos_fiscais');
    const chave = chaveDoIdDeDocumento(idOuChave);
    if (!chave) return { chave: '', refs: [col.doc(String(idOuChave))] };
    const principal = col.doc(chave);
    let lados = [];
    try {
        const snap = await col.where('ladoDe.chave', '==', chave).get();
        lados = snap.docs.map((d) => d.ref).filter((r) => r.id !== chave);
    } catch (e) {
        // A leitura dos lados falhou: o principal ainda recebe o fato, e a
        // falha sai DITA — engolir aqui seria o lado ficando para trás calado.
        console.warn(`[documento-lado-io] não achei os lados da chave ${chave}: ${e.message}`);
    }
    return { chave, refs: [principal, ...lados] };
}
