// ============================================================================
// sefaz-backend/difal-ec87-saida.js  (PURO — testável)
// ----------------------------------------------------------------------------
// DIFAL de SAÍDA — Emenda Constitucional 87/2015. Venda interestadual a
// CONSUMIDOR FINAL **não contribuinte** do ICMS: parte do imposto é devida à UF
// de destino, e o Fundo de Combate à Pobreza (FCP) é devido só a ela.
//
// Registros do EFD ICMS/IPI:
//   C101 — informação complementar do documento (por NF-e modelo 55)
//   E300 — período da apuração, UMA OCORRÊNCIA POR UF
//   E310 — apuração do DIFAL **e** do FCP daquela UF (22 campos desde 2017)
//   E316 — a obrigação a recolher (a guia)
//
// ⚠️ O E310 TEM **DUAS VERSÕES NO MESMO GUIA**, e ler a errada custa o arquivo:
//   · *"VÁLIDO ATÉ 31/12/2016"* — 14 campos, com o FCP INTERCALADO no DIFAL;
//   · *"VÁLIDO A PARTIR DE 01/01/2017"* — **22 campos**, todos os campos do
//     DIFAL (02 a 12) e só então todos os do FCP (13 a 22).
// A primeira escrita deste módulo usou a tabela REVOGADA (os dois títulos são
// quase iguais e a antiga vem antes no arquivo), e o `VL_TOT_DEB_FCP` caiu na
// casa do `VL_TOT_CREDITOS_DIFAL` — o FCP declarado como crédito de DIFAL. O
// teste pegou porque confere o CAMPO, não só o total: é a classe do M210 da
// MANTOAN (18/08), em que a contagem está certa e as casas trocadas.
// A ordem aqui é a das **validações** do E310 novo (Guia 3.2.3, campos 04 a
// 22), corroborada pelo `sped-fiscal-format-autofix.js`, que já a trazia.
//
// 🚨 ISTO É O **TERCEIRO** DESENHO DE DIFAL DESTA CASA, E A PALAVRA É A MESMA.
//   · por FORA   — Simples, guia própria, base × Δ de alíquota
//                  (`difal-aquisicao.js`, `difal-426a.js`)
//   · por DENTRO — RPA, dentro da apuração, RICMS/SP art. 117, par de E111
//                  (`difal-art117-apuracao.js`)
//   · EC 87/15   — **este**, de SAÍDA, apurado POR UF DE DESTINO, em registro
//                  PRÓPRIO (E300/E310/E316) que não toca o E110.
//
// A régua de um NÃO serve para o outro (mata-burro de 14/09). Os dois primeiros
// olham ENTRADA e calculam; este olha SAÍDA e **LÊ** — porque o número já está
// na nota.
//
// ═══ POR QUE ELE NÃO CALCULA ═══════════════════════════════════════════════
//
// O emitente é a PRÓPRIA empresa: a NF-e que ela emitiu já traz o grupo
// `<ICMSUFDest>` em cada item, com a partilha calculada na emissão
// (`vICMSUFDest`, `vICMSUFRemet`, `vFCPUFDest`). Recalcular aqui produziria um
// SEGUNDO número para o mesmo fato — a divergência que esta casa mais paga —,
// e ainda por cima contra o documento que o cliente já transmitiu à SEFAZ.
//
// O Guia 3.2.3 confirma que a leitura é essa: o C101 tem exatamente os três
// campos do grupo, e o E310 campo 04 é a **Σ dos C101**.
//
// ═══ A UF DE ORIGEM NÃO ENTRA ══════════════════════════════════════════════
//
// Guia 3.2.3, E300: *"A partir de janeiro de 2019, deixa de ser obrigatória a
// apresentação do registro E300 para a UF de origem."* E o Convênio ICMS
// 93/2015 (cláusula décima) zerou a partilha do remetente em 2019 — desde
// então `vICMSUFRemet` vem 0,00 na nota.
//
// ⚠️ Mas o app **não crava zero**: ele LÊ o que a NF-e declara e, se algum
// documento trouxer parte do remetente, isso sai DITO num aviso, porque aí a
// competência precisa de um E300 da UF de origem que este módulo não monta.
// Silenciar seria declarar a MENOS num arquivo que o PVA aceita.
//
// ═══ O CÓDIGO DE RECEITA DO E316 NÃO SE INVENTA ════════════════════════════
//
// Campo 05 (COD_REC): *"próprio da unidade da federação da origem/destino,
// conforme legislação estadual"*. É a MESMA régua do E250 do ICMS-ST e do
// 1900 da AFFITTARE: sem cadastro o registro não sai e a falta vai NOMEADA,
// com a recusa do PVA na frase. Código estadual deduzido é o `1405` com outra
// roupa — só que aqui ele diz para QUAL conta o estado recebe.
// ============================================================================

import { docCancelado, direcaoEfetivaDoc } from './xml-metadata-helper.js';
// A UF do destinatário chega em DUAS formas (aninhada × `ufDest` achatado) e o
// MODELO pode não estar gravado (quem responde é a chave) — quem concilia as
// duas é o dono, nunca uma leitura nova (lição de 21/08, em que o ST retido
// para MG/PR/RJ era apurado como se fosse do próprio estado).
import { ufDoDestinatarioDoc, modeloDoDoc } from './participante-doc-helper.js';
import { codSitDoDocumento } from './sped-selecao-documentos.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dec = (n) => r2(n).toFixed(2).replace('.', ',');

/** Ausente = null, nunca 0 — zero aqui vira débito declarado. */
function valorOuNull(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Soma um campo do grupo `ICMSUFDest` nos ITENS do documento.
 *
 * Devolve `null` quando NENHUM item declara o campo — que é diferente de
 * "todos declaram zero". É essa diferença que decide se a reserva do total
 * entra ou não.
 */
function somarNosItens(nota, campo) {
    let achou = false;
    let total = 0;
    for (const item of nota?.itens || []) {
        const v = valorOuNull(item?.[campo]);
        if (v === null) continue;
        achou = true;
        total += v;
    }
    return achou ? r2(total) : null;
}

/**
 * Lê o DIFAL da EC 87/15 que o DOCUMENTO declara.
 *
 * Precedência: **ITEM primeiro, total como RESERVA**. O grupo mora no item
 * (uma nota pode ter item com DIFAL e item sem), e o `<ICMSTot>` só serve
 * para a nota capturada antes de 18/09, que não tem o grupo no item.
 *
 * @returns {{
 *   vIcmsUfDest: number, vIcmsUfRemet: number, vFcpUfDest: number,
 *   temDifal: boolean, origem: 'item'|'total'|null
 * }}
 */
export function difalDoDocumento(nota) {
    const doItem = {
        vIcmsUfDest: somarNosItens(nota, 'vICMSUFDest'),
        vIcmsUfRemet: somarNosItens(nota, 'vICMSUFRemet'),
        vFcpUfDest: somarNosItens(nota, 'vFCPUFDest'),
    };
    const temNoItem = doItem.vIcmsUfDest !== null || doItem.vIcmsUfRemet !== null
        || doItem.vFcpUfDest !== null;

    if (temNoItem) {
        const v = {
            vIcmsUfDest: doItem.vIcmsUfDest ?? 0,
            vIcmsUfRemet: doItem.vIcmsUfRemet ?? 0,
            vFcpUfDest: doItem.vFcpUfDest ?? 0,
        };
        return { ...v, temDifal: v.vIcmsUfDest > 0 || v.vIcmsUfRemet > 0 || v.vFcpUfDest > 0, origem: 'item' };
    }

    const t = nota?.totais || {};
    const doTotal = {
        vIcmsUfDest: valorOuNull(t.vICMSUFDest),
        vIcmsUfRemet: valorOuNull(t.vICMSUFRemet),
        vFcpUfDest: valorOuNull(t.vFCPUFDest),
    };
    const temNoTotal = doTotal.vIcmsUfDest !== null || doTotal.vIcmsUfRemet !== null
        || doTotal.vFcpUfDest !== null;

    if (!temNoTotal) {
        return { vIcmsUfDest: 0, vIcmsUfRemet: 0, vFcpUfDest: 0, temDifal: false, origem: null };
    }
    const v = {
        vIcmsUfDest: doTotal.vIcmsUfDest ?? 0,
        vIcmsUfRemet: doTotal.vIcmsUfRemet ?? 0,
        vFcpUfDest: doTotal.vFcpUfDest ?? 0,
    };
    return { ...v, temDifal: v.vIcmsUfDest > 0 || v.vIcmsUfRemet > 0 || v.vFcpUfDest > 0, origem: 'total' };
}

/**
 * O documento leva C101?
 *
 * Só NF-e (modelo 55) de SAÍDA que declara DIFAL da EC 87/15. O Guia nomeia o
 * registro *"(CÓDIGO 55)"* — o CT-e tem o D101, que este módulo não monta
 * (a VINATEX não presta transporte; emitir leiaute deduzido é o que o `1405`
 * ensinou a não fazer).
 *
 * ⚠️ CANCELADA **entra** no C101 e fica FORA do E310: o Guia exclui do campo 04
 * os documentos com COD_SIT 01 ou 07 (extemporâneos), não os cancelados — mas
 * cancelada não gera débito nenhum. Quem decide é `docCancelado`, porque o
 * campo cru mente quando o cancelamento chega por evento (11/08).
 */
export function documentoLevaC101(nota) {
    if (direcaoEfetivaDoc(nota) !== 'saida') return false;
    if (modeloDoDoc(nota) !== '55') return false;
    return difalDoDocumento(nota).temDifal;
}

/**
 * Campos do C101 — na ORDEM do leiaute (Guia 3.2.3):
 *   01 REG · 02 VL_FCP_UF_DEST · 03 VL_ICMS_UF_DEST · 04 VL_ICMS_UF_REM
 *
 * Devolve ARRAY DE CAMPOS, nunca a linha pronta: quem forma a linha
 * (`|campo|…|\r\n`) é o `buildLine`, e módulo que monta a própria linha foi o
 * que grudou o bloco G inteiro numa linha só (29/08).
 */
export function camposDoC101(nota) {
    const d = difalDoDocumento(nota);
    return ['C101', r2(d.vFcpUfDest), r2(d.vIcmsUfDest), r2(d.vIcmsUfRemet)];
}

/**
 * Agrupa o DIFAL das SAÍDAS por UF de DESTINO.
 *
 * ⚠️ A UF SAI DA RÉGUA, NUNCA DA FORMA ANINHADA — o importer principal grava
 * `ufDest` ACHATADO, e ler só `nota.destinatario?.uf` deixaria a UF vazia em
 * toda nota capturada automaticamente. Aqui isso decide **para qual estado se
 * recolhe**, que é a mesma gravidade do ST (21/08).
 *
 * ⚠️ Documento sem UF legível NÃO cai na UF da empresa: sai NOMEADO em `semUf`.
 * UF de destino inventada é a família do `PARTSEM` num campo que escolhe o
 * credor do imposto.
 *
 * ⚠️ E a UF da EMPRESA é descartada com o motivo: DIFAL de saída para a própria
 * UF não existe (a operação seria interna). Se aparecer, é a UF do destinatário
 * gravada errada — e vai DITA, porque somá-la criaria um E300 do próprio estado
 * que o Guia dispensa desde 2019.
 *
 * @returns {{grupos: object[], semUf: string[], mesmaUf: string[], comParteRemetente: string[]}}
 */
export function agruparDifalPorUf(notas, ufEmpresa) {
    const porUf = new Map();
    const semUf = [];
    const mesmaUf = [];
    const comParteRemetente = [];
    const UF_EMPRESA = String(ufEmpresa || '').toUpperCase();

    for (const nota of notas || []) {
        if (!documentoLevaC101(nota)) continue;
        if (docCancelado(nota)) continue;

        const d = difalDoDocumento(nota);
        const rotulo = String(nota?.numero || nota?.chave || '(sem número)');

        // COD_SIT 01/07 são extemporâneos: o Guia manda somá-los no DEB_ESP do
        // PRIMEIRO período, não no débito normal. O app não escritura
        // extemporâneo hoje — o documento entra no débito e o fato vai dito.
        const codSit = codSitDoDocumento(nota);

        if (d.vIcmsUfRemet > 0) comParteRemetente.push(rotulo);

        const uf = ufDoDestinatarioDoc(nota);
        if (!uf) { semUf.push(rotulo); continue; }
        if (uf === UF_EMPRESA) { mesmaUf.push(rotulo); continue; }

        const atual = porUf.get(uf) || {
            uf, difal: 0, fcp: 0, parteRemetente: 0, documentos: 0, extemporaneos: 0,
        };
        atual.difal = r2(atual.difal + d.vIcmsUfDest);
        atual.fcp = r2(atual.fcp + d.vFcpUfDest);
        atual.parteRemetente = r2(atual.parteRemetente + d.vIcmsUfRemet);
        atual.documentos += 1;
        if (codSit === '01' || codSit === '07') atual.extemporaneos += 1;
        porUf.set(uf, atual);
    }

    const grupos = [...porUf.values()].sort((a, b) => a.uf.localeCompare(b.uf));
    return { grupos, semUf, mesmaUf, comParteRemetente };
}

/**
 * Apura o E310 de UMA UF — as fórmulas são LITERAIS do Guia 3.2.3.
 *
 *   campo 08 VL_SLD_DEV_ANT_DIFAL:
 *     se (04 + 05) − (03 + 06 + 07) ≥ 0 ⇒ o resultado; senão ZERO
 *   campo 10 VL_RECOL_DIFAL:
 *     se (08 − 09) ≥ 0 ⇒ o resultado; senão ZERO
 *   campo 11 VL_SLD_CRED_TRANSPORTAR_DIFAL:
 *     se (03 + 06 + 07 + 09) − (04 + 05) > 0 ⇒ o resultado; senão ZERO
 *
 * E os campos 18/20/21 repetem a mesma aritmética para o FCP.
 *
 * ⚠️ A DEDUÇÃO ENTRA NAS DUAS CONTAS, de propósito: o Guia a soma no saldo
 * credor a transportar (campo 11) **e** a abate do recolhimento (campo 10).
 * É a mesma forma do E110 e do E210 — quem não a aplica declara a MAIOR.
 */
export function apurarDifalDaUf({
    uf,
    difal = 0,
    fcp = 0,
    saldoCredorAnteriorDifal = 0,
    saldoCredorAnteriorFcp = 0,
    ajustes = {},
}) {
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

    // Ajustes do E311, separados pelo 3º caractere do COD_AJ_APUR ('2' = DIFAL,
    // '3' = FCP) e pelo 4º (0/1 débito, 2/3 crédito, 4 dedução, 5 débito
    // especial). Hoje o app não cadastra ajuste de E311 — os campos saem ZERO,
    // e aqui o zero É a resposta ("não houve ajuste"), não o default de quem
    // não achou o dado (regra de 06/08).
    const outDebDifal = n(ajustes.outrosDebitosDifal);
    const outCredDifal = n(ajustes.outrosCreditosDifal);
    const dedDifal = n(ajustes.deducoesDifal);
    const debEspDifal = n(ajustes.debitosEspeciaisDifal);
    const outDebFcp = n(ajustes.outrosDebitosFcp);
    const outCredFcp = n(ajustes.outrosCreditosFcp);
    const dedFcp = n(ajustes.deducoesFcp);
    const debEspFcp = n(ajustes.debitosEspeciaisFcp);

    const apurar = (totDeb, outDeb, sldCredAnt, totCred, outCred, deducoes) => {
        const debitos = r2(totDeb + outDeb);
        const creditos = r2(sldCredAnt + totCred + outCred);
        const sldDevAnt = debitos - creditos >= 0 ? r2(debitos - creditos) : 0;
        const recol = sldDevAnt - deducoes >= 0 ? r2(sldDevAnt - deducoes) : 0;
        const bruto = r2(creditos + deducoes - debitos);
        const sldCredTransp = bruto > 0 ? bruto : 0;
        // Dedução que não coube no saldo devedor NÃO vira crédito por conta
        // própria — ela sai DITA, como no E210 do ST.
        const deducoesExcedentes = deducoes > sldDevAnt ? r2(deducoes - sldDevAnt) : 0;
        return { sldDevAnt, recol, sldCredTransp, deducoesExcedentes };
    };

    const d = apurar(r2(difal), outDebDifal, n(saldoCredorAnteriorDifal), 0, outCredDifal, dedDifal);
    const f = apurar(r2(fcp), outDebFcp, n(saldoCredorAnteriorFcp), 0, outCredFcp, dedFcp);

    return {
        uf: String(uf || '').toUpperCase(),
        // DIFAL (campos 03 a 12)
        sldCredAntDifal: r2(n(saldoCredorAnteriorDifal)),
        totDebitosDifal: r2(difal),
        outDebDifal: r2(outDebDifal),
        totCreditosDifal: 0,
        outCredDifal: r2(outCredDifal),
        sldDevAntDifal: d.sldDevAnt,
        deducoesDifal: r2(dedDifal),
        recolDifal: d.recol,
        sldCredTranspDifal: d.sldCredTransp,
        debEspDifal: r2(debEspDifal),
        // FCP (campos 13 a 22)
        sldCredAntFcp: r2(n(saldoCredorAnteriorFcp)),
        totDebFcp: r2(fcp),
        outDebFcp: r2(outDebFcp),
        totCredFcp: 0,
        outCredFcp: r2(outCredFcp),
        sldDevAntFcp: f.sldDevAnt,
        deducoesFcp: r2(dedFcp),
        recolFcp: f.recol,
        sldCredTranspFcp: f.sldCredTransp,
        debEspFcp: r2(debEspFcp),
        // O que o E316 tem de discriminar (Guia, E316 campo 03):
        //   VL_RECOL_DIFAL + DEB_ESP_DIFAL + VL_RECOL_FCP + DEB_ESP_FCP
        // — em DUAS guias: o FCP tem código de receita próprio (21/09).
        aRecolherDifal: r2(d.recol + debEspDifal),
        aRecolherFcp: r2(f.recol + debEspFcp),
        aRecolher: r2(d.recol + debEspDifal + f.recol + debEspFcp),
        deducoesExcedentes: r2(d.deducoesExcedentes + f.deducoesExcedentes),
    };
}

/** COD_OR do E316 — Tabela 5.4. Valores válidos: [000, 003, 006, 090]. */
export const COD_OR_DIFAL_NORMAL = '000';

/**
 * Os códigos de receita da GNRE para a EC 87/15 — SUGESTÃO para o cadastro,
 * nunca default do gerador.
 *
 * 21/09, Paulo, VINATEX: o PVA recusou o arquivo com *"A soma dos campos
 * VL_RECOL_DIFAL, DEB_ESP_DIFAL, VL_RECOL_FCP e DEB_ESP_FCP deve ser igual à
 * soma do campo VL_OR dos Registros filhos E316"* (8 erros, um por UF) — o
 * E316 não saiu porque o cadastro por UF não foi feito, e ele lançou à mão no
 * PVA: COD_REC **100102** *"ICMS Consumidor Final não contribuinte outra UF
 * por Operação"*, que é o código da tabela de receitas da GNRE (Portal GNRE,
 * Convênio ICMS 93/2015). A tabela é NACIONAL: quem escolhe é a forma de
 * recolher (por OPERAÇÃO = sem inscrição no estado de destino, uma guia por
 * nota; por APURAÇÃO = com inscrição lá, guia mensal), e o **FCP tem código
 * PRÓPRIO** — por isso ele sai em E316 SEPARADO do DIFAL.
 *
 * ⚠️ Estado fora do Portal GNRE recolhe em guia própria com código próprio
 * (o campo continua livre). E a forma de recolher é decisão de quem conhece a
 * inscrição da empresa nos estados — o app oferece a lista, não escolhe.
 */
export const CODIGOS_RECEITA_GNRE_EC87 = Object.freeze([
    { codigo: '100102', tributo: 'difal', descricao: 'ICMS Consumidor Final não contribuinte outra UF por Operação' },
    { codigo: '100110', tributo: 'difal', descricao: 'ICMS Consumidor Final não contribuinte outra UF por Apuração' },
    { codigo: '100129', tributo: 'fcp', descricao: 'ICMS Fundo Estadual de Combate à Pobreza por Operação' },
    { codigo: '100137', tributo: 'fcp', descricao: 'ICMS Fundo Estadual de Combate à Pobreza por Apuração' },
]);

/**
 * Monta as linhas do DIFAL EC 87/15 no bloco E — E300 + E310 (+ E316).
 *
 * Devolve ARRAYS de campos (o `buildLine` forma a linha) e os avisos.
 *
 * @param {object} p
 * @param {object[]} p.notas
 * @param {string}   p.ufEmpresa
 * @param {string}   p.dtIni  ddmmaaaa
 * @param {string}   p.dtFin  ddmmaaaa
 * @param {string}   p.mesRef mmaaaa
 * @param {object}   p.obrigacoesPorUf  { BA: { dtVcto, codRec } }
 * @param {object[]} p.ajustes  ajustes do E111/E311 lançados na aba
 */
export function montarLinhasDifalBlocoE({
    notas, ufEmpresa, dtIni, dtFin, mesRef,
    obrigacoesPorUf = {}, ajustes = [], saldosAnteriores = {},
}) {
    const { grupos, semUf, mesmaUf, comParteRemetente } = agruparDifalPorUf(notas, ufEmpresa);
    const avisos = [];

    if (semUf.length) {
        avisos.push(
            `DIFAL EC 87/15: ${semUf.length} nota(s) de saída com diferencial de alíquota ficaram FORA da `
            + `apuração por UF porque a UF do destinatário não foi capturada — nº ${semUf.slice(0, 8).join(', ')}`
            + `${semUf.length > 8 ? '…' : ''}. Cada UF aqui é uma guia para OUTRO estado: declarar na UF da `
            + 'empresa mandaria o recolhimento para o lugar errado. Rode Relatórios → ✏️ CFOP por nota → '
            + '♻️ Reler participante e município dos XMLs e gere de novo.',
        );
    }
    if (mesmaUf.length) {
        avisos.push(
            `DIFAL EC 87/15: ${mesmaUf.length} nota(s) declaram diferencial de alíquota com o destinatário na `
            + `PRÓPRIA UF da empresa (${String(ufEmpresa || '').toUpperCase()}) — nº ${mesmaUf.slice(0, 8).join(', ')}`
            + `${mesmaUf.length > 8 ? '…' : ''}. Operação interna não tem DIFAL da EC 87/15, então ou a UF do `
            + 'destinatário está gravada errada, ou a nota foi emitida com o grupo indevido. Elas ficaram FORA '
            + 'do E300/E310 — confira antes de transmitir.',
        );
    }
    if (comParteRemetente.length) {
        avisos.push(
            `DIFAL EC 87/15: ${comParteRemetente.length} nota(s) declaram parte do diferencial para a UF do `
            + `REMETENTE (vICMSUFRemet > 0) — nº ${comParteRemetente.slice(0, 8).join(', ')}`
            + `${comParteRemetente.length > 8 ? '…' : ''}. Desde 2019 a partilha é 100% do destino (Convênio `
            + 'ICMS 93/2015, cláusula décima), e o CFI NÃO monta o E300 da UF de origem — o valor sai no C101, '
            + 'como o documento declara, e não entra em apuração nenhuma. Confira a nota: se a parte do '
            + 'remetente for devida, ela precisa ser lançada no PVA.',
        );
    }

    if (grupos.length === 0) return { linhas: [], apuracoes: [], avisos };

    const linhas = [];
    const apuracoes = [];
    const semObrigacao = [];

    // Ajuste do E311 é da tabela 5.1.1 da UF **de DESTINO** (a apuração é dela),
    // e o app só cadastra código da UF da EMPRESA — por isso NENHUM ajuste é
    // aplicado aqui, e o `validarCodigoAjuste` já os recusa com esse motivo.
    // O que sobra é DIZER, uma vez, que eles existem e ficaram de fora: aplicar
    // ajuste na apuração do estado errado é o defeito do ST na direção
    // contrária, e ele não volta como recusa.
    const ajustesDeDifal = (ajustes || [])
        .map((a) => String(a?.codigo || '').trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}[23]\d{5}$/.test(c));

    for (const g of grupos) {
        const ap = apurarDifalDaUf({
            uf: g.uf,
            difal: g.difal,
            fcp: g.fcp,
            saldoCredorAnteriorDifal: saldosAnteriores?.[g.uf]?.difal || 0,
            saldoCredorAnteriorFcp: saldosAnteriores?.[g.uf]?.fcp || 0,
        });
        apuracoes.push({ ...ap, documentos: g.documentos });

        if (g.extemporaneos > 0) {
            avisos.push(
                `DIFAL EC 87/15 de ${g.uf}: ${g.extemporaneos} documento(s) com COD_SIT 01/07 (extemporâneo) `
                + 'entraram no débito normal do E310. O Guia 3.2.3 manda somá-los em DEB_ESP_DIFAL do PRIMEIRO '
                + 'período de apuração — confira no PVA antes de transmitir.',
            );
        }
        if (ap.deducoesExcedentes > 0) {
            avisos.push(
                `DIFAL EC 87/15 de ${g.uf}: R$ ${dec(ap.deducoesExcedentes)} de dedução NÃO aplicada — dedução `
                + 'só abate saldo DEVEDOR (mesma regra do E110). O E310 declara só a parte aplicada.',
            );
        }

        linhas.push(['E300', g.uf, dtIni, dtFin]);
        linhas.push([
            'E310',
            ap.aRecolher > 0 || g.documentos > 0 ? '1' : '0',   // 02 IND_MOV_FCP_DIFAL
            // ── DIFAL: campos 03 a 12 ────────────────────────────────────
            dec(ap.sldCredAntDifal),        // 03 VL_SLD_CRED_ANT_DIFAL
            dec(ap.totDebitosDifal),        // 04 VL_TOT_DEBITOS_DIFAL ← Σ VL_ICMS_UF_DEST dos C101
            dec(ap.outDebDifal),            // 05 VL_OUT_DEB_DIFAL     ← E311 (3º='2', 4º='0'/'1')
            dec(ap.totCreditosDifal),       // 06 VL_TOT_CREDITOS_DIFAL ← devolução (C101 de entrada)
            dec(ap.outCredDifal),           // 07 VL_OUT_CRED_DIFAL    ← E311 (3º='2', 4º='2'/'3')
            dec(ap.sldDevAntDifal),         // 08 VL_SLD_DEV_ANT_DIFAL
            dec(ap.deducoesDifal),          // 09 VL_DEDUCOES_DIFAL    ← E311 (3º='2', 4º='4')
            dec(ap.recolDifal),             // 10 VL_RECOL_DIFAL
            dec(ap.sldCredTranspDifal),     // 11 VL_SLD_CRED_TRANSPORTAR_DIFAL
            dec(ap.debEspDifal),            // 12 DEB_ESP_DIFAL        ← E311 (3º='2', 4º='5')
            // ── FCP: campos 13 a 22, na MESMA ordem ──────────────────────
            dec(ap.sldCredAntFcp),          // 13 VL_SLD_CRED_ANT_FCP
            dec(ap.totDebFcp),              // 14 VL_TOT_DEB_FCP       ← Σ VL_FCP_UF_DEST dos C101
            dec(ap.outDebFcp),              // 15 VL_OUT_DEB_FCP       ← E311 (3º='3', 4º='0'/'1')
            dec(ap.totCredFcp),             // 16 VL_TOT_CRED_FCP
            dec(ap.outCredFcp),             // 17 VL_OUT_CRED_FCP      ← E311 (3º='3', 4º='2'/'3')
            dec(ap.sldDevAntFcp),           // 18 VL_SLD_DEV_ANT_FCP
            dec(ap.deducoesFcp),            // 19 VL_DEDUCOES_FCP      ← E311 (3º='3', 4º='4')
            dec(ap.recolFcp),               // 20 VL_RECOL_FCP
            dec(ap.sldCredTranspFcp),       // 21 VL_SLD_CRED_TRANSPORTAR_FCP
            dec(ap.debEspFcp),              // 22 DEB_ESP_FCP          ← E311 (3º='3', 4º='5')
        ]);

        // ── E316: a obrigação. Só sai COMPLETO ────────────────────────────
        //
        // O Guia amarra a soma do VL_OR ao E310, então o registro é obrigatório
        // quando há o que recolher. Mas COD_REC é código ESTADUAL e DT_VCTO é o
        // prazo daquele estado — nenhum dos dois está no documento nem se
        // deduz. Sem os dois o E316 não sai e a falta vai NOMEADA: é melhor o
        // PVA cobrar o registro (erro que se conserta e reenvia) do que o
        // arquivo declarar código de receita inventado, que ele ACEITA.
        //
        // 🚨 DIFAL E FCP SÃO DUAS GUIAS (21/09, VINATEX): o FCP tem código de
        // receita PRÓPRIO (na GNRE, 100129/100137 contra 100102/100110 do
        // DIFAL). Uma linha só, com o código do DIFAL somando o FCP, passa na
        // aritmética do PVA e declara o FCP na receita ERRADA — recusa que o
        // validador não faz. Cada tributo sai com o seu código, e o que falta
        // vai NOMEADO por tributo.
        if (ap.aRecolher > 0) {
            const o = obrigacoesPorUf?.[g.uf] || {};
            const dtVcto = String(o.dtVcto || '').replace(/\D/g, '');
            const codRec = String(o.codRec || '').trim();
            const codRecFcp = String(o.codRecFcp || '').trim();
            const faltas = [];
            if (ap.aRecolherDifal > 0) {
                if (dtVcto.length === 8 && codRec) {
                    linhas.push(['E316', COD_OR_DIFAL_NORMAL, dec(ap.aRecolherDifal), dtVcto, codRec, '', '', '', '', mesRef]);
                } else {
                    faltas.push(`DIFAL R$ ${dec(ap.aRecolherDifal)}`);
                }
            }
            if (ap.aRecolherFcp > 0) {
                if (dtVcto.length === 8 && codRecFcp) {
                    linhas.push(['E316', COD_OR_DIFAL_NORMAL, dec(ap.aRecolherFcp), dtVcto, codRecFcp, '', '', '', '', mesRef]);
                } else {
                    faltas.push(`FCP R$ ${dec(ap.aRecolherFcp)}`);
                }
            }
            if (faltas.length) semObrigacao.push(`${g.uf} (${faltas.join(' · ')})`);
        }
    }

    // 🚨 O CAMPO 03 DO E310 É O SALDO CREDOR DA COMPETÊNCIA ANTERIOR, e o app
    // NÃO o lê de lugar nenhum — é o defeito do `saldoCredorIpiAnterior`
    // (19/08, PWR): gerador que lê um campo que nenhum orquestrador passa,
    // declarando ZERO e recolhendo a MAIOR, sem nada acusar.
    //
    // Aqui ele é RARO (DIFAL de saída quase só tem débito; crédito aparece com
    // devolução maior que a venda), então o aviso só nasce quando ESTA
    // competência gera saldo a transportar — que é exatamente quando a
    // SEGUINTE vai precisar dele. Alarme em todo arquivo normal desliga a trava.
    const comSaldoATransportar = apuracoes
        .filter((a) => a.sldCredTranspDifal > 0 || a.sldCredTranspFcp > 0)
        .map((a) => `${a.uf} (DIFAL R$ ${dec(a.sldCredTranspDifal)} · FCP R$ ${dec(a.sldCredTranspFcp)})`);
    if (comSaldoATransportar.length) {
        avisos.push(
            `DIFAL EC 87/15: esta competência fecha com SALDO CREDOR a transportar em ${comSaldoATransportar.join(', ')}. `
            + 'O campo 03 do E310 (VL_SLD_CRED_ANT_DIFAL) do MÊS SEGUINTE tem de trazer esse valor, e o CFI ainda '
            + 'não o transporta sozinho — ele sai ZERO. Zero ali é a afirmação "não havia crédito", e recolhe a '
            + 'MAIOR. Lance o saldo no PVA ao gerar a próxima competência.',
        );
    }

    if (ajustesDeDifal.length) {
        avisos.push(
            `DIFAL EC 87/15: ${ajustesDeDifal.length} ajuste(s) com código de DIFAL/FCP (3º caractere '2' ou '3') `
            + `foram lançados — ${ajustesDeDifal.slice(0, 5).join(', ')}${ajustesDeDifal.length > 5 ? '…' : ''} — e `
            + 'NÃO entraram no E310. O ajuste do E311 é da tabela 5.1.1 da UF de DESTINO, e o CFI só cadastra '
            + 'código da UF da empresa: aplicá-lo na apuração do estado errado é pior que não aplicar. Lance no PVA.',
        );
    }

    if (semObrigacao.length) {
        avisos.push(
            `DIFAL EC 87/15: o E316 NÃO saiu para ${semObrigacao.join(', ')} — falta o vencimento e/ou o código `
            + 'de receita daquele tributo. O PVA recusa com "A soma dos campos VL_RECOL_DIFAL, DEB_ESP_DIFAL, '
            + 'VL_RECOL_FCP e DEB_ESP_FCP deve ser igual à soma do campo VL_OR dos Registros filhos E316". '
            + 'Cadastre em SPED Fiscal → Ajustes E111 → "DIFAL EC 87/15 a recolher por UF de destino": o '
            + 'vencimento, o código do DIFAL e, quando há FCP, o código do FCP (na GNRE: 100102/100110 para o '
            + 'DIFAL e 100129/100137 para o FCP, por operação/por apuração). O app não escolhe a forma de recolher.',
        );
    }

    return { linhas, apuracoes, avisos };
}

/**
 * O que o app DIZ quando a competência tem saída interestadual e o DIFAL não
 * aparece em documento nenhum.
 *
 * 🚨 O SILÊNCIO AQUI É O DEFEITO CARO. A captura só passou a ler o grupo
 * `<ICMSUFDest>` em 18/09: toda nota capturada antes disso tem os itens sem o
 * DIFAL, e o arquivo sairia **sem E300/E310/E316**, declarando à SEFAZ que a
 * empresa não deve diferencial nenhum — num arquivo que o PVA ACEITA, porque
 * ausência de registro ele não acusa.
 *
 * A prova de que há algo a declarar é o CFOP: 6107/6108 são justamente "venda
 * de mercadoria a NÃO contribuinte" (e 6102/6403/6910/6949 podem ser, quando o
 * destinatário é consumidor final). O app não deduz o valor — ele DIZ que a
 * releitura resolve.
 */
export function avisoDifalNaoCapturado(notas, ufEmpresa) {
    const UF_EMPRESA = String(ufEmpresa || '').toUpperCase();
    const suspeitas = new Set();

    for (const nota of notas || []) {
        if (direcaoEfetivaDoc(nota) !== 'saida') continue;
        if (modeloDoDoc(nota) !== '55') continue;
        if (docCancelado(nota)) continue;
        if (difalDoDocumento(nota).temDifal) continue;

        const uf = ufDoDestinatarioDoc(nota);
        if (!uf || uf === UF_EMPRESA) continue;

        // CFOP 6107/6108: "Venda de produção do estabelecimento / de mercadoria
        // adquirida de terceiros, destinada a NÃO CONTRIBUINTE" — o CFOP que o
        // próprio painel 🚦 usa como sinal do E310 desde 05/08.
        const temCfopNaoContribuinte = (nota?.itens || [])
            .some((i) => ['6107', '6108'].includes(String(i?.cfop || '').replace(/\D/g, '')));
        if (temCfopNaoContribuinte) suspeitas.add(String(nota?.numero || nota?.chave || '(sem número)'));
    }

    if (suspeitas.size === 0) return null;
    const lista = [...suspeitas];
    return (
        `DIFAL EC 87/15: ${lista.length} nota(s) de saída interestadual a NÃO contribuinte (CFOP 6107/6108) `
        + `NÃO trazem o grupo ICMSUFDest e ficaram fora do C101 e do E300/E310 — nº ${lista.slice(0, 8).join(', ')}`
        + `${lista.length > 8 ? '…' : ''}. O CFI só passou a ler esse grupo em 18/09, então nota capturada antes `
        + 'disso não o tem gravado. Rode Relatórios → ✏️ CFOP por nota → ♻️ Reler itens dos XMLs (o XML guardado '
        + 'tem o dado) e gere de novo. Sem isso o arquivo declara que a empresa não deve diferencial nenhum, e '
        + 'o PVA aceita assim.'
    );
}
