// ============================================================================
// sefaz-backend/difal-itens.js  (PURO — testável)
// ----------------------------------------------------------------------------
// CLASSIFICAÇÃO POR ITEM do DIFAL de aquisição.
//
// Paulo, 04/08 — sobre a NF 6831 (UNIVERSAL IMPORTACAO RJ → JOTASUL SP):
//   "algumas notas podem ter mais de um CFOP, mais de um produto, mais de um
//    código de NCM, isso deve ser tratado OBRIGATORIAMENTE, não pode aglutinar;
//    alguns itens podem conter ST ou não."
//
// Ele está certo, e o caso é literal: naquela nota o item 1 é CFOP 6102 (sem
// ST, CST 00) e os itens 2 e 3 são CFOP 6403 (com ST, CST 10). O app tratava
// ST no nível do DOCUMENTO — `totais.vST > 0` jogava a NOTA INTEIRA para a
// antecipação do 426-A, arrastando junto o item que não tem ST e deveria
// entrar no consolidado do mês. O contrário também acontecia.
//
// Aqui a nota é PARTIDA: cada item vai para o seu trilho.
//   • item COM ST     → antecipação do art. 426-A (individual, exige IVA-ST)
//   • item SEM ST     → DIFAL consolidado do mês
// A MESMA nota pode aparecer nos dois lados — e é isso que deve acontecer.
//
// O IVA-ST também é POR ITEM: ele vem da Portaria CAT do SEGMENTO, e o
// segmento sai do NCM. Uma nota com dois NCMs pode precisar de dois IVA-ST
// diferentes; pedir "o IVA-ST da nota" seria pedir a coisa errada.
// ============================================================================

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const so = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * CST/CSOSN que indicam ICMS por SUBSTITUIÇÃO TRIBUTÁRIA no item.
 * 10/30/70 = ST retida pelo remetente · 60 = ST já cobrada anteriormente.
 * 201/202/203/500 = equivalentes do Simples (CSOSN).
 */
export const CST_COM_ST = new Set(['10', '30', '60', '70', '201', '202', '203', '500']);

/** CFOPs de venda com ST (ótica do emitente) — sinal secundário. */
const CFOP_ST_FINAL = new Set(['401', '403', '404', '405']);

/**
 * O ITEM tem ST? Ordem: valor destacado → CST/CSOSN → CFOP.
 *
 * O valor vem primeiro porque é fato consumado; CST e CFOP são classificação
 * e podem vir errados do emitente.
 */
export function itemTemSt(item) {
    if (num(item?.vICMSST) > 0 || num(item?.vBCST) > 0) return true;

    const cst = so(item?.cst);
    // CST do ICMS tem 2 dígitos (o 1º é a origem, que vem em campo próprio);
    // CSOSN tem 3. Um "010" é CST 10 com a origem grudada.
    const normalizado = cst.length === 3 && !CST_COM_ST.has(cst) ? cst.slice(1) : cst;
    if (CST_COM_ST.has(normalizado) || CST_COM_ST.has(cst)) return true;

    const cfop = so(item?.cfop);
    return cfop.length === 4 && CFOP_ST_FINAL.has(cfop.slice(1));
}

/**
 * Encargos do item (frete, seguro, outras despesas, IPI) para o VA do 426-A.
 *
 * O ideal é o valor POR ITEM, que a NF-e traz em <prod>. Documento antigo
 * capturado antes de 04/08 não tem esses campos: aí o encargo do TOTAL é
 * rateado proporcionalmente ao valor do item e a linha sai marcada
 * `encargosRateados` — o colaborador precisa saber que aquilo é estimativa,
 * não o que está escrito na nota.
 */
export function encargosDoItem(item, nota) {
    const temNoItem = item?.vFrete != null || item?.vSeg != null || item?.vOutro != null;
    if (temNoItem) {
        return {
            frete: num(item.vFrete),
            seguro: num(item.vSeg),
            outros: num(item.vOutro),
            ipi: num(item.vIPI),
            rateados: false,
        };
    }

    const totalProdutos = (nota?.itens || []).reduce((s, i) => s + num(i?.vProd), 0);
    const proporcao = totalProdutos > 0 ? num(item?.vProd) / totalProdutos : 0;
    const t = nota?.totais || {};
    const freteTot = num(t.vFrete);
    const segTot = num(t.vSeg);
    const outroTot = num(t.vOutro);
    const houveEncargo = freteTot > 0 || segTot > 0 || outroTot > 0;

    return {
        frete: r2(freteTot * proporcao),
        seguro: r2(segTot * proporcao),
        outros: r2(outroTot * proporcao),
        ipi: num(item?.vIPI),
        // Só é "rateado" se havia o que ratear — nota sem frete não vira aviso.
        rateados: houveEncargo && proporcao > 0,
    };
}

/**
 * Uma linha por ITEM, com tudo que os dois trilhos precisam.
 * NADA é somado aqui: agregação é decisão de quem consome.
 */
export function linhasDeItem(nota) {
    return (nota?.itens || []).map((item, idx) => {
        const enc = encargosDoItem(item, nota);
        const valorProduto = r2(num(item?.vProd) - num(item?.vDesc));
        return {
            nItem: String(item?.nItem ?? idx + 1),
            cProd: String(item?.cProd ?? ''),
            xProd: String(item?.xProd ?? ''),
            ncm: so(item?.ncm),
            cfop: so(item?.cfop),
            cst: so(item?.cst),
            orig: String(item?.orig ?? ''),
            valorProduto,
            // VA do art. 426-A §2º: valor da mercadoria + encargos do adquirente.
            valorAquisicao: r2(valorProduto + enc.frete + enc.seguro + enc.outros + enc.ipi),
            encargosRateados: enc.rateados,
            vBC: num(item?.vBC),
            vICMS: num(item?.vICMS),
            aliqIcms: num(item?.aliqIcms),
            vICMSST: num(item?.vICMSST),
            temSt: itemTemSt(item),
        };
    });
}

/**
 * Parte a nota nos dois trilhos.
 *
 * @returns {{comSt: object[], semSt: object[], mista: boolean, itens: object[]}}
 *   `mista` = a nota tem itens dos DOIS tipos (o caso da NF 6831). É o sinal
 *   de que tratar no nível do documento estaria errado.
 */
export function classificarItensDifal(nota) {
    const itens = linhasDeItem(nota);
    const comSt = itens.filter((i) => i.temSt);
    const semSt = itens.filter((i) => !i.temSt);
    return { itens, comSt, semSt, mista: comSt.length > 0 && semSt.length > 0 };
}
