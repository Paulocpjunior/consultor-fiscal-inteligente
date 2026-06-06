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

    for (const l of (parsed.linhas || [])) {
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

    const resumo = sumarizar(achados);
    return { achados, resumo };
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

export const _internals = { CST_PIS_COFINS_VALIDOS, CST_TRIBUTADO, CST_SEM_ONUS };
