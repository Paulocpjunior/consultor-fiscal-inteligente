// ============================================================================
// sefaz-backend/fechamento-store.js
// ----------------------------------------------------------------------------
// 🔒 A LEITURA do carimbo do fim de mês — casca fina sobre o Firestore.
//
// Ela existe porque o carimbo passou a ter MUITOS leitores (os dois SPED, a
// rota do ato, a trava da ficha e, na próxima leva, o túnel do CCI) e o **id**
// é a régua que precisa ser única: dois lugares montando `${empresaId}_${comp}`
// à mão divergiriam no dia em que a competência chegasse numa forma diferente
// — e divergiriam em SILÊNCIO, devolvendo "competência aberta" para uma que
// está fechada.
//
// ⚠️ FALHA DE LEITURA DEVOLVE `null`, e isso é decisão, não descuido: `null`
// significa "gere como sempre gerou", que é o comportamento de antes do ato.
// Derrubar a geração do SPED porque o Firestore piscou seria trocar um risco
// de divergência por um app que não entrega o arquivo.
// ============================================================================

import { normalizarCompetencia } from './competencia.js';

export const COLECAO_FECHAMENTOS = 'fechamentos_competencia';

/**
 * O id do carimbo — régua ÚNICA.
 *
 * A competência normaliza aqui: ela circula em quatro formas neste app, e
 * `${empresaId}_07/2026` é um id DIFERENTE de `${empresaId}_2026-07`. Sem
 * isto, fechar por um caminho e ler por outro daria dois documentos para o
 * mesmo mês — a armadilha das duas formas na CHAVE.
 */
export function idDoFechamento(empresaId, competencia) {
    const comp = normalizarCompetencia(competencia);
    if (!empresaId || !comp) return null;
    return `${empresaId}_${comp}`;
}

/** O carimbo desta empresa × competência, ou `null`. */
export async function lerFechamentoDaCompetencia(db, empresaId, competencia) {
    const id = idDoFechamento(empresaId, competencia);
    if (!id || !db) return null;
    try {
        const snap = await db.collection(COLECAO_FECHAMENTOS).doc(id).get();
        return snap.exists ? (snap.data() || null) : null;
    } catch (e) {
        console.warn(`[fechamento-store] leitura de ${id} indisponível:`, e.message);
        return null;
    }
}
