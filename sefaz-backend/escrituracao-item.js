// ============================================================================
// sefaz-backend/escrituracao-item.js  (PURO — testável)
// ----------------------------------------------------------------------------
// O CFOP e o CST informados POR ITEM de uma nota — o dono de onde eles moram
// no documento e de como um item é identificado.
//
// ═══ POR QUE EXISTE ═════════════════════════════════════════════════════════
//
// Sandra (colaboradora), 11/09, via Paulo, com o print do ✏️ Informar CFOP e
// CST: *"essa nota tem 2 produtos, com o CFOP 5929, é uma nota de consumo pra
// Distribuidora, então lançamos como 1407 ou 1556 até aí ok, eu preciso lançar
// 2 CFOPS nessa nota, porque um produto é com ST outro sem ou seja 1407 e 1556,
// como eu ajusto, aqui nesse informar CFOP e CST só consigo colocar um CFOP e
// um CST só"*.
//
// A decisão de 17/08 (Paulo: **"é por NF"**) continua valendo como o caso
// COMUM — e a nota MISTA (item com ST e item sem, na mesma NF) é exatamente o
// caso em que "um CFOP para todos os itens" produz livro ERRADO: o item com ST
// escriturado como 1556 perde a natureza da ST, e o item sem ST escriturado
// como 1407 afirma uma substituição que não houve. A tela já DIZIA isso ("⚠
// mista … o informado vale para todos os itens") — dizer não é resolver.
//
// ═══ O DESENHO ══════════════════════════════════════════════════════════════
//
// `doc.escrituracaoItens = { [nItem]: { cfop?, cst?, por, em } }` — um MAPA à
// parte, nunca uma reescrita de `itens[]`:
//   · `itens[]` é o que o DOCUMENTO declara (a prova do que o fornecedor
//     emitiu), e o merge do Firestore substitui arrays INTEIROS — gravar um
//     item reescreveria os outros, e um backfill (♻️ reler XML) apagaria a
//     decisão humana calado;
//   · o mapa grava por caminho (`escrituracaoItens.3`), então cada item entra
//     e sai sozinho.
//
// PRECEDÊNCIA (o mais específico vence, igual ao cadastro de NCM):
//   ITEM > NOTA > 🧠 cérebro > override da EMPRESA > régua automática.
// Quem aplica é `cfopDoLancamento`/`cstDoLancamento` — aqui só se responde
// "o que foi informado para ESTE item".
//
// ⚠️ A IDENTIDADE DO ITEM É O `nItem` (o atributo <det nItem="…"> do XML).
// Todos os trilhos que criam item o preenchem (xml-importer, xmlParserService,
// notaDigitada — medido em 11/09, e travado pela varredura de 29/08 do 0200).
// Item sem `nItem` NÃO recebe escrituração própria: casar por POSIÇÃO faria a
// decisão pular de produto quando um backfill reordenasse a lista.
// ============================================================================

const so = (v) => String(v == null ? '' : v).replace(/\D/g, '');

/** A chave do item no mapa — '' quando o item não tem identidade. */
export function chaveDoItem(item) {
    const n = so(item && item.nItem);
    return n ? String(Number(n)) : '';
}

/**
 * O que foi informado para ESTE item, ou null.
 *
 * @returns {{cfop: string, cst: string, por: string|null, em: string|null}|null}
 */
export function escrituracaoDoItem(doc, item) {
    const mapa = doc && doc.escrituracaoItens;
    if (!mapa || typeof mapa !== 'object') return null;
    const k = chaveDoItem(item);
    if (!k) return null;
    const e = mapa[k];
    if (!e || typeof e !== 'object') return null;
    // CFOP só vale com 4 dígitos e CST só com a tributação (2) — entrada torta
    // no mapa não vira decisão (a gravação já recusa; aqui é a rede da leitura).
    const cfop = so(e.cfop).length === 4 ? so(e.cfop) : '';
    const cstBruto = so(e.cst);
    const cst = cstBruto.length >= 2 ? cstBruto.slice(-2) : '';
    if (!cfop && !cst) return null;
    return { cfop, cst, por: e.por || null, em: e.em || null };
}

/** CFOP informado para o item (4 dígitos) ou ''. */
export function cfopInformadoDoItem(doc, item) {
    const e = escrituracaoDoItem(doc, item);
    return e ? e.cfop : '';
}

/**
 * Resumo para as telas: quantos itens da nota têm escrituração própria e
 * quais — a lista de nItem, nunca só um número (número sem alvo é meio farol).
 */
export function resumoEscrituracaoItens(doc) {
    const mapa = doc && doc.escrituracaoItens;
    const itens = [];
    if (mapa && typeof mapa === 'object') {
        for (const [k, e] of Object.entries(mapa)) {
            if (!e || typeof e !== 'object') continue;
            if (so(e.cfop) || so(e.cst)) itens.push(String(k));
        }
    }
    itens.sort((a, b) => Number(a) - Number(b));
    return { total: itens.length, nItens: itens };
}

export default { chaveDoItem, escrituracaoDoItem, cfopInformadoDoItem, resumoEscrituracaoItens };
