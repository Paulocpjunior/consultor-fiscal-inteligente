/**
 * credito-icms-simples.js — o CRÉDITO DE ICMS da compra de fornecedor OPTANTE
 * DO SIMPLES NACIONAL (LC 123/2006, art. 23, §§ 1º e 2º). PURO.
 *
 * Paulo, 30/09, A CASTELLANO, NF 6565 da NATHYPEL (CSOSN 101): *"compra de
 * fornecedor do SIMPLES nacional, onde as informações de valor de alíquota e
 * base vêm no campo de informações adicionais … pensando nas empresas que
 * compram muito, não dá; pode ter um campo aqui para ajustar"*. O documento
 * diz: "PERMITE O APROVEITAMENTO DO CRÉDITO DE ICMS NO VALOR DE R$ 52,73
 * CORRESPONDENTE À ALÍQUOTA DE 3,48%, NOS TERMOS DO ART. 23 DA LC 123/2006",
 * e o app escriturava base e ICMS ZERO (o destaque do CSOSN 101 é zero).
 *
 * 📖 A LEI:
 *  · art. 23, § 1º — o NÃO optante tem direito a crédito do ICMS incidente
 *    sobre as aquisições de ME/EPP optante "desde que DESTINADAS À
 *    COMERCIALIZAÇÃO OU INDUSTRIALIZAÇÃO";
 *  · art. 23, § 2º — a alíquota do crédito "deverá ser informada no documento
 *    fiscal" — e ela está no próprio XML: o grupo ICMSSN101 (e o 201/900) traz
 *    `pCredSN` (alíquota) e `vCredICMSSN` (valor). O texto de informações
 *    adicionais é a forma impressa da MESMA informação.
 *  · art. 23, caput — o optante NÃO se credita (régua que já existe em
 *    `entradaGeraCreditoIcms`, e que continua mandando).
 *
 * A RÉGUA, por precedência:
 *  1. o que a pessoa INFORMOU na nota (`creditoSimplesInformado.aliq`) — a
 *     correção de quem olhou o papel; 0 é resposta ("esta nota não dá crédito");
 *  2. o XML (`pCredSN`/`vCredICMSSN` do item);
 *  3. nada → sem crédito do Simples (ausência não vira crédito).
 * E só APLICA na entrada escriturada com CFOP de comercialização ou
 * industrialização (§ 1º). Uso, consumo e ativo ficam SEM o crédito, DITOS.
 *
 * O texto das informações adicionais NÃO vira crédito sozinho: ele é lido só
 * para SUGERIR o valor na tela (`creditoSimplesDoTexto`). O dado estruturado é
 * o do XML; o texto é o espelho humano dele.
 */

const so = (v) => String(v ?? '').replace(/\D/g, '');
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function numero(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const t = String(v).trim();
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
    return Number.isFinite(n) ? n : null;
}

/** CSOSN — Tabela B do Simples (Ajuste SINIEF 03/2010). Só na EMISSÃO do optante. */
export const CSOSN = Object.freeze(new Set(['101', '102', '103', '201', '202', '203', '300', '400', '500', '900']));
/** CSOSN com ICMS-ST (cobrado nesta operação ou anteriormente). */
export const CSOSN_COM_ST = Object.freeze(new Set(['201', '202', '203', '500']));

/**
 * Sufixos de CFOP de ENTRADA para COMERCIALIZAÇÃO ou INDUSTRIALIZAÇÃO — o
 * "destinadas à comercialização ou industrialização" do art. 23, § 1º, na
 * tabela CFOP (grupos 1.100 e 1.400 de compras; a faixa 1/2/3 só diz de onde
 * veio). Uso/consumo (x556/x557), ativo (x551/x552) e demais ficam FORA.
 */
export const SUFIXOS_COMERCIALIZACAO_INDUSTRIALIZACAO = Object.freeze(new Set([
    '101', // compra para industrialização
    '102', // compra para comercialização
    '111', // compra p/ industrialização de mercadoria recebida em consignação industrial
    '113', // compra p/ comercialização, de mercadoria recebida em consignação mercantil
    '116', // compra p/ industrialização originada de encomenda para recebimento futuro
    '117', // compra p/ comercialização originada de encomenda para recebimento futuro
    '118', // compra de mercadoria p/ comercialização entregue pelo vendedor remetente
    '120', // compra p/ industrialização, em venda à ordem, já recebida do vendedor remetente
    '121', // compra p/ comercialização, em venda à ordem, já recebida do vendedor remetente
    '122', // compra p/ industrialização em que a mercadoria foi remetida ao industrializador
    '401', // compra p/ industrialização em operação com mercadoria sujeita a ST
    '403', // compra p/ comercialização em operação com mercadoria sujeita a ST
]));

/** O item veio de fornecedor do Simples (CSOSN de 3 dígitos da Tabela do SN)? */
export function ehItemCsosn(item) {
    const c = so(item?.cst ?? item?.cstIcms ?? item?.CST);
    return c.length === 3 && CSOSN.has(c);
}

/** O CFOP de lançamento é de compra para comercialização/industrialização? */
export function cfopDeComercializacaoOuIndustrializacao(cfop) {
    const c = so(cfop);
    return c.length === 4 && /^[123]/.test(c) && SUFIXOS_COMERCIALIZACAO_INDUSTRIALIZACAO.has(c.slice(1));
}

/** Valor líquido do item (base do crédito: o valor da operação). */
function liquidoDoItem(item) {
    return r2((numero(item?.vProd ?? item?.valor) || 0) - (numero(item?.vDesc) || 0));
}

/**
 * O crédito do Simples deste item.
 *
 * @param {object} item
 * @param {{doc?: object, cfopLancado?: string}} ctx
 * @returns {{tem:boolean, aplica:boolean, vBC:number, aliq:number, vICMS:number,
 *            por:'informado'|'xml'|null, motivo:string}}
 */
export function creditoSimplesDoItem(item, { doc = null, cfopLancado = '' } = {}) {
    const vazio = { tem: false, aplica: false, vBC: 0, aliq: 0, vICMS: 0, por: null, motivo: '' };
    const liq = liquidoDoItem(item);
    const informado = doc?.creditoSimplesInformado;
    const aliqInformada = informado ? numero(informado.aliq) : null;

    let aliq = 0; let vICMS = 0; let por = null;
    if (aliqInformada !== null) {
        if (!(aliqInformada > 0)) {
            return { ...vazio, por: 'informado', motivo: 'informado na nota: sem crédito do Simples (alíquota 0).' };
        }
        aliq = aliqInformada;
        vICMS = r2(liq * aliq / 100);
        por = 'informado';
    } else {
        const p = numero(item?.pCredSN);
        if (!(p > 0)) return vazio;
        aliq = p;
        const v = numero(item?.vCredICMSSN);
        vICMS = v > 0 ? r2(v) : r2(liq * p / 100);
        por = 'xml';
    }

    const base = { tem: true, vBC: liq, aliq, vICMS, por };
    const cfop = so(cfopLancado);
    if (!cfop) {
        return { ...base, aplica: false, motivo: 'sem CFOP de lançamento para conferir o destino da mercadoria.' };
    }
    if (!cfopDeComercializacaoOuIndustrializacao(cfop)) {
        return {
            ...base, aplica: false,
            motivo: `escriturada com CFOP ${cfop}, que não é compra para comercialização ou industrialização — `
                + 'o art. 23, § 1º, só dá o crédito nesse destino (uso, consumo e ativo ficam sem).',
        };
    }
    return { ...base, aplica: true, motivo: '' };
}

/**
 * O CST do DECLARANTE para o item de fornecedor do Simples (Guia Prático EFD
 * ICMS/IPI 3.2.3, C170 campo 10: "Nas operações de aquisição de produtos de
 * empresas do Simples Nacional, deverá ser indicado o CST_ICMS definido pelo
 * Convênio S/N de 1970", sob o enfoque do declarante; e a Tabela: "O CSOSN …
 * é utilizado somente na emissão da NF-e, não é utilizado no registro das
 * mercadorias nas entradas").
 *
 * A ORIGEM é a do item (`<orig>`), nunca o 1º dígito do CSOSN — lido como CST,
 * o "101" declarava mercadoria IMPORTADA (origem 1) com tributação "01", que
 * não existe. A tributação:
 *  · com o crédito do art. 23 aproveitado → 00 (tributada, com crédito; é o
 *    que a equipe já informava à mão na NF 6565) — ou 10 no 201 (crédito da
 *    operação própria + ST);
 *  · CSOSN com ST sem crédito → 60 (Guia, exemplo 2: aquisição com ICMS
 *    retido por ST → 60);
 *  · demais → 90 (Outras: sem crédito — Guia, exemplo 1, e a coluna que o
 *    Livro já usa para "sem crédito").
 *
 * @returns {string|null} CST de 3 dígitos, ou null quando o item não é CSOSN
 *   ou não traz a origem (sem origem não se monta CST — não se deduz).
 */
export function cstDeEntradaDoCsosn(item, { creditoAplicado = false } = {}) {
    if (!ehItemCsosn(item)) return null;
    const orig = so(item?.orig);
    if (orig.length !== 1) return null;
    const csosn = so(item?.cst ?? item?.cstIcms ?? item?.CST);
    let trib;
    if (CSOSN_COM_ST.has(csosn)) trib = creditoAplicado && csosn === '201' ? '10' : '60';
    else trib = creditoAplicado ? '00' : '90';
    return `${orig}${trib}`;
}

/**
 * Lê do TEXTO de informações adicionais a alíquota e o valor do crédito — só
 * para SUGERIR na tela (o texto é o espelho humano do `pCredSN`). Devolve null
 * quando o texto não fala de crédito do Simples.
 * @returns {{aliq:number|null, valor:number|null}|null}
 */
export function creditoSimplesDoTexto(texto) {
    const t = String(texto || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!/CREDITO/.test(t) || !/(SIMPLES|ART\.?\s*23|LC\s*123)/.test(t)) return null;
    const mAliq = t.match(/ALIQUOTA\s+DE\s+([\d]+(?:[.,]\d+)?)\s*%/);
    const mValor = t.match(/VALOR\s+DE\s+R\$\s*([\d.]*\d(?:,\d{1,2})?)/);
    const aliq = mAliq ? numero(mAliq[1].replace('.', ',')) : null;
    const valor = mValor ? numero(mValor[1]) : null;
    if (aliq === null && valor === null) return null;
    return { aliq, valor };
}

/**
 * Confere a alíquota que a pessoa quer gravar na nota.
 * Vazio = limpar (volta ao XML). 0 = "sem crédito". Acima de 18% é recusa: a
 * parcela de ICMS do Anexo I/II nunca chega perto disso (o documento traz algo
 * entre 1,25% e 3,95%), então o número digitado é outro dado.
 * @returns {{ok:boolean, aliq:number|null, motivo?:string}}
 */
export function conferirAliquotaCreditoSimples(valor) {
    const t = String(valor ?? '').trim();
    if (!t) return { ok: true, aliq: null };
    const n = numero(t);
    if (n === null || n < 0) return { ok: false, aliq: null, motivo: `Alíquota "${t}" ilegível — use o formato 3,48.` };
    if (n > 18) return { ok: false, aliq: null, motivo: `Alíquota de crédito do Simples de ${n}% não existe — o documento traz algo entre 1,25% e 3,95%. Confira o texto da nota.` };
    return { ok: true, aliq: r2(n) };
}

/**
 * O resumo para o aviso da geração: quanto de crédito do Simples entrou e o
 * que ficou de fora por destino (uso/consumo/ativo).
 * @param {Array<{numero:string, r:ReturnType<typeof creditoSimplesDoItem>, credita:boolean}>} decisoes
 */
export function avisosDoCreditoSimples(decisoes) {
    let nAplicado = 0; let vAplicado = 0; const notasAplicadas = new Set();
    let nFora = 0; let vFora = 0; const notasFora = new Set();
    for (const d of decisoes || []) {
        if (!d?.r?.tem) continue;
        if (d.r.aplica && d.credita) { nAplicado += 1; vAplicado += d.r.vICMS; notasAplicadas.add(d.numero); }
        else if (!d.r.aplica) { nFora += 1; vFora += d.r.vICMS; notasFora.add(d.numero); }
    }
    const fmt = (v) => r2(v).toFixed(2).replace('.', ',');
    const lista = (s) => { const a = [...s]; return `nº ${a.slice(0, 8).join(', ')}${a.length > 8 ? ` e mais ${a.length - 8}` : ''}`; };
    const avisos = [];
    if (nAplicado) {
        avisos.push(`Crédito do Simples (LC 123, art. 23): ${nAplicado} item(ns) de fornecedor optante em ${notasAplicadas.size} nota(s) `
            + `entraram COM crédito de ICMS — R$ ${fmt(vAplicado)} (base = valor do item, alíquota = a do documento, pCredSN) — ${lista(notasAplicadas)}.`);
    }
    if (nFora) {
        avisos.push(`Crédito do Simples NÃO aproveitado: ${nFora} item(ns) em ${notasFora.size} nota(s) (R$ ${fmt(vFora)}) estão escriturados `
            + `com CFOP de uso, consumo ou ativo — o art. 23, § 1º, só dá o crédito na compra para comercialização ou industrialização — ${lista(notasFora)}.`);
    }
    return avisos;
}
