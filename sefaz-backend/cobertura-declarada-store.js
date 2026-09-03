// ============================================================================
// sefaz-backend/cobertura-declarada-store.js  (casca de I/O)
// ----------------------------------------------------------------------------
// A declaração de que as obrigações FORA DO CATÁLOGO foram entregues por fora.
// A régua está no módulo PURO (`obrigacao-fora-do-catalogo.js`); aqui só o I/O.
//
// 🚨 UMA QUERY PARA A COMPETÊNCIA INTEIRA — nunca uma por empresa. Ler por card
// é o que produziu o **HTTP 429** na Rotina do Mês (27/08): com ~400 clientes,
// cada card disparando a própria leitura estoura o teto e relê o mês inteiro.
// O painel lê uma vez e anexa o resultado a cada rotina.
//
// ⚠️ O ID SAI DO DONO (`idDoFechamento`): a competência circula em quatro
// formas, e `${id}_07/2026` é um documento DIFERENTE de `${id}_2026-07`.
// Montar a chave à mão aqui seria a segunda cópia que a varredura de 26/08
// pegou no store do fechamento.
// ============================================================================

import { normalizarCompetencia } from './competencia.js';
import { idDoFechamento } from './fechamento-store.js';

export const COLECAO_COBERTURAS = 'rotina_coberturas_declaradas';

/** A declaração desta empresa × competência, ou `null`. */
export async function lerCoberturaDeclarada(db, empresaId, competencia) {
    const id = idDoFechamento(empresaId, competencia);
    if (!id || !db) return null;
    try {
        const snap = await db.collection(COLECAO_COBERTURAS).doc(id).get();
        return snap.exists ? (snap.data() || null) : null;
    } catch (e) {
        console.warn(`[cobertura-store] leitura de ${id} indisponível:`, e.message);
        return null;
    }
}

/** Todas as declarações da competência — UMA query, mapa por empresaId. */
export async function lerCoberturasDaCompetencia(db, competencia) {
    const comp = normalizarCompetencia(competencia);
    const mapa = new Map();
    if (!comp || !db) return mapa;
    try {
        const snap = await db.collection(COLECAO_COBERTURAS)
            .where('competencia', '==', comp).get();
        snap.forEach((d) => {
            const dados = d.data() || {};
            if (dados.empresaId) mapa.set(String(dados.empresaId), dados);
        });
    } catch (e) {
        // ⚠️ Falha devolve o mapa VAZIO — a etapa volta a acusar, que é o
        // comportamento de antes. Nunca o contrário: uma leitura que piscou
        // não pode dar quitação a obrigação nenhuma.
        console.warn(`[cobertura-store] declarações de ${comp} indisponíveis:`, e.message);
    }
    return mapa;
}

/** Grava a declaração já CONFERIDA pelo módulo puro. */
export async function gravarCoberturaDeclarada(db, { empresaId, empresaCnpj, competencia, declaracao }) {
    const id = idDoFechamento(empresaId, competencia);
    const comp = normalizarCompetencia(competencia);
    if (!id || !comp) throw new Error('Empresa ou competência ilegível — a declaração não foi gravada.');
    const ref = db.collection(COLECAO_COBERTURAS).doc(id);
    // 🚨 O `set(doc)` sem olhar o que já estava lá APAGAVA a declaração
    // anterior (03/09): "quem declarou antes, e o quê?" é a pergunta de quem
    // confere a competência meses depois — e ela ficava sem resposta. A
    // declaração NOVA continua sendo a que vale (ela substitui a lista de
    // obrigações cobertas); o histórico fica ao lado, como no `ritoRefeito`.
    let anterior = null;
    try {
        const snap = await ref.get();
        anterior = snap.exists ? (snap.data() || null) : null;
    } catch (e) {
        console.warn(`[cobertura-store] leitura prévia de ${id} indisponível:`, e.message);
    }
    const agora = new Date().toISOString();
    const historico = Array.isArray(anterior?.declaracoesAnteriores) ? anterior.declaracoesAnteriores : [];
    const doc = {
        empresaId: String(empresaId),
        empresaCnpj: String(empresaCnpj || '').replace(/\D/g, '') || null,
        competencia: comp,
        ...declaracao,
        gravadoEm: agora,
        primeiraDeclaracaoEm: anterior?.primeiraDeclaracaoEm || anterior?.gravadoEm || agora,
        declaracoesAnteriores: anterior
            ? [...historico, {
                gravadoEm: anterior.gravadoEm || null,
                autor: anterior.autor ?? null,
                obrigacoes: anterior.obrigacoes ?? null,
                texto: anterior.texto ?? null,
                data: anterior.data ?? null,
            }].slice(-10)
            : historico,
    };
    await ref.set(doc);
    return doc;
}
