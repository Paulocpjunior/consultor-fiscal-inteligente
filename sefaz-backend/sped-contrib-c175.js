// ============================================================================
// sefaz-backend/sped-contrib-c175.js — PURO
//
// 🚨 A NFC-e NO EFD-CONTRIBUIÇÕES É C100 + C175, NUNCA C100 SOZINHA
//
// Paulo, 14/09 (HYPE CAFÉ 1385 · 08/2026, PVA 6.2.0): *"deu esses erros, 295
// são de registro C175, e não puxou o M200 nem M210 e assim no COFINS tbm"*.
// Recusa LITERAL, uma por NFC-e:
//
//   "A escrituração das receitas auferidas por Notas Fiscais Eletrônicas de
//    Consumidor Final - NFC-e (COD_MOD = 65) deve ser efetuada de forma
//    individualizada no registro C100, sendo o campo COD_PART facultativo e com
//    a informação referente à base de cálculo, alíquota e valor das
//    contribuições apuradas sendo escrituradas de forma consolidada e
//    analítica (por CST e alíquotas), no registro C175."
//
// E o Guia Prático 1.35 diz o mesmo, duas vezes: no C100 (*"deve a pessoa
// jurídica apresentar somente os registros C100 e C175"*) e na tabela de
// obrigatoriedade (C175: *"O (se existir C100 e COD_MOD igual a 65)"*).
//
// 📖 O QUE O C175 É (Guia 1.35, Registro C175): *"procedimento de escrituração
// similar ao adotado para o registro C190 da EFD-ICMS/IPI"* — um registro por
// combinação de **CFOP + CST (PIS e COFINS) + alíquotas (PIS e COFINS)**,
// consolidando os itens do documento. Não referencia item (não há COD_ITEM),
// então o 0200/0190 continuam de fora para o cupom.
//
// 🚨 POR QUE O M200/M210 SAÍAM ZERADOS NA TELA DO PVA: o PVA regera o bloco M a
// partir dos DOCUMENTOS (Manual do Lucro Presumido, PVA 2.04) — e a validação
// do M210 campo 03 soma o *"VL_OPR do registro C175"*, a do campo 04 soma o
// *"VL_BC_PIS dos registros C175"*. Sem C175, a Receita não vê receita nenhuma
// no cupom; o nosso M210 (com valor) fica sem documento que o sustente e é
// recusado com *"Não deverá existir um registro M210/M610 … não informados
// nos documentos com CST de 01 a 05"*.
//
// ⚠️ EM 24/08 O C170 DA NFC-e SAIU — e estava certo tirar. O que faltou foi a
// OUTRA metade: o registro que o Guia manda no lugar. "Meia correção troca uma
// recusa por outra" (a régua daquele dia), e desta vez a segunda recusa
// esperou a competência seguinte.
//
// 📌 A CONSOLIDAÇÃO É POR CENTAVO: VL_OPR, VL_DESC e as bases são somas de
// inteiros, e o valor do tributo sai da BASE consolidada × alíquota ÷ 100 —
// que é a validação do campo 10/16 do próprio C175. Somar o valor item a item
// deixaria a linha se desmentir por arredondamento.
// ============================================================================

/**
 * CST de PIS/COFINS de SAÍDA em que a contribuição INCIDE (Tabela 4.3.3/4.3.4):
 * 01 alíquota básica · 02 alíquota diferenciada · 03 por unidade de medida ·
 * 05 substituição tributária. Os demais (04 monofásico-revenda, 06 alíquota
 * zero, 07 isenta, 08 sem incidência, 09 suspensão, 49/99 outras) saem com
 * base, alíquota e valor ZERO — e aqui o zero É a resposta ("não há
 * contribuição neste item"), nunca o default de quem não achou o dado.
 *
 * 📖 É a condição da validação do M210 campo 03: *"quando o CST da operação
 * vinculada for 01, 02, 03, 04, 05 com alíquota diferente de zero e 49"*.
 * Aplicar a alíquota do regime a um item CST 04 (refrigerante, cerveja —
 * monofásico) declararia PIS/COFINS sobre revenda que a lei já tributou no
 * fabricante.
 */
export const CST_PISCOFINS_COM_INCIDENCIA = Object.freeze(['01', '02', '03', '05']);

export function cstComIncidenciaNaSaida(cst) {
    return CST_PISCOFINS_COM_INCIDENCIA.includes(String(cst || '').padStart(2, '0'));
}

const cent = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round(x * 100) : 0;
};
const aliq4 = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Number(x.toFixed(4)) : 0;
};

/**
 * Consolida os itens de UMA NFC-e nos registros C175.
 *
 * @param {Array<{cfop: string, vlItem: number, desconto: number, icms: number,
 *   frete?: number, cstPis: string, cstCofins: string, aliqPis: number,
 *   aliqCofins: number}>} itens
 *   um por item do documento, JÁ decididos pela mesma régua do C170
 *   (`pisCofinsDoItemC170` no gerador — CST do item ou 01, alíquota do item ou
 *   do regime, sem incidência ⇒ zeros). `vlItem` é BRUTO (quantidade × preço),
 *   `desconto` é o incondicional (próprio + rateado do documento) e `icms` o
 *   destacado — os dois vão ao campo 04 (Seção 12 do Guia: no C175, exclusão
 *   do ICMS e descontos incondicionais têm a MESMA casa, VL_DESC). `frete` é o
 *   cobrado do adquirente (`fretesDosItens`), que ACRESCE a base e não o VL_OPR.
 * @returns {{registros: Array<object>, avisos: string[]}}
 */
export function consolidarC175(itens) {
    const grupos = new Map();
    const avisos = [];
    for (const it of Array.isArray(itens) ? itens : []) {
        const cfop = String(it?.cfop || '').replace(/\D/g, '').slice(0, 4);
        const cstPis = String(it?.cstPis || '').padStart(2, '0');
        const cstCofins = String(it?.cstCofins || '').padStart(2, '0');
        const incidePis = cstComIncidenciaNaSaida(cstPis);
        const incideCofins = cstComIncidenciaNaSaida(cstCofins);
        const aliqPis = incidePis ? aliq4(it?.aliqPis) : 0;
        const aliqCofins = incideCofins ? aliq4(it?.aliqCofins) : 0;
        const chave = [cfop, cstPis, cstCofins, aliqPis.toFixed(4), aliqCofins.toFixed(4)].join('|');

        const vlItem = cent(it?.vlItem);
        const exclusoes = cent(it?.desconto) + cent(it?.icms);
        // 🚨 O FRETE COBRADO DO ADQUIRENTE É ACRÉSCIMO DE BASE, e NÃO entra no
        // VL_OPR (Guia 1.35, C100 campo 18: acrescer *"ao valor da base de
        // cálculo do PIS/Pasep e da Cofins"*; o VL_OPR é a receita da operação,
        // irmão do VL_ITEM do C170, que o campo 07 define como *"somente o
        // valor das mercadorias"*). Item sem incidência não recebe nada: a
        // parte dele cai numa base que já sai ZERO, que é o que o Guia manda
        // (*"o frete correspondente goza de… não incidência"*).
        const frete = Math.max(0, cent(it?.frete));
        const base = Math.max(0, vlItem + frete - exclusoes);
        const g = grupos.get(chave) || {
            cfop, cstPis, cstCofins, aliqPis, aliqCofins,
            vlOprCent: 0, vlDescCent: 0, basePisCent: 0, baseCofinsCent: 0,
        };
        g.vlOprCent += vlItem;
        g.vlDescCent += exclusoes;
        if (incidePis) g.basePisCent += base;
        if (incideCofins) g.baseCofinsCent += base;
        grupos.set(chave, g);
    }

    const registros = [...grupos.keys()].sort().map((k) => {
        const g = grupos.get(k);
        return {
            cfop: g.cfop,
            vlOpr: g.vlOprCent / 100,
            vlDesc: g.vlDescCent / 100,
            cstPis: g.cstPis,
            vlBcPis: g.basePisCent / 100,
            aliqPis: g.aliqPis,
            // Validação do campo 10: VL_PIS = VL_BC_PIS × ALIQ_PIS ÷ 100.
            vlPis: Math.round((g.basePisCent * g.aliqPis) / 100) / 100,
            cstCofins: g.cstCofins,
            vlBcCofins: g.baseCofinsCent / 100,
            aliqCofins: g.aliqCofins,
            vlCofins: Math.round((g.baseCofinsCent * g.aliqCofins) / 100) / 100,
        };
    });

    // 📖 Guia 1.35, C175 campo 02: *"Na escrituração analítica das NFC-e, só
    // poderão ser informados CFOP iniciados com 5"*. O app não troca o CFOP —
    // seria escriturar operação que a nota não declara —, mas DIZ.
    const foraDe5 = registros.filter(r => r.cfop && !r.cfop.startsWith('5')).map(r => r.cfop);
    if (foraDe5.length) {
        avisos.push(
            `C175 com CFOP ${[...new Set(foraDe5)].join(', ')}: o Guia 1.35 só admite CFOP iniciado `
            + 'com 5 na NFC-e. Confira o CFOP do item na Central de Documentos (✏️ CFOP por nota).',
        );
    }
    return { registros, avisos };
}

/**
 * Os 18 campos do C175 na ORDEM do Guia 1.35 (contagem inclui o REG), com
 * `formatValue` do chamador — a formatação mora em `sped-fiscal-format.js`, e
 * uma segunda forma do número aqui seria a divergência de sempre.
 *
 * Campos 08/09 e 14/15 (base e alíquota POR QUANTIDADE) saem vazios: o app não
 * apura por unidade de medida. 17 COD_CTA e 18 INFO_COMPL vazios.
 */
export function camposDoC175(r, formatValue) {
    return [
        'C175',
        r.cfop,                          //  2 CFOP
        formatValue(r.vlOpr),            //  3 VL_OPR
        formatValue(r.vlDesc),           //  4 VL_DESC (desconto + exclusão do ICMS)
        r.cstPis,                        //  5 CST_PIS
        formatValue(r.vlBcPis),          //  6 VL_BC_PIS
        formatValue(r.aliqPis, 4),       //  7 ALIQ_PIS
        '',                              //  8 QUANT_BC_PIS
        '',                              //  9 ALIQ_PIS_QUANT
        formatValue(r.vlPis),            // 10 VL_PIS
        r.cstCofins,                     // 11 CST_COFINS
        formatValue(r.vlBcCofins),       // 12 VL_BC_COFINS
        formatValue(r.aliqCofins, 4),    // 13 ALIQ_COFINS
        '',                              // 14 QUANT_BC_COFINS
        '',                              // 15 ALIQ_COFINS_QUANT
        formatValue(r.vlCofins),         // 16 VL_COFINS
        '',                              // 17 COD_CTA
        '',                              // 18 INFO_COMPL
    ];
}
