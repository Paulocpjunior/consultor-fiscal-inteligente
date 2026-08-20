// ============================================================================
// sefaz-backend/valor-operacao-c190.js  (PURO — testável)
//
// O VALOR DA OPERAÇÃO do C190/D190 — num lugar só.
//
// ═══ POR QUE ESTE MÓDULO EXISTE (Paulo, 20/08, teste da PWR) ════════════════
//
// O Livro de Entradas do CFI dizia `TOTAIS (4 notas) 71.960,81`; o relatório
// "Registros fiscais dos documentos de entradas" do PVA, sobre o arquivo que o
// app tinha ACABADO de gerar, dizia `TOTAL 69.760,36`. A diferença — 2.200,45 —
// é exatamente o "Total de IPI" do mesmo relatório.
//
// A regra é literal, Guia Prático da EFD ICMS/IPI **3.2.3, C190, Campo 05**:
//
//   *"Na combinação de CST_ICMS, CFOP e ALIQ_ICMS, informar neste campo o valor
//   das mercadorias somadas aos valores de fretes, seguros e outras despesas
//   acessórias e os valores de ICMS_ST, FCP_ST e IPI (somente quando o IPI está
//   destacado na NF), subtraídos o desconto incondicional e o abatimento não
//   tributado e não comercial."*
//
// E o C100 fecha pelo outro lado — **Campo 12 (VL_DOC)**: *"deve corresponder ao
// valor total da nota fiscal… exceto para o exercício 2026, quando não devem ser
// considerados os valores de CBS, IBS e IS"*. Em 2026, VL_DOC = Σ VL_OPR.
//
// ═══ POR QUE VIROU DONO, E NÃO UMA LINHA CORRIGIDA ══════════════════════════
//
// A regra estava escrita em TRÊS lugares, e os três discordavam do manual:
//   · o gerador do bloco C somava só o `vProd`;
//   · o validador do editor (R8) exigia `VL_OPR == Σ VL_ITEM dos C170`;
//   · o autofix do C190 REESCREVIA o VL_OPR com essa mesma soma.
// Ou seja: consertar só o gerador faria o editor acusar erro no arquivo certo e
// o autofix desfazer a correção. Corrigir a linha fecha a instância; o dono
// fecha a classe.
//
// ⚠️ E O ARQUIVO NÃO CARREGA TUDO O QUE O DOCUMENTO CARREGA. Frete, seguro e
// outras despesas acessórias moram no **C100** (campos 18/19/20), não no C170 —
// então, lendo só as linhas do arquivo, o valor derivado é um **PISO**, nunca o
// número exato. Por isso as duas leituras têm nomes diferentes e a do arquivo
// devolve piso e teto: afirmar exatidão onde só há limite é o que produz alarme
// falso — e alarme falso é o que ensina a equipe a ignorar a conferência.
//
// ⚠️ "somente quando o IPI está destacado" se resolve sozinho: item sem
// destaque traz vIPI ausente/zero. Não se deduz destaque por CST — campo fiscal
// não recebe default.
// ============================================================================

export const FONTE_VL_OPR = 'Guia Prático EFD ICMS/IPI 3.2.3 — C190, Campo 05 (VL_OPR) '
    + 'e C100, Campo 12 (VL_DOC). Caso PWR 31947349000169 · 07/2026 (20/08).';

/** Número da forma do DOCUMENTO (JS puro, já numérico). */
const nDoc = (v) => {
    const x = parseFloat(v || 0);
    return Number.isFinite(x) ? x : 0;
};

/** Número da forma do ARQUIVO (texto SPED: "1.234,56"). */
const nArq = (v) => {
    const s = String(v ?? '').trim().replace(/\./g, '').replace(',', '.');
    if (!s) return 0;
    const x = Number(s);
    return Number.isFinite(x) ? x : 0;
};

/**
 * VL_OPR a partir do ITEM do documento capturado (forma do banco).
 *
 * Esta é a leitura COMPLETA: o item guarda frete, seguro e outras despesas por
 * item (a NF-e traz em `<prod>`), então aqui não sobra nada por estimar.
 *
 * @param {object} item item de `documentos_fiscais.itens[]`
 * @returns {number}
 */
export function valorOperacaoDoItem(item) {
    if (!item) return 0;
    const mercadorias = nDoc(item.vProd ?? item.valor);
    const acessorias = nDoc(item.vFrete) + nDoc(item.vSeg) + nDoc(item.vOutro);
    const retido = nDoc(item.vICMSST) + nDoc(item.vFCPST);
    const ipiDestacado = nDoc(item.vIPI);
    const abatido = nDoc(item.vDesc) + nDoc(item.vAbatNT);
    return mercadorias + acessorias + retido + ipiDestacado - abatido;
}

/**
 * VL_OPR a partir de uma linha C170 JÁ GERADA (forma do arquivo).
 *
 * ⚠️ É o PISO, não o valor exato: frete/seguro/outras despesas não existem no
 * C170. Quem completa é `acessoriasDoC100`.
 *
 * Índices 0-based com `campos[0] === 'C170'`:
 *   6 VL_ITEM · 7 VL_DESC · 17 VL_ICMS_ST · 23 VL_IPI
 *
 * @param {string[]} campos
 * @returns {number}
 */
export function pisoDoValorOperacaoDoC170(campos) {
    const c = campos || [];
    return nArq(c[6]) - nArq(c[7]) + nArq(c[17]) + nArq(c[23]);
}

/**
 * Frete + seguro + outras despesas acessórias declarados no C100 — o que falta
 * ao piso derivado dos C170 para chegar ao VL_OPR.
 *
 * Índices 0-based com `campos[0] === 'C100'`: 17 VL_FRT · 18 VL_SEG · 19 VL_OUT_DA.
 *
 * @param {string[]} campos
 * @returns {number}
 */
export function acessoriasDoC100(campos) {
    const c = campos || [];
    return nArq(c[17]) + nArq(c[18]) + nArq(c[19]);
}

/**
 * A faixa em que o VL_OPR declarado tem que cair, lendo só o arquivo.
 *
 * Com o documento sem despesas acessórias os dois extremos coincidem e a
 * conferência vira igualdade — que é o caso da esmagadora maioria das notas.
 * Com acessórias, o app confere o que dá para provar (o piso) e NÃO inventa o
 * rateio por grupo de CST/CFOP/alíquota, que a nota não traz.
 *
 * @param {number} piso        soma de `pisoDoValorOperacaoDoC170` do grupo
 * @param {number} acessorias  `acessoriasDoC100` do documento pai
 * @returns {{piso: number, teto: number, exato: boolean}}
 */
export function faixaDoValorOperacao(piso, acessorias) {
    const extra = Math.max(0, nDoc(acessorias));
    return { piso, teto: piso + extra, exato: extra === 0 };
}
