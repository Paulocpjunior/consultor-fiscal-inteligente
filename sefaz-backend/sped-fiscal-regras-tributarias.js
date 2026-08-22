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
// O VL_OPR do C190 tem DONO — ele não é a soma dos VL_ITEM (Guia 3.2.3, C190
// campo 05). Esta regra exigia a igualdade e passou a acusar o arquivo certo
// depois da correção do gerador (PWR, 20/08).
import { pisoDoValorOperacaoDoC170, acessoriasDoC100, faixaDoValorOperacao } from './valor-operacao-c190.js';

const CST_ICMS_VALIDOS = new Set([
    '00', '10', '20', '30', '40', '41', '50', '51', '60', '70', '90',
]);
const ORIGENS_VALIDAS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8']);

// CSOSN (Simples) — caso a empresa seja do Simples, CST_ICMS vem como CSOSN.
const CSOSN_VALIDOS = new Set([
    '101', '102', '103', '201', '202', '203', '300', '400', '500', '900',
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

    // R8: C190 totalizador x soma dos C170 por (CST_ICMS, CFOP, ALIQ_ICMS).
    // E o erro que mais aparece em SPED editado a mao: contador muda VL_ITEM
    // de um C170 mas esquece de regerar o C190. PVA rejeita transmissao.
    verificarTotalizadoresC190(linhas, add);

    const resumo = { erros: 0, avisos: 0, porRegra: {} };
    for (const a of achados) {
        if (a.severidade === 'erro') resumo.erros++; else resumo.avisos++;
        resumo.porRegra[a.regra] = (resumo.porRegra[a.regra] || 0) + 1;
    }
    return { achados, resumo };
}

// ─── R8: C190 totalizador x C170 (por documento) ───────────────────────────
// Layout C190 (1-based no SPED, campos[N]):
//   1=CST_ICMS, 2=CFOP, 3=ALIQ_ICMS, 4=VL_OPR, 5=VL_BC_ICMS, 6=VL_ICMS
// O C190 agrupa as linhas C170 do MESMO documento (mesmo C100 pai) por
// (CST_ICMS, CFOP, ALIQ_ICMS). Cada combinacao deve ter UM C190; e a soma
// dos C170 daquela combinacao tem que bater VL_OPR/VL_BC/VL_ICMS do C190.
function verificarTotalizadoresC190(linhas, add) {
    const TOL = 0.02; // 2 centavos: tolera arredondamento natural do SPED.
    let docIdx = null;
    let docNum = null;
    let c170Por = null;  // Map<chaveCombinacao, { vlOpr, vlBc, vlIcms, count }>
    let c190Por = null;  // Map<chaveCombinacao, { idx, vlOpr, vlBc, vlIcms, count }>
    // Frete/seguro/outras despesas do C100 pai: entram no VL_OPR mas NÃO
    // existem no C170, então lendo só o arquivo o derivado é um piso.
    let acessoriasDoDoc = 0;

    const flush = () => {
        if (!c170Por || !c190Por) return;
        // Combinacoes que existem nos C170 mas faltam no C190 (totalizador esquecido).
        for (const [k, t170] of c170Por) {
            const t190 = c190Por.get(k);
            if (!t190) {
                add('C190_FALTANTE', 'erro', 'C190', docIdx,
                    `Doc ${docNum}: combinacao ${k} aparece em ${t170.count} C170 mas nao tem C190 totalizador.`);
                continue;
            }
            // 🚨 VL_OPR NÃO É A SOMA DOS VL_ITEM (Guia 3.2.3, C190 campo 05):
            // ele inclui ICMS-ST, FCP-ST e o IPI destacado, menos o desconto
            // incondicional — e ainda frete/seguro/outras, que só existem no
            // C100. Esta regra exigia a igualdade com Σ VL_ITEM e, depois da
            // correção do gerador (PWR, 20/08), acusaria o arquivo CERTO.
            // O que o arquivo prova é uma FAIXA; quem a calcula é o dono.
            const faixa = faixaDoValorOperacao(t170.vlOpr, acessoriasDoDoc);
            if (t190.vlOpr < faixa.piso - TOL || t190.vlOpr > faixa.teto + TOL) {
                const esperado = faixa.exato
                    ? `esperado ${faixa.piso.toFixed(2)}`
                    : `esperado entre ${faixa.piso.toFixed(2)} e ${faixa.teto.toFixed(2)} (frete/seguro/outras despesas do C100)`;
                add('C190_VL_OPR_DIVERGE', 'erro', 'C190', t190.idx,
                    `Doc ${docNum} ${k}: C190 VL_OPR=${t190.vlOpr.toFixed(2)}, ${esperado}. `
                    + 'VL_OPR = VL_ITEM - VL_DESC + ICMS-ST + IPI destacado + despesas acessorias '
                    + '(Guia Pratico 3.2.3, C190 campo 05) — nao e a soma dos VL_ITEM.');
            }
            if (Math.abs(t190.vlBc - t170.vlBc) > TOL) {
                add('C190_VL_BC_DIVERGE', 'erro', 'C190', t190.idx,
                    `Doc ${docNum} ${k}: C190 VL_BC_ICMS=${t190.vlBc.toFixed(2)} != soma C170 VL_BC_ICMS=${t170.vlBc.toFixed(2)}.`);
            }
            if (Math.abs(t190.vlIcms - t170.vlIcms) > TOL) {
                add('C190_VL_ICMS_DIVERGE', 'erro', 'C190', t190.idx,
                    `Doc ${docNum} ${k}: C190 VL_ICMS=${t190.vlIcms.toFixed(2)} != soma C170 VL_ICMS=${t170.vlIcms.toFixed(2)}.`);
            }
            if (t190.count > 1) {
                add('C190_DUPLICADO', 'aviso', 'C190', t190.idx,
                    `Doc ${docNum} ${k}: ${t190.count} C190 com a mesma combinacao (deveria ser 1).`);
            }
        }
        // C190 sem C170 correspondente.
        for (const [k, t190] of c190Por) {
            if (!c170Por.has(k)) {
                add('C190_SEM_C170', 'erro', 'C190', t190.idx,
                    `Doc ${docNum}: C190 ${k} sem nenhum C170 correspondente.`);
            }
        }
    };

    for (const l of linhas) {
        if (l.tipo === 'C100') {
            flush();
            docIdx = l.idx;
            docNum = l.campos[7] || '?';
            acessoriasDoDoc = acessoriasDoC100(l.campos);
            c170Por = new Map();
            c190Por = new Map();
            continue;
        }
        if (l.tipo === 'C170' && c170Por) {
            const c = l.campos;
            const cst = String(c[9] || '');
            const cfop = String(c[10] || '');
            const aliq = aliqNum(c[13]);
            const key = `${cst}|${cfop}|${aliq != null ? aliq.toFixed(2) : '0.00'}`;
            const acc = c170Por.get(key) || { vlOpr: 0, vlBc: 0, vlIcms: 0, count: 0 };
            // PISO do VL_OPR — VL_ITEM − VL_DESC + ICMS-ST + IPI. Régua única.
            acc.vlOpr += pisoDoValorOperacaoDoC170(c);
            acc.vlBc += num(c[12]);   // VL_BC_ICMS
            acc.vlIcms += num(c[14]); // VL_ICMS
            acc.count++;
            c170Por.set(key, acc);
            continue;
        }
        if (l.tipo === 'C190' && c190Por) {
            const c = l.campos;
            const cst = String(c[1] || '');
            const cfop = String(c[2] || '');
            const aliq = aliqNum(c[3]);
            const key = `${cst}|${cfop}|${aliq != null ? aliq.toFixed(2) : '0.00'}`;
            const prev = c190Por.get(key);
            // C190 e supostamente UNICO por combinacao no doc. Acumula pra detectar
            // duplicidade, mas usa os valores do PRIMEIRO pra comparar (PVA olha cada
            // declaracao isoladamente).
            if (prev) {
                prev.count++;
            } else {
                c190Por.set(key, {
                    idx: l.idx, count: 1,
                    vlOpr: num(c[4]), vlBc: num(c[5]), vlIcms: num(c[6]),
                });
            }
            continue;
        }
    }
    flush();
}
