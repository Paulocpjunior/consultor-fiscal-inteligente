// ============================================================================
// sefaz-backend/sped-fiscal-blocoE.js
// Bloco E — Apuracao do ICMS.
//
// Registros gerados:
//   E001 — Abertura do Bloco E
//   E100 — Periodo da apuracao do ICMS
//   E110 — Apuracao do ICMS - Operacoes Proprias
//   E116 — Obrigacao do ICMS a Recolher (gerado SE vl_icms_recolher > 0)
//   E200 — Periodo da apuracao do IPI       (gerado SE ha atividade de IPI)
//   E210 — Apuracao do IPI                   (gerado SE ha atividade de IPI)
//   E990 — Encerramento do Bloco E
//
// Comportamento:
//   - Simples Nacional: E110 zerada, SEM E116/E200/E210 (paga DAS, nao GARE).
//   - Lucro: calcula apuracao real de ICMS. Se saldo devedor > 0, gera E116
//     com vencimento e codigo de receita derivados da UF da empresa.
//     IPI: gera E200/E210 apenas quando ha debito ou credito de IPI nas notas
//     (industria/importador). Comercio/servico sem IPI nao recebe o bloco.
//
// Layout: Guia Pratico 3.2.2 / Leiaute 020.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';

const ZERO = '0,00';

// COD_REC padrao por UF — sobrescritivel via empresa.dadosFiscais.icmsCodRec.
const COD_REC_PADRAO_POR_UF = {
    'SP': '046-2',
    'RJ': '021-3',
    'MG': '220-2',
};

// Dia de vencimento padrao do ICMS — sobrescritivel via icmsDiaVencimento.
const DIA_VENCIMENTO_PADRAO = 20;

function somarImpostoPorDirecao(notas, direcao, campoItem, campoTotais) {
    // Soma dos ITENS (mesma fonte do C190). Garante que E110/E210 ficam
    // consistentes com o que o PVA vê nos analíticos. Se o total da nota
    // estiver zerado (parser legado), os itens ainda têm os valores.
    let total = 0;
    for (const nota of notas || []) {
        if (nota.direcao !== direcao) continue;
        if (nota.status !== 'autorizado') continue;
        if (!['55', '65'].includes(String(nota.modelo))) continue;
        let fromItens = 0;
        for (const item of (nota.itens || [])) {
            fromItens += parseFloat(item[campoItem] || 0);
        }
        if (fromItens > 0) {
            total += fromItens;
        } else {
            // Fallback: notas sem itens carregados (raro) — usa totais.
            const t = nota.totais || {};
            total += parseFloat(t[campoTotais] || 0);
        }
    }
    return total;
}

// ICMS por direção (mantém a assinatura/comportamento original).
function somarIcmsPorDirecao(notas, direcao) {
    return somarImpostoPorDirecao(notas, direcao, 'vICMS', 'vICMS');
}

function calcularDataVencimento(competenciaFim, diaVencimento) {
    const m = (competenciaFim || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return new Date();
    let ano = parseInt(m[1], 10);
    let mes = parseInt(m[2], 10) + 1;
    if (mes > 12) { mes = 1; ano += 1; }
    const dia = Math.min(Math.max(diaVencimento || DIA_VENCIMENTO_PADRAO, 1), 28);
    return new Date(Date.UTC(ano, mes - 1, dia));
}

function formatMesRef(competenciaFim) {
    const m = (competenciaFim || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    return `${m[2]}${m[1]}`;
}

function buildE116(dados, vlIcmsRecolher) {
    const df = dados?.empresa?.dadosFiscais || {};
    const uf = (df.uf || '').toUpperCase();
    const codRec = df.icmsCodRec || COD_REC_PADRAO_POR_UF[uf] || '';
    const diaVcto = parseInt(df.icmsDiaVencimento || DIA_VENCIMENTO_PADRAO, 10);
    const dtVcto = calcularDataVencimento(dados.competenciaFim, diaVcto);

    return fmt.buildLine([
        'E116',
        '000',
        fmt.formatValue(vlIcmsRecolher, 2),
        fmt.formatDate(dtVcto),
        fmt.sanitizeString(codRec, 100),
        '',
        '',
        '',
        '',
        formatMesRef(dados.competenciaFim),
    ]);
}

export function buildBlocoE(dados) {
    const linhas = [];
    const regime = dados?.empresa?._regime;

    linhas.push(fmt.buildLine(['E001', '0']));

    linhas.push(fmt.buildLine([
        'E100',
        fmt.formatCompetenciaInicio(dados.competenciaInicio),
        fmt.formatCompetenciaFim(dados.competenciaFim),
    ]));

    let vl_tot_debitos = 0;
    let vl_tot_creditos = 0;
    let vl_sld_credor_ant = 0;
    let vl_sld_apurado = 0;
    let vl_icms_recolher = 0;
    let vl_sld_credor_transportar = 0;

    if (regime === 'lucro') {
        vl_tot_debitos = somarIcmsPorDirecao(dados.notas, 'saida');
        vl_tot_creditos = somarIcmsPorDirecao(dados.notas, 'entrada');
        vl_sld_credor_ant = parseFloat(dados.saldoCredorIcmsAnterior || 0);

        const saldo = vl_tot_debitos - vl_tot_creditos - vl_sld_credor_ant;
        vl_sld_apurado = Math.abs(saldo);

        if (saldo >= 0) {
            vl_icms_recolher = saldo;
            vl_sld_credor_transportar = 0;
        } else {
            vl_icms_recolher = 0;
            vl_sld_credor_transportar = -saldo;
        }
    }

    linhas.push(fmt.buildLine([
        'E110',
        fmt.formatValue(vl_tot_debitos, 2),
        ZERO,
        fmt.formatValue(vl_tot_debitos, 2),
        ZERO,
        fmt.formatValue(vl_tot_creditos, 2),
        ZERO,
        fmt.formatValue(vl_tot_creditos, 2),
        ZERO,
        fmt.formatValue(vl_sld_credor_ant, 2),
        fmt.formatValue(vl_sld_apurado, 2),
        ZERO,
        fmt.formatValue(vl_icms_recolher, 2),
        fmt.formatValue(vl_sld_credor_transportar, 2),
        ZERO,
    ]));

    if (regime === 'lucro' && vl_icms_recolher > 0) {
        linhas.push(buildE116(dados, vl_icms_recolher));
    }

    // ── IPI (E200/E210) — só para Lucro COM atividade de IPI (indústria/
    //    importador). Comércio/serviço sem IPI não gera o bloco, evitando
    //    registro indevido pra empresa não-contribuinte de IPI.
    if (regime === 'lucro') {
        linhas.push(...buildE200E210(dados));
    }

    const total = linhas.length + 1;
    linhas.push(fmt.buildLine(['E990', total]));

    return linhas;
}

/**
 * E200 — Período de Apuração do IPI
 * E210 — Apuração do IPI
 *
 * Só emite se houver atividade de IPI (débito ou crédito > 0). Empresas
 * não-contribuintes de IPI (a maioria do comércio/serviço) não recebem o
 * bloco — replicar zerado geraria registro indevido no PVA.
 *
 * E210 (Guia Prático 3.2.2 / Leiaute 020):
 *   IND_APUR_IPI(0=mensal), VL_SD_ANT_IPI, VL_DEB_IPI, VL_CRED_IPI,
 *   VL_OD_IPI, VL_OC_IPI, VL_SC_IPI, VL_SD_IPI.
 */
function buildE200E210(dados) {
    const vlDeb = somarImpostoPorDirecao(dados.notas, 'saida', 'vIPI', 'vIPI');
    const vlCred = somarImpostoPorDirecao(dados.notas, 'entrada', 'vIPI', 'vIPI');
    if (vlDeb <= 0 && vlCred <= 0) return [];

    const vlSdAnt = parseFloat(dados.saldoCredorIpiAnterior || 0);
    const saldo = vlDeb - vlCred - vlSdAnt;
    const vlSdIpi = saldo >= 0 ? saldo : 0;   // saldo devedor a recolher
    const vlScIpi = saldo < 0 ? -saldo : 0;   // saldo credor a transportar

    return [
        fmt.buildLine([
            'E200',
            fmt.formatCompetenciaInicio(dados.competenciaInicio),
            fmt.formatCompetenciaFim(dados.competenciaFim),
        ]),
        fmt.buildLine([
            'E210',
            '0',                          // IND_APUR_IPI: 0 = mensal
            fmt.formatValue(vlSdAnt, 2),  // VL_SD_ANT_IPI
            fmt.formatValue(vlDeb, 2),    // VL_DEB_IPI
            fmt.formatValue(vlCred, 2),   // VL_CRED_IPI
            ZERO,                         // VL_OD_IPI (outros débitos)
            ZERO,                         // VL_OC_IPI (outros créditos)
            fmt.formatValue(vlScIpi, 2),  // VL_SC_IPI
            fmt.formatValue(vlSdIpi, 2),  // VL_SD_IPI
        ]),
    ];
}
