// ============================================================================
// sefaz-backend/receita-sem-documento-f550.js  (PURO — testável)
//
// A RECEITA QUE NÃO TEM DOCUMENTO — o F550 do EFD-Contribuições.
//
// ═══ POR QUE EXISTE (Paulo, 20/08, AFFITTARE 1139) ══════════════════════════
//
// *"o faturamento dela é aluguel, então não tem captura de notas, apenas a
// informação do valor em Locação de Bens na ficha financeira; para efeito de
// EFD CONTRIBUIÇÕES a informação vai no bloco F550"*.
//
// O CFI monta o EFD-Contribuições a partir dos DOCUMENTOS. Numa administradora
// de imóveis não há documento nenhum de receita — o aluguel entra na ficha e
// pronto. Resultado: o arquivo de 07/2026 saiu com **M200 e M600 ZERADOS** para
// uma empresa que fatura ~R$ 21 mil por mês, ou seja **declarando à Receita que
// não há contribuição a pagar**. É a MESMA classe do M200 zerado da MANTOAN
// (18/08) e do Bloco H inteiro zerado (06/08): campo de valor recebendo o
// default de quem não achou o dado.
//
// ═══ O GABARITO É O ARQUIVO ACEITO DA PRÓPRIA EMPRESA ═══════════════════════
//
// EFD-Contribuições de **05/2026** (e-Fiscal, assinado), CNPJ 17213641000127:
//
//   |F001|0|
//   |F010|17213641000127|
//   |F550|21811,34|01|0|21811,34|0,65|141,76|01|0|21811,34|3|654,33|||||
//   |F990|4|
//
// Ele fixa, campo a campo: VL_REC_COMP, CST_PIS **01** (tributável, alíquota
// básica), VL_DESC 0, base = receita, alíquotas 0,65 e 3 (cumulativo), e os
// quatro últimos campos (COD_MOD, CFOP, COD_CTA, INFO_COMPL) **vazios**.
//
// E fixa também o **0110**: aquele arquivo declara `IND_REG_CUM = 2`
// (competência, escrituração **CONSOLIDADA**), não 9 (detalhada). Faz sentido —
// é o F550 que carrega a receita, não os blocos A/C/D. O comentário do nosso
// `build0110` já previa este dia: *"se um dia existir o caminho consolidado, o
// valor passa a DEPENDER do que foi gerado, nunca a ser cravado"*.
//
// ═══ A TRAVA QUE MANDA: DUPLA CONTAGEM ═════════════════════════════════════
//
// Se a receita entrar pelo F550 **e** por um documento de saída, a contribuição
// sai declarada em dobro. Por isso este módulo só trata a receita de **LOCAÇÃO**
// — a que, por natureza, não gera documento capturável — e **DIZ** quando o
// período também tem documento de receita, com os dois números do lado. Não
// escolhe: quem decide é quem olha a ficha.
//
// ⚠️ E as outras receitas da ficha (comércio, indústria, serviço) ficam FORA de
// propósito: elas têm documento e já entram pelos blocos A/C/D. Trazê-las para
// cá "para garantir" seria exatamente a dupla contagem que a trava evita.
// ============================================================================

export const FONTE_F550 = 'EFD-Contribuições ACEITO da AFFITTARE 17213641000127 · 05/2026 '
    + '(|F550|21811,34|01|0|21811,34|0,65|141,76|01|0|21811,34|3|654,33|||||) + decisão do Paulo em 20/08: '
    + '"o faturamento dela é aluguel … a informação vai no bloco F550".';

/** CST de receita tributada à alíquota básica — o do arquivo aceito. */
export const CST_F550_TRIBUTADA = '01';

const n = (v) => {
    const x = parseFloat(v || 0);
    return Number.isFinite(x) ? x : 0;
};

/**
 * A receita de LOCAÇÃO da competência, somando matriz e filiais.
 *
 * A ficha do Lucro guarda `faturamentoLocacao` (matriz) e
 * `faturamentoFiliais.locacao` — é o campo "Locação de Bens" da tela.
 *
 * @param {object} ficha item de `fichaFinanceira[]` (LucroInput)
 * @returns {number}
 */
export function receitaDeLocacao(ficha) {
    if (!ficha) return 0;
    return Math.max(0, n(ficha.faturamentoLocacao) + n(ficha.faturamentoFiliais?.locacao));
}

/**
 * Monta o F550 da receita sem documento.
 *
 * @param {object} p
 * @param {number} p.receita        receita auferida no período (competência)
 * @param {number} p.aliqPis        0.0065 no cumulativo
 * @param {number} p.aliqCofins     0.03 no cumulativo
 * @returns {{linha: string[], receita: number, pis: number, cofins: number}|null}
 *   `null` quando não há receita — bloco sem dados não se inventa.
 */
export function montarF550({ receita, aliqPis, aliqCofins } = {}) {
    const rec = n(receita);
    if (!(rec > 0)) return null;
    // 🚨 O CENTAVO — e aqui o arquivo aceito NÃO é gabarito, porque ele se
    // desmente dentro de si mesmo. Para a mesma receita de 21.811,34 ele traz
    // **F550 = 141,76** e **M200 = 141,77** (COFINS: 654,33 × 654,34). A causa
    // provável está no próprio arquivo: o registro 1900 dele declara
    // `QUANT_DOC 3`, ou seja o e-Fiscal calculou documento a documento e somou
    // os arredondamentos, enquanto o M200 calculou sobre o total.
    //
    // Nós não temos os 3 documentos — eles não existem, é exatamente por isso
    // que a receita vem da ficha. Reproduzir o 141,76 exigiria inventar o
    // rateio. Então a escolha é a COERÊNCIA INTERNA: F550 e M200 saem do MESMO
    // número, calculado sobre o total. Um centavo de diferença contra o
    // e-Fiscal é aceitável; um arquivo que se contradiz não é — e a régua de
    // 11/08 manda: **o e-Fiscal é referência, nunca gabarito, e VALOR de lá não
    // é verdade**.
    const pis = Math.round(rec * n(aliqPis) * 100) / 100;
    const cofins = Math.round(rec * n(aliqCofins) * 100) / 100;
    return { receita: rec, pis, cofins };
}

/**
 * O período tem receita vindo de DOCUMENTO? Se tiver, F550 + documento é dupla
 * contagem — e o app precisa DIZER, com os dois números.
 *
 * @param {Array} notas
 * @param {(d:any)=>string} direcaoEfetiva
 * @returns {{quantidade: number}}
 */
export function receitaDeDocumentosNoPeriodo(notas, direcaoEfetiva) {
    let quantidade = 0;
    for (const d of notas || []) {
        if (direcaoEfetiva(d) === 'saida') quantidade += 1;
    }
    return { quantidade };
}

/**
 * IND_REG_CUM do 0110 — DERIVADO do que o arquivo produziu, nunca cravado.
 *
 * 2 = competência, escrituração CONSOLIDADA (a receita vem do F550);
 * 9 = competência, escrituração DETALHADA (a receita vem dos blocos A/C/D).
 *
 * Fonte dos dois: arquivos ACEITOS — o da AFFITTARE 05/2026 traz 2 e só tem
 * F550; o da HS PROJETOS 05/2026 traz 9 e escritura documento a documento.
 *
 * ⚠️ Só vale para o regime CUMULATIVO (COD_INC_TRIB 2 ou 3); fora dele o campo
 * não é informado, como já era.
 */
export function indRegCumDoArquivo({ regimeApuracao, receitaConsolidada = 0 } = {}) {
    const cumulativo = regimeApuracao === '2' || regimeApuracao === '3';
    if (!cumulativo) return '';
    return n(receitaConsolidada) > 0 ? '2' : '9';
}
