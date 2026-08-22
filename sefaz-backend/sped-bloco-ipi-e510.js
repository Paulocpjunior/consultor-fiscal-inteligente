// ============================================================================
// sped-bloco-ipi-e510.js  (PURO — testável)
// ----------------------------------------------------------------------------
// E510 — Consolidação dos valores do IPI, por CFOP + CST_IPI.
//
// DEFINIÇÃO PROVADA CONTRA ARQUIVO ACEITO (11/08, SPED jun/2026 do e-Fiscal,
// CNPJ ...178 — regra da casa "arquivo aceito > leiaute deduzido"):
//   |E510|CFOP|CST_IPI|VL_CONT_IPI|VL_BC_IPI|VL_IPI|
//   · VL_CONT_IPI = valor CONTÁBIL da operação = Σ(vProd + vIPI) — **INCLUI o
//     IPI** (o IPI é "por fora" e compõe o valor contábil do livro). PROVADO
//     campo a campo contra o C170 do arquivo aceito (CFOP 1101: ΣvProd
//     138.396,70 + IPI 4.389,15 = VL_CONT 142.785,85). Somar só vProd deixava
//     o bloco A MENOR — o PVA NÃO checa VL_CONT, então o erro passaria.
//   · VL_BC_IPI   = Σ base do IPI (IPITrib/vBC). 0 para item não-tributado.
//   · VL_IPI      = Σ IPI. A soma dos E510 de saída = VL_DEB do E520 (amarração
//     que a SEFAZ valida; no arquivo real deu 11.742,05 cravado — e o gerador
//     reproduziu 11.742,05 a partir SÓ dos XMLs de saída de jun/2026).
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
import { direcaoEfetivaDoc } from './xml-metadata-helper.js';

function num(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

/** CST do IPI é código de 2 dígitos (00,01,05,49,50,52,55,99...). */
function cst2(v) {
    return String(v ?? '').trim().padStart(2, '0').slice(-2);
}

// ── CST-IPI de ESCRITURAÇÃO: saída → entrada ────────────────────────────────
// PROVADO contra 4 XMLs-fonte × E510 aceito (11/08, cliente EXPERTE):
//   · ACOS emite CST 50 (saída tributada) → EXPERTE escritura 00 (entrada c/ crédito)
//   · GALVANIZAÇÃO emite CST 55 (saída suspensão) → EXPERTE escritura 05 (entrada suspensão)
//   · fornecedor emite 99 (outras saídas) → EXPERTE escritura 49 (outras entradas)
// A regra é a correspondência OFICIAL da IN RFB 932/2009: o dígito da UNIDADE
// casa (5x ↔ 0x; 99 ↔ 49). Na compra, a nota do fornecedor é SAÍDA dele e vira
// ENTRADA do destinatário — o CST-IPI acompanha, igual à conversão de CFOP.
const SAIDA_PARA_ENTRADA_CST_IPI = {
    50: '00', 51: '01', 52: '02', 53: '03', 54: '04', 55: '05', 99: '49',
};

/**
 * O CST-IPI como ele deve aparecer no LIVRO do estabelecimento.
 *  · ENTRADA: converte o CST de saída do fornecedor (50-55/99) para o de entrada.
 *    CST que já é de entrada (00-05/49) passa direto.
 *  · SAÍDA: é o CST da própria nota — fica como está (o estabelecimento é o
 *    emitente). NÃO se normaliza "outras saídas" (99) para 55/etc.: seria
 *    inventar/corrigir a nota do cliente — isso ACENDE alerta, não contorno.
 */
function cstIpiEscrituracao(cstRaw, direcao) {
    const cst = cst2(cstRaw);
    if (direcao === 'entrada' && Object.prototype.hasOwnProperty.call(SAIDA_PARA_ENTRADA_CST_IPI, cst)) {
        return SAIDA_PARA_ENTRADA_CST_IPI[cst];
    }
    return cst;
}

/**
 * Monta as linhas do E510 a partir das notas.
 *
 * @param {Array}  notas
 * @param {object} [deps]
 *   · convertCfop(cfopRaw, direcao, notaDados, nota) → CFOP de escrituração. Default
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
    let saidasOutras = 0;      // saída com CST 99 (outras) = conferir na origem

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
            // 🚨 A DIREÇÃO GRAVADA PODE MENTIR, e aqui ela decide DOIS campos
            // do arquivo: o CFOP e — o mais caro — o CST de escrituração, que
            // na ENTRADA converte o CST de saída do fornecedor (IN RFB
            // 932/2009: 50→00, 51→01…). A nota PRÓPRIA DE ENTRADA (art. 136)
            // fica gravada como 'saida' até o backfill passar; lida crua, ela
            // ia ao E510 com o CFOP e o CST da operação DO FORNECEDOR.
            const direcaoNota = direcaoEfetivaDoc(nota) || nota.direcao;
            const cfop = String(conv(item.cfop || item.CFOP || '0000', direcaoNota, nota._dados, nota));
            // CST de ESCRITURAÇÃO: entrada converte o CST de saída do fornecedor.
            const cst = cstIpiEscrituracao(item.cstIpi, direcaoNota);
            if (direcaoNota !== 'entrada' && cst === '99') saidasOutras += 1;
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
    if (saidasOutras > 0) {
        avisos.push(
            `E510: ${saidasOutras} item(ns) de SAÍDA com CST-IPI 99 (outras saídas). Confira na origem — `
            + 'remessa/retorno de industrialização costuma ser 55 (suspensão), e a nota pode ter sido emitida '
            + 'com o CST genérico. O app NÃO corrige o CST da nota (alerta, não contorno).',
        );
    }
    return { linhas, avisos, grupos: ordenados };
}
