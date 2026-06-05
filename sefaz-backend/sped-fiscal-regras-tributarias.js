// ============================================================================
// sped-fiscal-regras-tributarias.js  (PURO)
//
// Motor de regras TRIBUTARIAS sobre o SPED Fiscal (EFD ICMS/IPI) — o
// equivalente "inteligente" ao validador estrutural (sped-fiscal-editor-
// validador.js, que so olha integridade/PVA). Aqui olhamos COERENCIA fiscal:
// CFOP x direcao, CST validos, NCM, ICMS-ST, etc.
//
// Calibrado contra arquivo REAL (MODELO_SPED_FISCAL, 1189 linhas): as regras
// de VALIDADE (CST/CFOP/NCM) dao ZERO falso-positivo nesse arquivo; as de
// COERENCIA (CFOP x direcao) sao AVISO (devolucao e excecao legitima).
//
// Severidades:
//   'erro'  -> quase certamente errado (CST/CFOP/NCM invalido, item sem 0200)
//   'aviso' -> merece revisao humana (pode ser legitimo: devolucao, etc)
//
// Opera sobre o `parsed` do sped-fiscal-editor-parser. Funciona so pra
// tipoSped='fiscal' (CFOP/CST_ICMS sao do EFD ICMS/IPI).
// ============================================================================

// CST_ICMS valido = origem(1: 0-8) + CST(2). Lista oficial de CST ICMS.
const CST_ICMS_VALIDOS = new Set([
    '00', '10', '20', '30', '40', '41', '50', '51', '60', '70', '90',
]);
const ORIGENS_VALIDAS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8']);

// CSOSN (Simples) — caso a empresa seja do Simples, CST_ICMS vem como CSOSN.
const CSOSN_VALIDOS = new Set([
    '101', '102', '103', '201', '202', '203', '300', '400', '500', '900',
]);

// CST PIS/COFINS validos (Tabela 4.3.3/4.3.4).
const CST_PISCOFINS_VALIDOS = new Set([
    '01', '02', '03', '04', '05', '06', '07', '08', '09',
    '49', '50', '51', '52', '53', '54', '55', '56',
    '60', '61', '62', '63', '64', '65', '66', '67',
    '70', '71', '72', '73', '74', '75', '98', '99',
]);

// Aliquotas ICMS plausiveis (interestaduais + internas comuns). Fora disso = aviso.
const ALIQ_ICMS_PLAUSIVEIS = new Set([0, 4, 7, 12, 17, 18, 19, 20, 22, 25]);

// CFOPs de DEVOLUCAO/RETORNO — direcao "invertida" eh legitima (entram com
// CFOP de saida e vice-versa). Excluidos da regra CFOP x direcao.
function ehCfopDevolucao(cfop) {
    const c = String(cfop || '');
    // Terminacoes .201/.202/.410/.411/.553/.660/.661 e familias de devolucao.
    return /^[123567](41[01]|20[12]|55[34]|66[01]|91[01]|92[012])$/.test(c)
        || /^(1410|1411|2410|2411|5410|5411|6410|6411|1202|2202|5202|6202|1201|5201)$/.test(c);
}

function num(v) {
    if (v == null || v === '') return 0;
    const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

function aliqNum(v) {
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {{ tipoSped:string, linhas: Array<{idx:number,tipo:string,campos:string[]}> }} parsed
 * @returns {{ achados: Array<{regra:string, severidade:'erro'|'aviso', registro:string, idx:number, mensagem:string}>, resumo: {erros:number, avisos:number, porRegra:Record<string,number>} }}
 */
export function aplicarRegrasTributarias(parsed) {
    const achados = [];
    const linhas = (parsed && parsed.linhas) || [];
    if (parsed && parsed.tipoSped && parsed.tipoSped !== 'fiscal') {
        return { achados, resumo: { erros: 0, avisos: 0, porRegra: {}, naoAplicavel: true } };
    }

    // Indexa COD_ITEM dos 0200 (pra checar referencia do C170).
    const itens0200 = new Set();
    for (const l of linhas) {
        if (l.tipo === '0200') itens0200.add(l.campos[1]);
    }

    const add = (regra, severidade, registro, idx, mensagem) =>
        achados.push({ regra, severidade, registro, idx, mensagem });

    // Walk: mantem o IND_OPER do C100 pai corrente pra avaliar o C170.
    let c100IndOper = null; // '0'=entrada, '1'=saida
    let c100NumDoc = null;

    for (const l of linhas) {
        const c = l.campos;
        if (l.tipo === 'C100') {
            c100IndOper = c[1];     // IND_OPER
            c100NumDoc = c[7];      // NUM_DOC
            continue;
        }
        if (l.tipo === '0200') {
            // NCM (campo 7). Vazio = aviso (servico/energia podem nao ter).
            const ncm = String(c[7] || '').replace(/\D/g, '');
            if (ncm && ncm.length !== 8) {
                add('NCM_INVALIDO', 'erro', '0200', l.idx,
                    `Item ${c[1]}: NCM "${c[7]}" nao tem 8 digitos.`);
            }
            continue;
        }
        if (l.tipo === 'C170') {
            const numItem = c[1];
            const codItem = c[2];
            const cstIcms = String(c[9] || '');
            const cfop = String(c[10] || '');
            const vlItem = num(c[6]);
            const vlBcIcms = num(c[12]);
            const aliqIcms = aliqNum(c[13]);
            const vlIcms = num(c[14]);

            // R1: CFOP valido (4 digitos, 1o digito em 1235 67).
            if (!/^[123567]\d{3}$/.test(cfop)) {
                add('CFOP_INVALIDO', 'erro', 'C170', l.idx,
                    `Item ${numItem} (${codItem}): CFOP "${cfop}" invalido.`);
            } else {
                // R2: CFOP x direcao do C100 (excluindo devolucoes).
                const cfopEntrada = /^[123]/.test(cfop);
                const docEntrada = c100IndOper === '0';
                if (!ehCfopDevolucao(cfop) && cfopEntrada !== docEntrada) {
                    add('CFOP_DIRECAO', 'aviso', 'C170', l.idx,
                        `Item ${numItem}: CFOP ${cfop} (${cfopEntrada ? 'entrada' : 'saida'}) diverge do C100 NUM_DOC ${c100NumDoc} (${docEntrada ? 'entrada' : 'saida'}). Devolucao? Verifique.`);
                }
            }

            // R3: CST_ICMS valido (origem+CST, ou CSOSN no Simples).
            if (cstIcms) {
                const origem = cstIcms.charAt(0);
                const cst = cstIcms.slice(1);
                const okNormal = ORIGENS_VALIDAS.has(origem) && CST_ICMS_VALIDOS.has(cst);
                const okSimples = CSOSN_VALIDOS.has(cstIcms);
                if (!okNormal && !okSimples) {
                    add('CST_ICMS_INVALIDO', 'erro', 'C170', l.idx,
                        `Item ${numItem}: CST_ICMS "${cstIcms}" invalido.`);
                }
            }

            // R4: item C170 sem 0200 correspondente (integridade referencial).
            if (codItem && !itens0200.has(codItem)) {
                add('ITEM_SEM_0200', 'erro', 'C170', l.idx,
                    `Item ${numItem}: COD_ITEM "${codItem}" nao existe no cadastro 0200.`);
            }

            // R5: CST 60 (ICMS-ST cobrado antes) mas com VL_ICMS > 0.
            if (cstIcms.slice(1) === '60' && vlIcms > 0.009) {
                add('CST60_COM_ICMS', 'aviso', 'C170', l.idx,
                    `Item ${numItem}: CST 60 (ST cobrado anteriormente) com VL_ICMS=${c[14]} > 0. Esperado 0.`);
            }

            // R6: CST tributada (00/10/90/20) com VL_ITEM>0 mas VL_BC_ICMS=0.
            const cstTrib = ['00', '10', '20', '90'];
            if (cstTrib.includes(cstIcms.slice(1)) && vlItem > 0 && vlBcIcms === 0 && (aliqIcms ?? 0) > 0) {
                add('BC_ICMS_ZERO', 'aviso', 'C170', l.idx,
                    `Item ${numItem}: CST ${cstIcms} com aliquota ${c[13]}% mas VL_BC_ICMS=0 (VL_ITEM=${c[6]}).`);
            }

            // R7: aliquota ICMS implausivel.
            if (aliqIcms != null && aliqIcms > 0 && !ALIQ_ICMS_PLAUSIVEIS.has(aliqIcms)) {
                add('ALIQ_ICMS_INCOMUM', 'aviso', 'C170', l.idx,
                    `Item ${numItem}: aliquota ICMS ${c[13]}% incomum. Confirme.`);
            }
        }
    }

    const resumo = { erros: 0, avisos: 0, porRegra: {} };
    for (const a of achados) {
        if (a.severidade === 'erro') resumo.erros++; else resumo.avisos++;
        resumo.porRegra[a.regra] = (resumo.porRegra[a.regra] || 0) + 1;
    }
    return { achados, resumo };
}
