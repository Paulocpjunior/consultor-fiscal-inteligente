// ============================================================================
// sefaz-backend/cfop-parametros-store.js
//
// A LEITURA do 🧠 cérebro do CFOP (`cfop_parametros`) pelo BACKEND — é daqui
// que o SPED (EFD ICMS/IPI e EFD-Contribuições) passa a conhecer o que uma
// pessoa já decidiu para cada fornecedor.
//
// ═══ POR QUE ISTO EXISTE (07/09) ═══════════════════════════════════════════
//
// O cérebro nasceu em 18/08 (Paulo: *"um cérebro que, quando o usuário faz a
// alteração de forma manual, ele deve gravar, criando um parâmetro para os
// próximos meses"*) e a régua que o aplica é ÚNICA (`cfopDoLancamento`, com a
// precedência NF > cérebro > override da empresa > régua automática).
//
// Só que a lista de quem ENTREGA o parâmetro à régua nunca foi MEDIDA: a
// varredura de 07/09 achou que `parametrosCfop` chegava à régua em UM lugar —
// a aba ✏️ CFOP por nota. O SPED (C170, C190, E510, nas DUAS famílias), o
// Exportar SAGE (.FML e preflight), a conferência de correlação, o Livro de
// Entradas, o Resumo por CFOP e o Por produto montavam o contexto SEM ele.
// Ou seja: a pessoa corrigia a nota, clicava "aprender", via o parâmetro na
// aba ✏️… e o ARQUIVO continuava saindo pela régua automática. É a "flag que
// ninguém lê" na forma mais cara — a tela onde a pessoa confirma mostrava um
// CFOP e o livro gravava outro ("conferência que promete número diferente do
// arquivo é pior que não ter tela", 12/08).
//
// ⚠️ FALHA DE LEITURA NÃO VIRA "NÃO HÁ PARÂMETRO" EM SILÊNCIO: devolver `[]`
// calado faria o arquivo sair pela régua automática — o CFOP que a pessoa
// corrigiu de propósito — sem ninguém saber. O cérebro continua sendo palpite
// melhor, não trava (a régua automática segue valendo), mas o fato vai DITO
// nos warnings da geração (a lição do `lerAjustesDaCompetencia`, 04/09).
// ============================================================================

export const COLECAO_CFOP_PARAMETROS = 'cfop_parametros';

/**
 * Só os parâmetros ATIVOS — desligar não apaga (o parâmetro continua explicando
 * as competências que já datou), mas desligado não decide mais nada.
 * `parametroAplicavel` também ignora `ativo === false`; filtrar aqui deixa o
 * contexto do gerador com a MESMA lista que a tela mostra.
 */
export function parametrosAtivos(docs) {
    return (docs || []).filter((p) => p && typeof p === 'object' && p.ativo !== false);
}

/**
 * Lê os parâmetros do cérebro de UMA empresa (admin SDK).
 *
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {string} empresaId
 * @returns {Promise<{ parametros: object[], erro: string|null }>}
 */
export async function lerParametrosCfopDaEmpresa(db, empresaId) {
    const id = String(empresaId || '').trim();
    if (!db || !id) return { parametros: [], erro: null };
    try {
        const snap = await db.collection(COLECAO_CFOP_PARAMETROS)
            .where('empresaId', '==', id)
            .get();
        const docs = (snap?.docs || []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
        return { parametros: parametrosAtivos(docs), erro: null };
    } catch (e) {
        return { parametros: [], erro: e?.message || String(e) };
    }
}

/** O aviso que sai na geração quando a leitura falhou — nunca silêncio. */
export function avisoParametrosCfop(erro) {
    if (!erro) return null;
    return '🧠 Os parâmetros de CFOP por fornecedor (cérebro) NÃO puderam ser lidos'
        + ` (${erro}). O arquivo saiu pela régua automática — se algum fornecedor tinha`
        + ' CFOP ensinado na aba ✏️ CFOP por nota, este arquivo NÃO o aplicou. Gere de novo'
        + ' antes de transmitir.';
}
