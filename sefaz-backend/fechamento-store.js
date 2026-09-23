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

/**
 * TODOS os carimbos de uma competência — **uma query só**.
 *
 * 🚨 NASCEU DE UM DEFEITO MEU (27/08, o print do Paulo com **HTTP 429** na
 * Rotina do Mês): eu pus o bloco do fim de mês dentro do `map` das empresas, e
 * cada card disparava o próprio `GET /situacao` no mount. Com ~400 clientes
 * isso é ~400 requisições simultâneas contra um teto de 600/min — e, pior,
 * cada uma relia o MÊS INTEIRO de documentos.
 *
 * A régua estava escrita no topo do arquivo que eu editei: *"junta as quatro
 * fontes reais numa leitura só — nada por empresa, senão seriam ~400 idas ao
 * Firestore"*.
 *
 * ⚠️ Filtra por `competencia`, não pelo id: o id é `${empresaId}_${comp}` e
 * montar 400 ids para um `getAll` seria a mesma leitura por empresa com outra
 * roupa.
 */
export async function lerFechamentosDaCompetencia(db, competencia) {
    const comp = normalizarCompetencia(competencia);
    const mapa = new Map();
    if (!comp || !db) return mapa;
    try {
        const snap = await db.collection(COLECAO_FECHAMENTOS)
            .where('competencia', '==', comp).get();
        snap.forEach((d) => {
            const dados = d.data() || {};
            if (dados.empresaId) mapa.set(String(dados.empresaId), dados);
        });
    } catch (e) {
        // Falha devolve o mapa VAZIO — "gere/mostre como sempre", que é o
        // comportamento de antes do ato. Nunca derruba a tela da carteira.
        console.warn(`[fechamento-store] carimbos de ${comp} indisponíveis:`, e.message);
    }
    return mapa;
}
