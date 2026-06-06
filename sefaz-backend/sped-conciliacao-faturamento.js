// ============================================================================
// sped-conciliacao-faturamento.js  (PURO — sem io/firebase, testavel)
//
// Concilia o faturamento de SAIDA do SPED Fiscal contra o faturamento que o
// contador declarou (e.g. faturamentoManual[YYYY-MM] do Simples).
//
// O SPED Fiscal traz as NF-e de SAIDA no C100 (IND_OPER='1', COD_SIT efetivo).
// O contador declara um total de faturamento mensal (base do DAS). Se o SPED
// soma R$ X em notas de saida mas o contador declarou Y, e X != Y, ha
// discrepancia: ou nota nao declarada (e o DAS foi a menor — risco fiscal),
// ou faturamento declarado a mais (e o DAS foi a maior — perda financeira).
//
// HONESTIDADE: notas canceladas (COD_SIT 02), denegadas (03), inutilizadas
// (05) ficam de fora. NFS-e (servico, A100) NAO entra por enquanto — depende
// do regime/anexo e ja temos modulo proprio (analiseRetencoesNfseSP).
// ============================================================================

// Posicoes no C100 (campos[0]='C100').
const C100 = { IND_OPER: 1, COD_SIT: 5, NUM_DOC: 7, CHV_NFE: 8, VL_DOC: 11 };
const COD_SIT_EFETIVO = new Set(['00', '01', '06', '07', '08']);

function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Soma as NF-e de SAIDA efetivas do SPED.
 * @returns {{ totalSaida:number, totalEntrada:number, qtdSaida:number,
 *             qtdEntrada:number, ignorados:number, notas:Array }}
 */
function consolidarFaturamentoSped(parsed) {
    if (!parsed || parsed.tipoSped !== 'fiscal') {
        return { aplicavel: false, motivo: 'Conciliacao exige SPED Fiscal (EFD ICMS/IPI).' };
    }
    let totalSaida = 0, totalEntrada = 0, qtdSaida = 0, qtdEntrada = 0, ignorados = 0;
    const notas = [];
    for (const l of (parsed.linhas || [])) {
        if (l.tipo !== 'C100') continue;
        const c = l.campos;
        const codSit = String(c[C100.COD_SIT] || '').padStart(2, '0');
        if (!COD_SIT_EFETIVO.has(codSit)) { ignorados++; continue; }
        const vl = num(c[C100.VL_DOC]);
        const isSaida = String(c[C100.IND_OPER] || '') === '1';
        const nota = {
            chave: String(c[C100.CHV_NFE] || '').replace(/\D/g, ''),
            numDoc: c[C100.NUM_DOC] || '', vlDoc: vl, direcao: isSaida ? 'saida' : 'entrada',
        };
        notas.push(nota);
        if (isSaida) { totalSaida += vl; qtdSaida++; }
        else { totalEntrada += vl; qtdEntrada++; }
    }
    return {
        aplicavel: true,
        totalSaida: round2(totalSaida),
        totalEntrada: round2(totalEntrada),
        qtdSaida, qtdEntrada, ignorados, notas,
    };
}

/**
 * Compara faturamento SAIDA do SPED contra faturamento declarado pelo contador.
 *
 * @param {object} parsedSped              resultado do parseSpedFiscalParaEdicao
 * @param {number} faturamentoDeclarado    valor que o contador informou (DAS base)
 * @param {object} [opts]
 * @param {number} [opts.toleranciaCentavos=0.02]
 * @param {number} [opts.toleranciaPctAviso=1]    % entre tol e isso = aviso
 * @returns {{
 *   aplicavel: boolean, motivo?: string,
 *   totalSpedSaida: number,
 *   faturamentoDeclarado: number,
 *   diferenca: number,
 *   diferencaPct: number,
 *   severidade: 'ok'|'aviso'|'erro',
 *   sentido: 'sped-maior'|'declarado-maior'|'ok',
 *   resumoSped: object
 * }}
 */
export function conciliarFaturamento(parsedSped, faturamentoDeclarado, opts = {}) {
    const tol = opts.toleranciaCentavos ?? 0.02;
    const tolPctAviso = opts.toleranciaPctAviso ?? 1;
    const c = consolidarFaturamentoSped(parsedSped);
    if (!c.aplicavel) return { aplicavel: false, motivo: c.motivo };

    const decl = num(faturamentoDeclarado);
    const diff = round2(c.totalSaida - decl);
    const base = Math.max(c.totalSaida, decl);
    const diffPct = base === 0 ? 0 : round2((diff / base) * 100);

    let severidade, sentido;
    if (Math.abs(diff) <= tol) {
        severidade = 'ok';
        sentido = 'ok';
    } else {
        sentido = diff > 0 ? 'sped-maior' : 'declarado-maior';
        // sped-maior = NF-e de saida acima do declarado (DAS a menor = risco alto)
        // declarado-maior = declarado mais que NF-e (DAS pago a mais = perda mas nao malha)
        if (sentido === 'sped-maior') {
            severidade = Math.abs(diffPct) > tolPctAviso ? 'erro' : 'aviso';
        } else {
            severidade = 'aviso'; // sempre aviso (perda, nao risco fiscal)
        }
    }
    return {
        aplicavel: true,
        totalSpedSaida: c.totalSaida,
        faturamentoDeclarado: decl,
        diferenca: diff,
        diferencaPct: diffPct,
        severidade,
        sentido,
        resumoSped: {
            qtdSaida: c.qtdSaida, qtdEntrada: c.qtdEntrada,
            totalEntrada: c.totalEntrada, ignorados: c.ignorados,
        },
    };
}

export const _internals = { consolidarFaturamentoSped, num };
