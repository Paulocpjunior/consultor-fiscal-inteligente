// ============================================================================
// sefaz-backend/base-pis-cofins.js  (PURO — testável)
//
// A BASE DO PIS/COFINS — receita, desconto incondicional e a EXCLUSÃO DO ICMS.
//
// ═══ POR QUE EXISTE (Paulo, 20/08, PWR 07/2026) ═════════════════════════════
//
// *"Ele não deduziu o ICMS da base do PIS/COFINS e também não considerou o
// desconto no valor total da nota, só isso."*
//
// O M210 do arquivo declarava base **38.316,84**, que é a soma crua dos `vProd`
// das saídas — sem o desconto e sem a exclusão do ICMS. Duas deduções faltando
// no MESMO campo, e as duas na direção mais cara: o SPED declarava contribuição
// **MAIOR** que a guia que o cliente pagou.
//
// ═══ AS DUAS DEDUÇÕES, E DE ONDE CADA UMA VEM ═══════════════════════════════
//
// 1. **DESCONTO INCONDICIONAL** — não integra a receita. A prova está no
//    documento: a DANFE da NF 7 (PWR → TIBBP, 24/07/2026) traz
//    `V. TOTAL PRODUTOS 18.741,24`, `DESCONTO 562,24` e
//    `V. TOTAL DA NOTA 18.179,00` — e a `BASE DE CÁLC. DO ICMS` é justamente
//    **18.179,00**, ou seja o próprio ICMS já é calculado sobre a receita
//    líquida do desconto. Mesma linguagem do Guia da EFD ICMS/IPI no VL_OPR:
//    *"subtraídos o desconto incondicional"*.
//
// 2. **ICMS FORA DA BASE (Tema 69 / RE 574.706)** — o ICMS destacado não compõe
//    a base do PIS/COFINS. Isto NÃO é dedução minha: o **EFD-Contribuições
//    ACEITO da própria PWR (03/2026, e-Fiscal, assinado)** declara
//    `VL_BC_PIS = 16.055,60` para um item de `VL_ITEM = 19.580,00` com
//    `VL_ICMS = 3.524,40` — a diferença é exatamente o ICMS. E o **próprio CFI
//    já excluía** na ficha do Lucro (`basePisCofins = receitaBrutaEfetiva −
//    icmsVendas − monofásico`, com o RE citado na memória de cálculo). Ou seja:
//    a guia saía de uma base e o SPED declarava outra, MAIOR — duas leituras do
//    mesmo fato dentro do mesmo app.
//
// ═══ O QUE ESTE MÓDULO SEPARA, E POR QUÊ ════════════════════════════════════
//
// **RECEITA ≠ BASE.** O M210 tem os dois campos e eles são diferentes: o
// arquivo aceito traz `VL_REC_BRT = 19.580` e `VL_BC_CONT = 16.055,60`. Juntar
// os dois num número só — que era o que o gerador fazia — apaga a exclusão de
// dentro do próprio registro que deveria mostrá-la.
//
// ⚠️ **E O C100 CONTINUA COM O DESTACADO.** No arquivo aceito, o `VL_PIS` do
// C100 é 127,27 = 0,65% de 19.580 (o que o DOCUMENTO destacou), enquanto o
// C170/M210 trazem 104,36 = 0,65% da base reduzida (o que se APURA). São fatos
// diferentes: um é o que o emitente escreveu na nota, o outro é o que se deve.
//
// ⚠️ **ISS NÃO ENTRA AQUI.** O Tema 69 é sobre o ICMS. A tese do ISS na base
// não está decidida e ninguém a autorizou neste app — excluir por analogia
// seria decidir tributo por dedução minha.
// ============================================================================

export const FONTE_BASE_PIS_COFINS = 'RE 574.706/PR (Tema 69) + EFD-Contribuições ACEITO da PWR '
    + '31947349000169 · 03/2026 (VL_BC_PIS 16.055,60 = VL_ITEM 19.580,00 − VL_ICMS 3.524,40) '
    + '+ DANFE da NF 7 de 07/2026 (V. TOTAL DA NOTA 18.179,00 = 18.741,24 − desconto 562,24).';

const n = (v) => {
    const x = parseFloat(v || 0);
    return Number.isFinite(x) ? x : 0;
};

/**
 * RECEITA do item — o valor da mercadoria líquido do desconto incondicional.
 *
 * É o que vai no `VL_REC_BRT` do M210/M610. Não desconta o ICMS: quem faz isso
 * é `baseDoItem`, e o M210 mostra os dois lado a lado de propósito.
 */
export function receitaDoItem(item) {
    return Math.max(0, n(item?.vProd ?? item?.valor) - n(item?.vDesc));
}

/**
 * O DESCONTO INCONDICIONAL DE CADA ITEM — o próprio, mais a parte que cabe a
 * ele do desconto lançado só no TOTAL do documento.
 *
 * ═══ POR QUE EXISTE (Paulo, 25/08, PWR 1364 · 07/2026) ══════════════════════
 *
 * *"O valor da receita não pode ser esses 38.316,84 e sim 37.754,60 conforme a
 * ficha financeira. Tem que ajustar no C100."*
 *
 * A receita que o PVA mostra no M210 é derivada dos DOCUMENTOS — e enquanto o
 * `VL_MERC` do C100 (e o `VL_ITEM` do C170) carregarem a mercadoria CHEIA, ela
 * sai bruta por construção. O desconto incondicional nunca foi receita, então
 * ele sai do valor do item, e o `VL_DESC` continua informado dizendo quanto
 * foi tirado — nada some do arquivo.
 *
 * ⚠️ **O RATEIO SÓ EXISTE PARA O DESCONTO DE DOCUMENTO**, e é proporcional ao
 * valor do item. Ele não muda nenhum total: a Σ dos descontos rateados é
 * EXATAMENTE o desconto do documento (a sobra de centavos vai no último item),
 * então `Σ VL_ITEM` continua fechando com o `VL_MERC`. Sem fechar na unidade,
 * trocaríamos esta divergência por um erro de arredondamento — que é o mesmo
 * defeito com outra roupa.
 *
 * ⚠️ E ele NÃO se aplica quando os itens já trazem o desconto: o total é a
 * soma dos itens quando eles o declaram, e descontar duas vezes é a armadilha
 * que a régua da receita já tratava.
 *
 * @returns {number[]} um desconto por item, na ordem de `nota.itens`.
 */
export function descontosDosItens(nota) {
    const itens = Array.isArray(nota?.itens) ? nota.itens : [];
    if (!itens.length) return [];

    const proprios = itens.map(i => n(i?.vDesc));
    const somaPropria = proprios.reduce((s, v) => s + v, 0);
    const doTotal = n(nota?.totais?.vDesc);
    if (somaPropria > 0 || !(doTotal > 0)) return proprios;

    const valores = itens.map(i => Math.max(0, n(i?.vProd ?? i?.valor)));
    const soma = valores.reduce((s, v) => s + v, 0);
    if (!(soma > 0)) return proprios;

    // Em CENTAVOS, para a Σ fechar na unidade — a sobra vai no último item.
    const totalCent = Math.round(Math.min(doTotal, soma) * 100);
    const rateio = valores.map(v => Math.floor((v / soma) * totalCent));
    const sobra = totalCent - rateio.reduce((s, v) => s + v, 0);
    rateio[rateio.length - 1] += sobra;
    return rateio.map(c => c / 100);
}

/**
 * O valor do item JÁ LÍQUIDO do desconto incondicional — o que vai ao
 * `VL_ITEM` do C170 e, somado, ao `VL_MERC` do C100.
 *
 * @returns {number[]} um valor por item, na ordem de `nota.itens`.
 */
export function valoresLiquidosDosItens(nota) {
    const itens = Array.isArray(nota?.itens) ? nota.itens : [];
    const desc = descontosDosItens(nota);
    return itens.map((i, k) => Math.max(0, n(i?.vProd ?? i?.valor) - (desc[k] || 0)));
}

/** ICMS destacado no item — o que sai da base pelo Tema 69. */
export function icmsDestacadoDoItem(item) {
    return n(item?.vICMS);
}

/**
 * BASE de cálculo do PIS/COFINS do item: receita − ICMS destacado.
 *
 * Nunca negativa. ICMS ausente (CST 40/41/60, item sem destaque) não inventa
 * exclusão: sem valor destacado, a base é a própria receita.
 */
export function baseDoItem(item) {
    return Math.max(0, receitaDoItem(item) - icmsDestacadoDoItem(item));
}

/**
 * Receita e base do DOCUMENTO inteiro.
 *
 * @param {object} nota
 * @param {number} [valorSemItens] valor do documento quando ele não tem itens
 *   (a NFS-e do portal entra assim). Serviço não tem ICMS destacado, então ali
 *   receita e base coincidem — e é isso que este parâmetro diz, em vez de o
 *   chamador ter que adivinhar.
 * @returns {{receita: number, base: number, icms: number, temItens: boolean}}
 */
export function receitaEBaseDoDocumento(nota, valorSemItens) {
    const itens = Array.isArray(nota?.itens) ? nota.itens : [];
    if (!itens.length) {
        const v = Math.max(0, n(valorSemItens));
        return {
            receita: v, base: v, icms: 0, temItens: false,
            descontoDoDocumento: 0, desconto: 0, receitaBruta: v,
        };
    }
    let receita = 0, base = 0, icms = 0, descontoNosItens = 0;
    for (const item of itens) {
        receita += receitaDoItem(item);
        base += baseDoItem(item);
        icms += icmsDestacadoDoItem(item);
        descontoNosItens += n(item?.vDesc);
    }

    // 🚨 O DESCONTO CHEGA EM DUAS FORMAS — e ler só uma é a armadilha que este
    // projeto mais pagou (11ª vez). A NF-e traz `<prod><vDesc>` POR ITEM, mas há
    // emissor que só preenche o `<ICMSTot><vDesc>` do documento; o importer
    // guarda as duas casas (`itens[].vDesc` e `totais.vDesc`), e quem lê uma só
    // vê a ausência PLAUSÍVEL — "esta nota não tem desconto" — que é
    // indistinguível do caso normal. Aqui o efeito é declarar receita a MAIOR.
    //
    // ⚠️ E NÃO SE DESCONTA DUAS VEZES: o total é a SOMA dos itens quando eles o
    // trazem, então ele só entra quando NENHUM item declarou desconto.
    const doTotal = n(nota?.totais?.vDesc);
    let descontoDoDocumento = 0;
    if (descontoNosItens === 0 && doTotal > 0) {
        descontoDoDocumento = Math.min(doTotal, receita);
        receita -= descontoDoDocumento;
        base = Math.max(0, base - descontoDoDocumento);
    }
    // ⚠️ O DESCONTO SAI NOMEADO, não só aplicado. Paulo, 24/08 (PWR):
    // *"tem que tirar o desconto — e olha que só tem 1 nota, tem empresa que
    // tem MUITOS descontos"*. Sem o número na tela, "a receita está errada" só
    // se resolve com alguém lendo o código; com ele, quem gera confere na hora.
    const desconto = descontoNosItens + descontoDoDocumento;
    return {
        receita, base, icms, temItens: true, descontoDoDocumento,
        desconto, receitaBruta: receita + desconto,
    };
}

/**
 * Códigos de receita do M205/M605 (visão DCTF) — SÓ os PROVADOS.
 *
 * ═══ POR QUE UMA TABELA CURTA, E POR QUE ELA NÃO CRESCE POR DEDUÇÃO ═════════
 *
 * Paulo, 20/08: *"esse registro nós preenchemos manual, tem a possibilidade de
 * já puxar preenchido? O ICMS na parte de obrigação veio preenchido"*.
 *
 * Dá — mas o código de receita é de TABELA OFICIAL, e este projeto já pagou
 * caro por chutar código (o ISS fixo código 9 só entrou quando o número saiu do
 * formulário do e-CAC; o `indAquis` do R-2055 só entrou vindo de evento
 * aceito). Aqui os dois pares vêm do **EFD-Contribuições aceito da própria
 * PWR (03/2026)**: `|M205|12|810902|104,36|` e `|M605|12|217201|481,66|`.
 *
 * `NUM_CAMPO = 12` é o campo 12 do M200/M600 — *Valor da contribuição
 * CUMULATIVA a recolher* —, o que o próprio PVA confirma na lista de valores
 * válidos do registro (08 = não-cumulativa a recolher · 12 = cumulativa).
 *
 * ⚠️ O regime NÃO-CUMULATIVO fica de fora **de propósito**: o código de receita
 * dele não está provado por nenhum arquivo aceito que eu tenha, e um código
 * errado no M205 declara o débito na receita errada da DCTF. Nesse caso o
 * registro não sai e a falta vai DITA, com a ação — mesmo desenho do 0002.
 */
export const CODIGOS_RECEITA_M205 = {
    cumulativo: {
        numCampo: '12',
        pis: '810902',
        cofins: '217201',
        fonte: 'EFD-Contribuições ACEITO da PWR 31947349000169 · 03/2026: |M205|12|810902|104,36| '
            + 'e |M605|12|217201|481,66|.',
    },
};

/**
 * O M205/M605 daquele regime — ou `null` quando o código não está provado.
 *
 * @param {boolean} naoCumulativo
 * @returns {{numCampo: string, pis: string, cofins: string, fonte: string}|null}
 */
export function codigosReceitaM205(naoCumulativo) {
    return naoCumulativo ? null : CODIGOS_RECEITA_M205.cumulativo;
}

/**
 * 🚨 O QUE O ARQUIVO VAI DIZER É O QUE DECIDE — não o float.
 *
 * 28/08, DGB CONSULTORIA 21903193000160 · 07/2026, **12 recusas do PVA**:
 * *"O registro de detalhamento (M205/M605) não deve existir quando o valor
 * informado no campo Valor da Contribuição Não Cumulativa a Recolher/Pagar é
 * 0"* e *"Valor informado deve ser maior que zero"*. O arquivo trazia
 * `|M205|12|810902|0,00|`.
 *
 * A causa NÃO foi a guarda faltando — ela existia (`vlRecCumPis > 0`). Foi o
 * float: a contribuição sai da BASE × ALÍQUOTA (106.553,01 × 0,65% =
 * **692,5945650**) e a retenção vem do documento já em centavos (**692,59**).
 * A diferença é **0,00456…** — maior que zero para o `>`, e **0,00** para o
 * formatador. O registro nasceu porque a régua olhou um número que o arquivo
 * não ia mostrar.
 *
 * Por isso a pergunta certa é *"quantos CENTAVOS vão sair na linha?"*. Quem
 * decide a existência de um registro tem de ler o mesmo número que o PVA lê.
 *
 * @param {number} valor
 * @returns {boolean} o valor sai como 0,00 no arquivo?
 */
export function zeroNoArquivo(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return true;
    return Math.round(n * 100) === 0;
}
