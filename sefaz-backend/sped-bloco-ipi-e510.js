// ============================================================================
// sped-bloco-ipi-e510.js  (PURO — testável)
// ----------------------------------------------------------------------------
// E510 — Consolidação dos valores do IPI, por CFOP + CST_IPI.
//
// DEFINIÇÃO PROVADA CONTRA ARQUIVO ACEITO (11/08, SPED jun/2026 do e-Fiscal,
// CNPJ ...178 — regra da casa "arquivo aceito > leiaute deduzido"):
//   |E510|CFOP|CST_IPI|VL_CONT_IPI|VL_BC_IPI|VL_IPI|
//   · VL_CONT_IPI = valor da operação (Σ vProd) — **NÃO inclui o IPI**. Bateu
//     campo a campo com o VL_OPR do C190 em TODOS os CFOPs (1101/5101/5122/6101).
//   · VL_BC_IPI   = Σ base do IPI (IPITrib/vBC). 0 para item não-tributado.
//   · VL_IPI      = Σ IPI. A soma dos E510 de saída = VL_DEB do E520 (amarração
//     que a SEFAZ valida; no arquivo real deu 11.742,05 cravado).
//
// O E510 é uma RE-AGREGAÇÃO do MESMO dado do C190, só com chave diferente
// (CFOP+CST_IPI em vez de CST_ICMS+CFOP+alíquota). Por isso reaproveita o CFOP
// de escrituração (convertCfop) e o vProd — não há conta nova.
//
// REGRA DA CASA (campo de valor não recebe default "não sei"): item com IPI
// destacado mas SEM CST capturado (doc antigo, antes da captura do CST) fica
// FORA do E510 e ACENDE aviso — nunca entra com CST chutado. O conserto é o
// backfill que relê o XML, não um default aqui.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';

function num(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

/** CST do IPI é código de 2 dígitos (00,01,05,49,50,52,55,99...). */
function cst2(v) {
    return String(v ?? '').trim().padStart(2, '0').slice(-2);
}

/**
 * Monta as linhas do E510 a partir das notas.
 *
 * @param {Array}  notas
 * @param {object} [deps]
 *   · convertCfop(cfopRaw, direcao, notaDados) → CFOP de escrituração. Default
 *     identidade (pra teste sem a máquina do Bloco C). Em produção recebe o
 *     MESMO convertCfopParaEntrada que o C190 usa — senão os dois divergiriam.
 * @returns {{ linhas: string[], avisos: string[], grupos: Array }}
 */
export function montarLinhasE510(notas, deps = {}) {
    const conv = typeof deps.convertCfop === 'function'
        ? deps.convertCfop
        : (cfop) => cfop;

    const grupos = new Map(); // "CFOP|CST_IPI" -> acumulador
    let itensComIpiSemCst = 0; // IPI destacado sem CST = buraco de captura

    for (const nota of (notas || [])) {
        for (const item of (nota.itens || [])) {
            const temCst = item.cstIpi != null && String(item.cstIpi).trim() !== '';
            const vIpi = num(item.vIPI);
            if (!temCst) {
                // Tem IPI mas o CST não veio: doc capturado antes da captura do
                // CST. NÃO entra no E510 (CST não se chuta) e vira aviso.
                if (vIpi > 0) itensComIpiSemCst += 1;
                continue;
            }
            const cfop = String(conv(item.cfop || item.CFOP || '0000', nota.direcao, nota._dados));
            const cst = cst2(item.cstIpi);
            const key = `${cfop}|${cst}`;
            if (!grupos.has(key)) {
                grupos.set(key, { cfop, cst, vlCont: 0, vlBc: 0, vlIpi: 0 });
            }
            const g = grupos.get(key);
            // VL_CONT_IPI = valor contábil = valor da operação INCLUINDO o IPI.
            // PROVADO contra arquivo aceito (CFOP 1101: C170 ΣvProd 138.396,70 +
            // IPI 4.389,15 = E510 VL_CONT 142.785,85). O IPI é "por fora" e entra
            // no valor contábil do livro (entrada = custo pago; saída = total da
            // nota). Somar só vProd deixava o bloco A MENOR.
            g.vlCont += num(item.vProd ?? item.valor) + vIpi; // VL_CONT_IPI
            g.vlBc += num(item.vBcIpi);                        // VL_BC_IPI (Σ base, provado = C170)
            g.vlIpi += vIpi;                                   // VL_IPI (Σ, amarra com E520)
        }
    }

    // Ordena por CFOP e, dentro do CFOP, por CST — igual ao arquivo real.
    const ordenados = [...grupos.values()].sort((a, b) => (
        a.cfop === b.cfop ? a.cst.localeCompare(b.cst) : a.cfop.localeCompare(b.cfop)
    ));

    const linhas = ordenados.map((g) => fmt.buildLine([
        'E510',
        g.cfop,
        g.cst,
        fmt.formatValue(g.vlCont, 2),
        fmt.formatValue(g.vlBc, 2),
        fmt.formatValue(g.vlIpi, 2),
    ]));

    const avisos = [];
    if (itensComIpiSemCst > 0) {
        avisos.push(
            `E510: ${itensComIpiSemCst} item(ns) com IPI destacado mas SEM CST do IPI capturado `
            + '(documentos importados antes da captura do CST). Eles ficaram FORA do E510 — o bloco '
            + 'pode estar A MENOR. Rode o backfill de IPI para reler os XMLs e preencher o CST.',
        );
    }
    return { linhas, avisos, grupos: ordenados };
}
