import { limparCnpj } from './documento-dv.js';
// ============================================================================
// sefaz-backend/empresa-cadastro-lookup.js
//
// 🚨 ACHAR A EMPRESA NO CADASTRO PELO CNPJ — a metade que faltava da régua.
//
// `empresa-por-cnpj.js` (07/08) resolveu o lado PURO: dada uma lista de
// empresas, comparar SEMPRE por dígitos, porque o cadastro guarda o CNPJ em
// DUAS formas (`51227692000146` e `51.227.692/0001-46`). O comentário dele
// afirma: *"Nenhuma outra rota do CFI consulta por igualdade"*.
//
// A varredura de 22/08 mostrou que isso **deixou de ser verdade** — oito
// pontos consultam o cadastro com `where('cnpj','==',…)`, e seis deles **sem
// fallback nenhum**. Os efeitos, todos calados ou apontando o lugar errado:
//
//  · `xml-importer` não acha o dono e o documento fica **sem dono** —
//    invisível em qualquer filtro por cliente (é o caso GUARANI, 27/07);
//  · os quatro `toggle` (captura SEFAZ e NFS-e Nacional) devolvem
//    **404 "Empresa não encontrada"** para empresa que ESTÁ cadastrada — o
//    erro que manda a pessoa consertar um cadastro que está certo, que é
//    exatamente o defeito que fez `empresa-por-cnpj.js` nascer;
//  · a captura dirigida reporta um cliente em `naoEncontrados`.
//
// ⚠️ E O `where('cnpj','in',[…])` É O MESMO DEFEITO em roupa de lote: ele
// filtra ANTES de normalizar, então o `replace(/\D/g,'')` que vem depois só
// normaliza o que já passou — o mascarado nunca chega lá.
//
// ─── COMO ESTA CASCA RESOLVE ────────────────────────────────────────────────
// 1) Caminho rápido: igualdade por dígitos (é como a maioria está gravada) —
//    1-2 leituras, usa índice.
// 2) Só na FALHA, o índice normalizado: varre `.select('cnpj')` uma vez e
//    guarda cnpj→doc em cache. Uma varredura por janela, não por consulta.
// 3) Cacheia também o **negativo**: CNPJ que não é cliente aparece em toda
//    paginação de captura, e sem isso cada um custaria uma varredura.
//
// ⚠️ LÁPIDE FICA DE FORA nos DOIS caminhos (regra do soft-delete, #290):
// empresa excluída não é "encontrada", e a fundida responde pela outra. Hoje
// os fallbacks de `conferencia-chaves` e da drenagem **não** olhavam a lápide
// e o do `xml-importer` olhava — mesma pergunta, três respostas.
// ============================================================================

/** As duas coleções de cadastro de cliente. */
export const COLECOES_CADASTRO = ['simples_empresas', 'lucro_empresas'];

// ⚠️ Nome mantido pelos consumidores; a normalização é a do dono (`limparCnpj`),
// que PRESERVA letras — o CNPJ alfanumérico (07/2026) apagado pelo `\D` ficava
// com menos de 14 posições e caía em "não é cliente".
export const soDigitos = (v) => limparCnpj(v);

/** Lápide de exclusão ou de fusão — não é empresa "encontrada". */
export const ehLapide = (d) => !!(d && (d._deleted || d._merged_into));

const TTL_MS = 10 * 60_000;
// Negativo vale MENOS: empresa cadastrada há um minuto respondia \"não é cliente\"
// por dez — afirmação falsa sobre o cadastro, com a ação errada na frente.
const TTL_NEGATIVO_MS = 60_000;

// cache do ÍNDICE normalizado, por coleção: { mapa: Map<cnpj, id>, ts }
const indicePorColecao = new Map();
// cache do RESULTADO por cnpj (inclui o negativo): { val, ts }
const cacheResultado = new Map();

/** Zera os caches — usado pelos testes e por quem acabou de gravar cadastro. */
export function limparCacheCadastro() {
    indicePorColecao.clear();
    cacheResultado.clear();
}

async function indiceNormalizado(db, col, agoraMs) {
    const hit = indicePorColecao.get(col);
    if (hit && (agoraMs - hit.ts) < TTL_MS) return hit.mapa;
    const mapa = new Map();
    // `.select('cnpj')` traz só o campo — a varredura antiga lia o doc inteiro.
    const snap = await db.collection(col).select('cnpj', '_deleted', '_merged_into').get();
    snap.forEach((d) => {
        const dados = d.data() || {};
        if (ehLapide(dados)) return;
        const c = soDigitos(dados.cnpj);
        if (c.length === 14 && !mapa.has(c)) mapa.set(c, d.id);
    });
    indicePorColecao.set(col, { mapa, ts: agoraMs });
    return mapa;
}

/**
 * A empresa cadastrada cujo CNPJ bate — comparando SEMPRE por dígitos.
 *
 * @param {object} db        Firestore
 * @param {string} cnpj      em qualquer formato
 * @param {object} [opts]
 * @param {string[]} [opts.colecoes]
 * @param {number} [opts.agoraMs]
 * @returns {Promise<{empresaId: string, colecao: string, cnpj: string}|null>}
 */
export async function acharEmpresaCadastrada(db, cnpj, opts = {}) {
    const alvo = soDigitos(cnpj);
    if (alvo.length !== 14) return null;

    const colecoes = opts.colecoes || COLECOES_CADASTRO;
    const agoraMs = opts.agoraMs ?? Date.now();

    const cacheado = cacheResultado.get(alvo);
    if (cacheado && (agoraMs - cacheado.ts) < (cacheado.val ? TTL_MS : TTL_NEGATIVO_MS)) return cacheado.val;

    let val = null;

    // 1) Caminho rápido — a forma em que a maioria está gravada.
    for (const col of colecoes) {
        const snap = await db.collection(col).where('cnpj', '==', alvo).limit(1).get();
        if (!snap.empty && !ehLapide(snap.docs[0].data())) {
            val = { empresaId: snap.docs[0].id, colecao: col, cnpj: alvo };
            break;
        }
    }

    // 2) Só na falha: o índice normalizado. É AQUI que o CNPJ mascarado casa.
    if (!val) {
        for (const col of colecoes) {
            const mapa = await indiceNormalizado(db, col, agoraMs);
            const id = mapa.get(alvo);
            if (id) { val = { empresaId: id, colecao: col, cnpj: alvo }; break; }
        }
    }

    // Cacheia inclusive o NEGATIVO: CNPJ que não é cliente aparece em toda
    // paginação de captura, e sem isso cada um custaria uma varredura.
    cacheResultado.set(alvo, { val, ts: agoraMs });
    return val;
}

/**
 * Versão em lote — substitui o `where('cnpj','in',[…])`, que filtra ANTES de
 * normalizar e por isso nunca enxerga o CNPJ mascarado.
 *
 * @returns {Promise<Map<string, {empresaId, colecao, cnpj}>>} só os achados
 */
export async function acharEmpresasCadastradas(db, cnpjs, opts = {}) {
    const out = new Map();
    for (const c of Array.isArray(cnpjs) ? cnpjs : []) {
        const alvo = soDigitos(c);
        if (alvo.length !== 14 || out.has(alvo)) continue;
        const achado = await acharEmpresaCadastrada(db, alvo, opts);
        if (achado) out.set(alvo, achado);
    }
    return out;
}
