// ============================================================================
// sefaz-backend/sped-fiscal-blocoE.js
// Bloco E — Apuracao do ICMS.
//
// Registros gerados:
//   E001 — Abertura do Bloco E
//   E100 — Periodo da apuracao do ICMS
//   E110 — Apuracao do ICMS - Operacoes Proprias
//   E116 — Obrigacao do ICMS a Recolher (gerado SE vl_icms_recolher > 0)
//   E990 — Encerramento do Bloco E
//
// Comportamento:
//   - Simples Nacional: E110 zerada, SEM E116 (paga DAS, nao GARE).
//   - Lucro: calcula apuracao real. Se saldo devedor > 0, gera E116
//     com vencimento e codigo de receita derivados da UF da empresa.
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

function somarIcmsPorDirecao(notas, direcao) {
    // Soma dos ITENS (mesma fonte do C190). Garante que E110 fica
    // consistente com o que o PVA vê nos analíticos. Se totais.vICMS
    // estiver zerado (parser legado), os itens ainda têm os valores.
    let total = 0;
    for (const nota of notas || []) {
        if (nota.direcao !== direcao) continue;
        if (nota.status !== 'autorizado') continue;
        if (!['55', '65'].includes(String(nota.modelo))) continue;
        let fromItens = 0;
        for (const item of (nota.itens || [])) {
            fromItens += parseFloat(item.vICMS || 0);
        }
        if (fromItens > 0) {
            total += fromItens;
        } else {
            // Fallback: notas sem itens carregados (raro) — usa totais.
            const t = nota.totais || {};
            total += parseFloat(t.vICMS || 0);
        }
    }
    return total;
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

    const total = linhas.length + 1;
    linhas.push(fmt.buildLine(['E990', total]));

    return linhas;
}
