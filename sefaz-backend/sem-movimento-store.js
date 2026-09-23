// ============================================================================
// sefaz-backend/sem-movimento-store.js  (casca de I/O)
// ----------------------------------------------------------------------------
// A declaração de que a empresa NÃO TEVE MOVIMENTO na competência. A régua
// está no módulo PURO (`sem-movimento-declarado.js`); aqui só o I/O.
//
// 🚨 UMA QUERY PARA A COMPETÊNCIA INTEIRA — nunca uma por empresa (o HTTP 429
// de 27/08). O ID sai do dono (`idDoFechamento`), pela mesma razão do store
// da cobertura: a competência circula em quatro formas.
// ============================================================================

import { normalizarCompetencia } from './competencia.js';
import { idDoFechamento } from './fechamento-store.js';

export const COLECAO_SEM_MOVIMENTO = 'rotina_sem_movimento_declarado';

/** Todas as declarações da competência — UMA query, mapa por empresaId. */
export async function lerSemMovimentoDaCompetencia(db, competencia) {
    const comp = normalizarCompetencia(competencia);
    const mapa = new Map();
    if (!comp || !db) return mapa;
    try {
        const snap = await db.collection(COLECAO_SEM_MOVIMENTO).where('competencia', '==', comp).get();
        snap.forEach((d) => {
            const dados = d.data() || {};
            if (dados.empresaId) mapa.set(String(dados.empresaId), dados);
        });
    } catch (e) {
        // Falha devolve o mapa VAZIO — a etapa volta a acusar. Uma leitura que
        // piscou não pode dar "sem movimento" a ninguém.
        console.warn(`[sem-movimento-store] declarações de ${comp} indisponíveis:`, e.message);
    }
    return mapa;
}

/** Grava a declaração já CONFERIDA pelo módulo puro. */
export async function gravarSemMovimentoDeclarado(db, { empresaId, empresaCnpj, competencia, declaracao }) {
    const id = idDoFechamento(empresaId, competencia);
    const comp = normalizarCompetencia(competencia);
    if (!id || !comp) throw new Error('Empresa ou competência ilegível — a declaração não foi gravada.');
    const doc = {
        empresaId: String(empresaId),
        empresaCnpj: String(empresaCnpj || '').replace(/\D/g, '') || null,
        competencia: comp,
        ...declaracao,
        gravadoEm: new Date().toISOString(),
    };
    await db.collection(COLECAO_SEM_MOVIMENTO).doc(id).set(doc);
    return doc;
}
