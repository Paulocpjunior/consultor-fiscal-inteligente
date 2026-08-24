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
    // 🚨 A ARMADILHA DAS DUAS FORMAS, na FICHA (21/08, AFFITTARE de novo — o
    // arquivo saiu F001|1 com M200/M600 zerados DEPOIS de a régua existir):
    // a ficha GRAVADA em `fichaFinanceira[]` usa os nomes ACHATADOS
    // (`faturamentoMesLocacao`, `faturamentoFiliaisLocacao` — é o que a tela e
    // o ReportView leem); `faturamentoLocacao`/`faturamentoFiliais.locacao` é
    // a forma do INPUT do cálculo (LucroInput), montada por convertFichaToInput
    // na hora de calcular. A 1ª versão lia SÓ a forma do input — de uma ficha
    // que nunca a tem — e devolvia 0 em silêncio, que é indistinguível de
    // "não houve locação".
    const matriz = n(ficha.faturamentoMesLocacao) || n(ficha.faturamentoLocacao);
    const filiais = n(ficha.faturamentoFiliaisLocacao) || n(ficha.faturamentoFiliais?.locacao);
    return Math.max(0, matriz + filiais);
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
export function indRegCumDoArquivo({
    regimeApuracao, receitaConsolidada = 0, documentosDeReceita = 0,
} = {}) {
    const cumulativo = regimeApuracao === '2' || regimeApuracao === '3';
    if (!cumulativo) return '';
    // 🚨 A PREMISSA "receita do F550 ⇒ não há documento" ERA DA AFFITTARE, e
    // quebrou na primeira empresa que tem os DOIS (PEC PRONTA ENTREGA 1350,
    // 07/2026): serviços prestados (5 documentos) + aluguel. O arquivo saiu
    // CONSOLIDADO (2) declarando A010/A100, e o PVA recusou os seis registros
    // com *"O registro não deve ser informado para esse perfil e/ou tipo de
    // operação"*.
    //
    // Consolidado é o arquivo que NÃO escritura documento. Havendo documento
    // de receita, a escrituração é DETALHADA (9) e o aluguel entra pelo
    // **F100**, não pelo F550 — é o que o EFD assinado da própria PEC
    // (05/2026) faz: `|0110|2||1|9|`, cinco A100 e `|F100|...188836,42...|`.
    return (n(receitaConsolidada) > 0 && n(documentosDeReceita) === 0) ? '2' : '9';
}

/**
 * O ALUGUEL no arquivo **DETALHADO** — registro F100.
 *
 * F550 e F100 declaram a MESMA receita, e a diferença não é de valor: é de
 * PERFIL do arquivo. F550 só existe no consolidado (que não pode ter
 * documento); F100 é o registro de "demais operações" do detalhado, e convive
 * com o bloco A.
 *
 * FONTE do leiaute, campo a campo — EFD-Contribuições ASSINADO da própria PEC
 * PRONTA ENTREGA 55.070.577/0001-61 · 05/2026:
 *
 *   |F100|1|||01052026|188836,42|01|188836,42|0,65|1227,44|01|188836,42|3|5665,09||||||
 *
 * ⚠️ `IND_OPER = 1` vem DESSE arquivo, não de tabela que eu tenha aqui — é a
 * régua da casa: arquivo aceito > leiaute deduzido. `COD_PART` e `COD_ITEM`
 * saem VAZIOS (o aluguel não tem documento nem item), e `DT_OPER` é o 1º dia
 * da competência, como o arquivo assinado faz — a receita é do PERÍODO, não
 * de um dia.
 *
 * ⚠️ Devolve VALORES, não a linha — igual ao `montarF550`.
 */
export function montarF100({ receita, aliqPis, aliqCofins } = {}) {
    const rec = n(receita);
    if (!(rec > 0)) return null;
    const pis = Math.round(rec * n(aliqPis) * 100) / 100;
    const cofins = Math.round(rec * n(aliqCofins) * 100) / 100;
    return { receita: rec, pis, cofins, indOper: IND_OPER_F100_RECEITA };
}

/** IND_OPER do F100 — o valor do arquivo assinado da PEC 05/2026. */
export const IND_OPER_F100_RECEITA = '1';

// ============================================================================
// 🚨 HAVENDO F550, O 1900 É OBRIGATÓRIO — e o bloco 1 saía SEMPRE vazio
//
// Recusa do PVA na AFFITTARE 07/2026 (24/08, Paulo — urgente), literal:
//
//   "Se o somatório do campo Valor Total da Receita Auferida do registro F550
//    e F560 for maior que zero o registro 1900 deve ser preenchido."
//
// O `buildBloco1_Contrib` devolvia `|1001|1|` (bloco SEM DADOS) em todo
// arquivo — ele nasceu assim quando o 1010 de ação judicial foi removido
// (17/08, MANTOAN) e nunca ganhou conteúdo. Com o F550 no ar desde 21/08, o
// bloco 1 vazio virou recusa: o arquivo declara receita e não a consolida.
//
// 📌 O 1900 é a CONSOLIDAÇÃO dos documentos emitidos no período pela PJ do
// Lucro Presumido. Ele não repete a apuração — ele diz, por modelo/situação de
// documento, quanto de receita entrou.
// ============================================================================

/**
 * Campos do 1900, na ORDEM do formulário do próprio PVA (print de 24/08):
 *
 *   |1900|CNPJ|COD_MOD|SER|SUB_SER|COD_SIT|VL_TOT_REC|QUANT_DOC
 *        |CST_PIS|CST_COFINS|CFOP|INFO_COMPL|COD_CTA|
 *
 * Obrigatórios (marcados no formulário): CNPJ, COD_MOD, COD_SIT e VL_TOT_REC.
 *
 * ⚠️ **O QUE A RÉGUA DERIVA, E O QUE ELA SE RECUSA A INVENTAR.**
 *
 * Deriva com certeza:
 *   · `CNPJ`       — o estabelecimento do F010, o mesmo que já sai no arquivo;
 *   · `VL_TOT_REC` — a Σ do F550 (+F560, quando existir). É a PRÓPRIA recusa do
 *                    PVA que define essa igualdade, então aqui não há escolha;
 *   · `CST_PIS`/`CST_COFINS` — os MESMOS do F550 que este módulo emite. Ler de
 *                    outro lugar faria o 1900 e o F550 discordarem no mesmo
 *                    arquivo, que é o defeito que esta casa mais paga.
 *
 * **RECUSA**: `COD_MOD` (Tabela 4.1.1) e `COD_SIT` (Tabela 4.1.2) são código de
 * TABELA OFICIAL e dependem de QUAL documento a empresa emite pelo aluguel —
 * coisa que o app não tem como saber e que não se deduz do valor. Carimbá-los
 * de memória é a família do `1405`, do `5352` e do `PARTSEM`: código inventado
 * que o PVA às vezes ACEITA, e aí o erro só aparece na fiscalização.
 * Sem cadastro, o registro NÃO SAI e a falta vira aviso NOMEADO com a recusa
 * literal do PVA e o lugar de preencher — o mesmo desenho do `0002`, do código
 * 9 do ISS fixo e do `IND_NAT_PJ`.
 *
 * ⚠️ `QUANT_DOC` fica VAZIO de propósito: é campo opcional no formulário, e nós
 * não temos os documentos (é justamente por isso que a receita vem da ficha).
 * O arquivo do e-Fiscal declarava 3 porque ELE tinha os três; escrever um
 * número aqui seria afirmar uma contagem que ninguém fez.
 *
 * ⚠️ Devolve VALORES, não a linha pronta — quem formata é o bloco, igual ao
 * `montarF550`. Formatar aqui criaria uma segunda forma do mesmo número.
 *
 * @returns {{campos: object}|{falta: string[]}|null} — ou os campos, ou o que
 *   falta, ou null quando não há receita.
 */
export function montar1900({
    cnpj, receita, codMod, codSit,
    cstPis = CST_F550_TRIBUTADA, cstCofins = CST_F550_TRIBUTADA,
} = {}) {
    const rec = n(receita);
    // Sem receita não há 1900 — e não há F550 tampouco. Bloco sem dados não se
    // inventa (a régua do 1001, que este mesmo arquivo já aplicava).
    if (!(rec > 0)) return null;

    const doc = String(cnpj || '').replace(/\D/g, '');
    const mod = String(codMod || '').trim();
    const sit = String(codSit || '').trim();

    const falta = [];
    if (!doc) falta.push('CNPJ do estabelecimento');
    if (!mod) falta.push('COD_MOD (modelo do documento — Tabela 4.1.1)');
    if (!sit) falta.push('COD_SIT (situação do documento — Tabela 4.1.2)');
    if (falta.length) return { falta };

    return {
        campos: {
            cnpj: doc,
            codMod: mod,
            serie: '',
            subSerie: '',
            codSit: sit,
            valorTotalReceita: rec,
            quantDoc: '',            // não temos a contagem — ver acima
            cstPis: String(cstPis),
            cstCofins: String(cstCofins),
            cfop: '',                // locação não tem CFOP
            infoCompl: '',
            codCta: '',
        },
    };
}
