// ============================================================================
// sefaz-backend/sped-fiscal-blocoE.js
// Bloco E — Apuracao do ICMS e do IPI.
//
// Comportamento:
//   - Simples Nacional: E110 zerada (Simples nao apura ICMS individual,
//     paga DAS unificado). Sem apuracao a declarar.
//   - Lucro Presumido / Lucro Real: calcula apuracao real:
//       * Debitos = somatorio vICMS de notas de SAIDA do periodo
//       * Creditos = somatorio vICMS de notas de ENTRADA do periodo
//       * Saldo apurado = debitos - creditos - saldo credor anterior
//       * Se positivo -> VL_ICMS_RECOLHER
//       * Se negativo -> VL_SLD_CREDOR_TRANSPORTAR (carry-forward)
//
// VL_SLD_CREDOR_ANT vem de dados.saldoCredorIcmsAnterior (lido pelo
// orchestrator da ficha do mes anterior).
//
// Nao implementado nesta versao (zerado):
//   - VL_AJ_DEBITOS / VL_AJ_CREDITOS (ajustes E111 — nao geramos E111)
//   - VL_ESTORNOS_CRED / VL_ESTORNOS_DEB
//   - VL_TOT_DED (deducoes)
//   - DEB_ESP (debitos especiais)
//   - E200/E210 (apuracao ICMS-ST — geramos E001|0|+E990|2| via blocos-vazios)
//
// Layout: Guia Pratico 3.2.0 / Leiaute 020.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';

const ZERO = '0,00';

/**
 * Soma o vICMS de todas as notas filtradas pela direcao.
 * Considera apenas notas modelo 55/65 (Bloco C) com status autorizado.
 */
function somarIcmsPorDirecao(notas, direcao) {
    let total = 0;
    for (const nota of notas || []) {
        if (nota.direcao !== direcao) continue;
        if (nota.status !== 'autorizado') continue;
        if (!['55', '65'].includes(String(nota.modelo))) continue;
        const t = nota.totais || {};
        total += parseFloat(t.vICMS || 0);
    }
    return total;
}

/**
 * @param {object} dados
 * @param {string} dados.competenciaInicio
 * @param {string} dados.competenciaFim
 * @param {object[]} dados.notas
 * @param {object} dados.empresa - empresa com _regime ('simples' | 'lucro')
 * @param {number} [dados.saldoCredorIcmsAnterior] - lido da ficha mes anterior (Lucro)
 * @returns {string[]}
 */
export function buildBlocoE(dados) {
    const linhas = [];
    const regime = dados?.empresa?._regime;

    // E001 — Abertura. 0 = Bloco com dados (sempre geramos E100/E110)
    linhas.push(fmt.buildLine(['E001', '0']));

    // E100 — Periodo da apuracao do ICMS
    linhas.push(fmt.buildLine([
        'E100',
        fmt.formatCompetenciaInicio(dados.competenciaInicio),
        fmt.formatCompetenciaFim(dados.competenciaFim),
    ]));

    // E110 — Apuracao do ICMS — Operacoes Proprias
    let vl_tot_debitos = 0;
    let vl_tot_creditos = 0;
    let vl_sld_credor_ant = 0;
    let vl_sld_apurado = 0;
    let vl_icms_recolher = 0;
    let vl_sld_credor_transportar = 0;

    if (regime === 'lucro') {
        // Calcula a partir das notas
        vl_tot_debitos = somarIcmsPorDirecao(dados.notas, 'saida');
        vl_tot_creditos = somarIcmsPorDirecao(dados.notas, 'entrada');
        vl_sld_credor_ant = parseFloat(dados.saldoCredorIcmsAnterior || 0);

        // Saldo apurado = debitos - (creditos + saldo credor anterior)
        const saldo = vl_tot_debitos - vl_tot_creditos - vl_sld_credor_ant;
        vl_sld_apurado = Math.abs(saldo);

        if (saldo >= 0) {
            // Saldo devedor: empresa paga
            vl_icms_recolher = saldo;
            vl_sld_credor_transportar = 0;
        } else {
            // Saldo credor: carrega pro proximo mes
            vl_icms_recolher = 0;
            vl_sld_credor_transportar = -saldo;
        }
    }
    // Simples Nacional: tudo permanece 0 (correto)

    linhas.push(fmt.buildLine([
        'E110',
        fmt.formatValue(vl_tot_debitos, 2),       // VL_TOT_DEBITOS
        ZERO,                                       // VL_AJ_DEBITOS
        fmt.formatValue(vl_tot_debitos, 2),       // VL_TOT_AJ_DEBITOS (= debitos qd sem ajuste)
        ZERO,                                       // VL_ESTORNOS_CRED
        fmt.formatValue(vl_tot_creditos, 2),      // VL_TOT_CREDITOS
        ZERO,                                       // VL_AJ_CREDITOS
        fmt.formatValue(vl_tot_creditos, 2),      // VL_TOT_AJ_CREDITOS
        ZERO,                                       // VL_ESTORNOS_DEB
        fmt.formatValue(vl_sld_credor_ant, 2),    // VL_SLD_CREDOR_ANT
        fmt.formatValue(vl_sld_apurado, 2),       // VL_SLD_APURADO
        ZERO,                                       // VL_TOT_DED
        fmt.formatValue(vl_icms_recolher, 2),     // VL_ICMS_RECOLHER
        fmt.formatValue(vl_sld_credor_transportar, 2),  // VL_SLD_CREDOR_TRANSPORTAR
        ZERO,                                       // DEB_ESP
    ]));

    // E990 — Encerramento
    const total = linhas.length + 1;
    linhas.push(fmt.buildLine(['E990', total]));

    return linhas;
}
