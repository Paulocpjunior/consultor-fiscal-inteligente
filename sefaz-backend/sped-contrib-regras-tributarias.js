// ============================================================================
// sped-contrib-regras-tributarias.js  (PURO)
//
// Motor de regras TRIBUTARIAS sobre o SPED Contribuicoes (EFD PIS/COFINS).
// Equivalente ao sped-fiscal-regras-tributarias.js, mas pra PIS/COFINS:
// CST PIS/COFINS validos, BC vs aliquota vs valor, aliquotas incomuns,
// coerencia CST_PIS == CST_COFINS na mesma linha.
//
// Severidades:
//   'erro'  -> CST nao existe (4.3.3/4.3.4) ou CFOP invalido
//   'aviso' -> coerencia (ex: CST nao-tributavel com VL_PIS > 0,
//              aliquota incomum, CST_PIS != CST_COFINS)
//
// So roda quando tipoSped='contribuicoes'. Posicoes no campos[] (1-based no
// SPED, e campos[0]=tipo): CST_PIS=24, VL_BC_PIS=25, ALIQ_PIS=26, VL_PIS=29,
// CST_COFINS=30, VL_BC_COFINS=31, ALIQ_COFINS=32, VL_COFINS=35, CFOP=10.
//
// CST PIS/COFINS oficiais (Tabelas 4.3.3 / 4.3.4 — sao identicas):
//   Saida tributada:        01, 02, 03, 49
//   Saida sem onus:         04 (monofasica), 05 (subst trib), 06 (aliq zero),
//                           07 (isenta), 08 (sem incidencia), 09 (suspensao)
//   Entrada com credito:    50, 51, 52, 53, 54, 55, 56, 60, 61, 62, 63, 64,
//                           65, 66, 67, 70, 71, 72, 73, 74, 75
//   Outras:                 98, 99
// ============================================================================

const CST_PIS_COFINS_VALIDOS = new Set([
    '01', '02', '03', '04', '05', '06', '07', '08', '09', '49',
    '50', '51', '52', '53', '54', '55', '56',
    '60', '61', '62', '63', '64', '65', '66', '67',
    '70', '71', '72', '73', '74', '75',
    '98', '99',
]);

// ════════════════════════════════════════════════════════════════════════════
// 🚨 O CST TEM LADO — e o comentário acima já dizia isso sem nada travar.
//
// Os códigos 01-09 e 49 descrevem a RECEITA (a operação de quem vende); os
// 50-75 descrevem o CRÉDITO da AQUISIÇÃO (a operação de quem compra). Um não
// serve no lugar do outro, e o PVA recusa.
//
// 🚨 **CASO REAL**: a PWR saiu com **CST `01` numa ENTRADA** (20/08) — código
// que nem existe na tabela das aquisições. O gerador foi corrigido no dia (a
// entrada passou a usar 50 no não-cumulativo e 70 no cumulativo), mas a
// CLASSE ficou aberta: a separação por direção estava escrita no comentário
// deste arquivo e **nunca virou regra**. É o vício de 13/08 — *regra escrita
// não é regra travada* —, a três linhas de distância.
//
// ⚠️ **98 e 99 ("Outras Operações") valem nos DOIS lados**, de propósito: é o
// que a tabela diz, e acusá-los seria alarme sobre código legítimo.
//
// ⚠️ E quem dá a direção é o **CFOP da própria linha** (1/2/3 entrada · 5/6/7
// saída), que este módulo já lê — não uma leitura nova do documento, que
// divergiria da que gerou o arquivo.
// ════════════════════════════════════════════════════════════════════════════
const CST_DE_SAIDA = new Set(['01', '02', '03', '04', '05', '06', '07', '08', '09', '49']);
const CST_DE_ENTRADA = new Set([
    '50', '51', '52', '53', '54', '55', '56',
    '60', '61', '62', '63', '64', '65', '66', '67',
    '70', '71', '72', '73', '74', '75',
]);

// CST com tributacao efetiva — espera VL_PIS/VL_COFINS > 0 (em principio).
const CST_TRIBUTADO = new Set(['01', '02', '03', '49', '50', '51', '52', '53', '54', '55', '56', '98']);
// CST sem onus tributario — espera VL_PIS/VL_COFINS == 0.
const CST_SEM_ONUS = new Set(['04', '05', '06', '07', '08', '09']);

// CFOP valido = comeca com 1/2/3 (entrada) ou 5/6/7 (saida), 4 digitos.
const CFOP_REGEX = /^[123567]\d{3}$/;

// Aliquotas usuais (Lei 10.637/2002 e Lei 10.833/2003).
const ALIQ_PIS_USUAIS = new Set([0.65, 1.65, 0]);
const ALIQ_COFINS_USUAIS = new Set([3, 7.6, 0]);

function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

// Aproximacao com tolerancia pra comparar aliquotas (input pode ter ',65').
function aliqAprox(set, v, tol = 0.05) {
    for (const x of set) if (Math.abs(x - v) <= tol) return true;
    return false;
}

const C170 = {
    NUM_ITEM: 1, COD_ITEM: 2, CFOP: 10,
    CST_PIS: 24, VL_BC_PIS: 25, ALIQ_PIS: 26, VL_PIS: 29,
    CST_COFINS: 30, VL_BC_COFINS: 31, ALIQ_COFINS: 32, VL_COFINS: 35,
};

// ── A170 e A100 (bloco A — serviços) ────────────────────────────────────────
//
// 📌 EM 22/08 O A170 FICOU DE FORA, E O MOTIVO ESCRITO ERA: *"a contagem dele
// não está em CAMPOS_POR_REGISTRO, e conferir posição deduzida é alarme
// falso"*. Esse motivo CADUCOU em 29/08, quando o Guia 1.35 foi extraído: o
// A170 sai com **18 campos, sem buraco e com os NOMES**, e o A100 com 21 —
// ou seja as posições abaixo são LIDAS da fonte oficial, não deduzidas do
// vizinho (que é o erro do `DT_FIN`, 22/08).
//
// ⚠️ E O A170 NÃO TEM CFOP — quem diz a direção é o **IND_OPER do A100 PAI**
// (0 = aquisição · 1 = prestação). Por isso o pareamento é o mesmo do
// C100 × C190 (R21) e do D100 × D190: o filho pertence ao pai que o
// ANTECEDE. Ler "o primeiro A100 do arquivo" fecharia num arquivo de um
// documento só e mentiria em todos os outros.
const A170 = { CST_PIS: 8, CST_COFINS: 12 };
const A100 = { IND_OPER: 1 };
/** IND_OPER do A100: 0 = aquisição (entrada) · 1 = prestação (saída). */
const IND_OPER_AQUISICAO = '0';

/**
 * O CST descreve um LADO da operação — acusa quando ele está no lado errado.
 *
 * Vale para C170 e A170 com a MESMA régua: o que muda entre os dois é de ONDE
 * vem a direção (CFOP da linha × IND_OPER do A100 pai), nunca o julgamento.
 * Duas cópias divergiriam no primeiro código novo da tabela.
 */
function conferirCstDaDirecao({ add, registro, idx, entrada, saida, origemDaDirecao, csts }) {
    for (const [nome, cst] of csts) {
        // Código inválido já foi acusado como tal — dizer "lado errado" sobre
        // um código que não existe manda procurar o erro no lugar errado.
        if (!cst || !CST_PIS_COFINS_VALIDOS.has(cst)) continue;
        if (entrada && CST_DE_SAIDA.has(cst)) {
            add('CST_DA_DIRECAO_ERRADA', 'erro', registro, idx,
                `${nome} ${cst} descreve a RECEITA e a linha e de ENTRADA (${origemDaDirecao}). `
                + 'Na aquisicao o codigo vem da Tabela 4.3.7 (50-56 com credito, 70-75 sem). '
                + 'Foi o defeito da PWR em 20/08: o CST do XML e o do FORNECEDOR.');
        }
        if (saida && CST_DE_ENTRADA.has(cst)) {
            add('CST_DA_DIRECAO_ERRADA', 'erro', registro, idx,
                `${nome} ${cst} descreve o CREDITO DA AQUISICAO e a linha e de SAIDA `
                + `(${origemDaDirecao}). Na receita o codigo vem da faixa 01-09/49.`);
        }
    }
}

/**
 * @param {object} parsed   resultado do parseSpedFiscalParaEdicao
 * @returns {{
 *   achados: Array<{ regra:string, severidade:'erro'|'aviso', registro:string,
 *                    idx:number, mensagem:string }>,
 *   resumo: { erros:number, avisos:number, porRegra: Record<string,number>,
 *             naoAplicavel?: boolean }
 * }}
 */
export function aplicarRegrasContribuicoes(parsed) {
    if (!parsed || parsed.tipoSped !== 'contribuicoes') {
        return {
            achados: [],
            resumo: { erros: 0, avisos: 0, porRegra: {}, naoAplicavel: true },
        };
    }
    const achados = [];
    const add = (regra, severidade, registro, idx, mensagem) =>
        achados.push({ regra, severidade, registro, idx, mensagem });

    // O A170 herda a direção do A100 que o ANTECEDE (ver o comentário do mapa
    // A170/A100 acima). `A990` fecha o bloco: filho depois dele é órfão, e
    // carregar o pai para além do bloco julgaria a linha pelo documento errado.
    let indOperDoA100Pai = null;

    for (const l of (parsed.linhas || [])) {
        if (l.tipo === 'A100') {
            indOperDoA100Pai = String((l.campos || [])[A100.IND_OPER] ?? '').trim();
            continue;
        }
        if (l.tipo === 'A990' || l.tipo === 'A001') { indOperDoA100Pai = null; continue; }
        if (l.tipo === 'A170') {
            const a = l.campos || [];
            // ⚠️ Sem pai legível não se afirma o lado: acusar aqui seria alarme
            // sobre arquivo cuja direção o app não leu (a régua da ausência).
            if (indOperDoA100Pai === IND_OPER_AQUISICAO || indOperDoA100Pai === '1') {
                const entrada = indOperDoA100Pai === IND_OPER_AQUISICAO;
                conferirCstDaDirecao({
                    add,
                    registro: 'A170',
                    idx: l.idx,
                    entrada,
                    saida: !entrada,
                    origemDaDirecao: `IND_OPER ${indOperDoA100Pai} do A100`,
                    csts: [
                        ['CST_PIS', String(a[A170.CST_PIS] || '').padStart(2, '0')],
                        ['CST_COFINS', String(a[A170.CST_COFINS] || '').padStart(2, '0')],
                    ],
                });
            }
            continue;
        }
        if (l.tipo !== 'C170') continue;
        const c = l.campos;
        const cstPis = String(c[C170.CST_PIS] || '').padStart(2, '0');
        const cstCofins = String(c[C170.CST_COFINS] || '').padStart(2, '0');
        const cfop = String(c[C170.CFOP] || '').padStart(4, '0');
        const vlPis = num(c[C170.VL_PIS]);
        const vlCofins = num(c[C170.VL_COFINS]);
        const bcPis = num(c[C170.VL_BC_PIS]);
        const bcCofins = num(c[C170.VL_BC_COFINS]);
        const aliqPis = num(c[C170.ALIQ_PIS]);
        const aliqCofins = num(c[C170.ALIQ_COFINS]);

        // ── ERROS de validade ──
        if (cstPis && !CST_PIS_COFINS_VALIDOS.has(cstPis)) {
            add('CST_PIS_INVALIDO', 'erro', 'C170', l.idx,
                `CST_PIS "${cstPis}" nao existe na Tabela 4.3.3.`);
        }
        if (cstCofins && !CST_PIS_COFINS_VALIDOS.has(cstCofins)) {
            add('CST_COFINS_INVALIDO', 'erro', 'C170', l.idx,
                `CST_COFINS "${cstCofins}" nao existe na Tabela 4.3.4.`);
        }
        if (cfop && !CFOP_REGEX.test(cfop)) {
            add('CFOP_INVALIDO', 'erro', 'C170', l.idx,
                `CFOP "${cfop}" invalido.`);
        }

        // ── O CST bate com a DIREÇÃO da operação? ──
        //
        // Caso real: a PWR saiu com CST 01 (receita) numa ENTRADA. O código
        // existe na tabela, então a validade acima fica MUDA — quem pega é o
        // lado. No C170 a direção sai do CFOP da PRÓPRIA linha.
        conferirCstDaDirecao({
            add,
            registro: 'C170',
            idx: l.idx,
            entrada: /^[123]/.test(cfop),
            saida: /^[567]/.test(cfop),
            origemDaDirecao: `CFOP ${cfop}`,
            csts: [['CST_PIS', cstPis], ['CST_COFINS', cstCofins]],
        });

        // ── AVISOS de coerencia ──

        // CST nao-tributavel (04/05/06/07/08/09) com VL_PIS/COFINS > 0 -> coerencia
        if (CST_SEM_ONUS.has(cstPis) && vlPis > 0) {
            add('CST_PIS_NAO_TRIBUTAVEL_COM_VALOR', 'aviso', 'C170', l.idx,
                `CST_PIS ${cstPis} (sem onus) com VL_PIS ${vlPis.toFixed(2)} > 0.`);
        }
        if (CST_SEM_ONUS.has(cstCofins) && vlCofins > 0) {
            add('CST_COFINS_NAO_TRIBUTAVEL_COM_VALOR', 'aviso', 'C170', l.idx,
                `CST_COFINS ${cstCofins} (sem onus) com VL_COFINS ${vlCofins.toFixed(2)} > 0.`);
        }

        // CST tributado com BC zero e aliquota > 0 -> BC esquecida
        if (CST_TRIBUTADO.has(cstPis) && bcPis === 0 && aliqPis > 0) {
            add('BC_PIS_ZERO_COM_ALIQ', 'aviso', 'C170', l.idx,
                `CST_PIS ${cstPis} com aliquota ${aliqPis}% mas VL_BC_PIS = 0.`);
        }
        if (CST_TRIBUTADO.has(cstCofins) && bcCofins === 0 && aliqCofins > 0) {
            add('BC_COFINS_ZERO_COM_ALIQ', 'aviso', 'C170', l.idx,
                `CST_COFINS ${cstCofins} com aliquota ${aliqCofins}% mas VL_BC_COFINS = 0.`);
        }

        // Aliquota incomum (so olha quando o CST e tributavel — evita aviso de aliq=0 em CST 06)
        if (CST_TRIBUTADO.has(cstPis) && aliqPis > 0 && !aliqAprox(ALIQ_PIS_USUAIS, aliqPis)) {
            add('ALIQ_PIS_INCOMUM', 'aviso', 'C170', l.idx,
                `Aliquota PIS ${aliqPis}% fora das usuais (0,65 cumulativo / 1,65 nao-cumul).`);
        }
        if (CST_TRIBUTADO.has(cstCofins) && aliqCofins > 0 && !aliqAprox(ALIQ_COFINS_USUAIS, aliqCofins)) {
            add('ALIQ_COFINS_INCOMUM', 'aviso', 'C170', l.idx,
                `Aliquota COFINS ${aliqCofins}% fora das usuais (3 cumulativo / 7,6 nao-cumul).`);
        }

        // CST_PIS != CST_COFINS — na mesma operacao, normalmente igual (legitimo
        // diferir so em casos raros como crédito presumido). Aviso de revisao.
        if (cstPis && cstCofins && cstPis !== cstCofins) {
            add('CST_PIS_COFINS_DIVERGENTE', 'aviso', 'C170', l.idx,
                `CST_PIS ${cstPis} != CST_COFINS ${cstCofins} — incomum na mesma operacao.`);
        }
    }

    // R9: M210 (PIS) e M610 (COFINS) — BC do totalizador vs soma C170 por CST.
    // Conservador: BC totalizador MENOR que soma C170 da mesma CST -> erro
    // (faltou item). BC MAIOR -> aviso (pode ter A170/F100 servico/financeira).
    verificarTotalizadoresContrib(parsed.linhas || [], achados);

    const resumo = sumarizar(achados);
    return { achados, resumo };
}

function verificarTotalizadoresContrib(linhas, achados) {
    const TOL = 0.02;
    const add = (regra, severidade, registro, idx, mensagem) =>
        achados.push({ regra, severidade, registro, idx, mensagem });

    // 1) Soma C170 por CST_PIS e por CST_COFINS.
    const bcPisPorCst = new Map();    // cst -> { bc, vl, count }
    const bcCofinsPorCst = new Map();
    for (const l of linhas) {
        if (l.tipo !== 'C170') continue;
        const c = l.campos;
        const cstPis = String(c[C170.CST_PIS] || '').padStart(2, '0');
        const cstCofins = String(c[C170.CST_COFINS] || '').padStart(2, '0');
        if (cstPis) {
            const acc = bcPisPorCst.get(cstPis) || { bc: 0, vl: 0, count: 0 };
            acc.bc += num(c[C170.VL_BC_PIS]);
            acc.vl += num(c[C170.VL_PIS]);
            acc.count++;
            bcPisPorCst.set(cstPis, acc);
        }
        if (cstCofins) {
            const acc = bcCofinsPorCst.get(cstCofins) || { bc: 0, vl: 0, count: 0 };
            acc.bc += num(c[C170.VL_BC_COFINS]);
            acc.vl += num(c[C170.VL_COFINS]);
            acc.count++;
            bcCofinsPorCst.set(cstCofins, acc);
        }
    }

    // 2) M210 e M610 por CST.
    const m210PorCst = new Map();  // cst -> { idx, vlBcCont, vlContApur }
    const m610PorCst = new Map();
    for (const l of linhas) {
        const c = l.campos;
        if (l.tipo === 'M210') {
            const cst = String(c[1] || '').padStart(2, '0');
            m210PorCst.set(cst, { idx: l.idx, vlBcCont: num(c[3]), vlContApur: num(c[10]) });
        } else if (l.tipo === 'M610') {
            const cst = String(c[1] || '').padStart(2, '0');
            m610PorCst.set(cst, { idx: l.idx, vlBcCont: num(c[3]), vlContApur: num(c[10]) });
        }
    }

    // 3) Reconciliacao PIS.
    for (const [cst, soma] of bcPisPorCst) {
        if (soma.bc <= TOL) continue; // CST sem BC nao gera totalizador (CST 04/06/07/...)
        const m = m210PorCst.get(cst);
        if (!m) {
            add('M210_FALTANTE', 'erro', 'M210', null,
                `CST_PIS ${cst} aparece em ${soma.count} C170 (BC soma ${soma.bc.toFixed(2)}) mas sem M210 totalizador.`);
            continue;
        }
        const dif = m.vlBcCont - soma.bc;
        if (dif < -TOL) {
            add('M210_BC_MENOR_QUE_C170', 'erro', 'M210', m.idx,
                `CST_PIS ${cst}: M210 VL_BC_CONT=${m.vlBcCont.toFixed(2)} MENOR que soma C170 VL_BC_PIS=${soma.bc.toFixed(2)} (faltam itens no totalizador).`);
        } else if (dif > TOL) {
            add('M210_BC_MAIOR_QUE_C170', 'aviso', 'M210', m.idx,
                `CST_PIS ${cst}: M210 VL_BC_CONT=${m.vlBcCont.toFixed(2)} MAIOR que soma C170 VL_BC_PIS=${soma.bc.toFixed(2)}. Confere se ha A170/F100.`);
        }
    }

    // 4) Reconciliacao COFINS.
    for (const [cst, soma] of bcCofinsPorCst) {
        if (soma.bc <= TOL) continue;
        const m = m610PorCst.get(cst);
        if (!m) {
            add('M610_FALTANTE', 'erro', 'M610', null,
                `CST_COFINS ${cst} aparece em ${soma.count} C170 (BC soma ${soma.bc.toFixed(2)}) mas sem M610 totalizador.`);
            continue;
        }
        const dif = m.vlBcCont - soma.bc;
        if (dif < -TOL) {
            add('M610_BC_MENOR_QUE_C170', 'erro', 'M610', m.idx,
                `CST_COFINS ${cst}: M610 VL_BC_CONT=${m.vlBcCont.toFixed(2)} MENOR que soma C170 VL_BC_COFINS=${soma.bc.toFixed(2)} (faltam itens).`);
        } else if (dif > TOL) {
            add('M610_BC_MAIOR_QUE_C170', 'aviso', 'M610', m.idx,
                `CST_COFINS ${cst}: M610 VL_BC_CONT=${m.vlBcCont.toFixed(2)} MAIOR que soma C170 VL_BC_COFINS=${soma.bc.toFixed(2)}. Confere se ha A170/F100.`);
        }
    }
}

function sumarizar(achados) {
    const out = { erros: 0, avisos: 0, porRegra: {} };
    for (const a of achados) {
        if (a.severidade === 'erro') out.erros++;
        else out.avisos++;
        out.porRegra[a.regra] = (out.porRegra[a.regra] || 0) + 1;
    }
    return out;
}

export const _internals = { CST_PIS_COFINS_VALIDOS, CST_TRIBUTADO, CST_SEM_ONUS, CST_DE_SAIDA, CST_DE_ENTRADA };
