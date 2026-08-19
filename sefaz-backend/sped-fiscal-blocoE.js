// ============================================================================
// sefaz-backend/sped-fiscal-blocoE.js
// Bloco E — Apuracao do ICMS.
//
// Registros gerados:
//   E001 — Abertura do Bloco E
//   E100 — Periodo da apuracao do ICMS
//   E110 — Apuracao do ICMS - Operacoes Proprias
//   E116 — Obrigacao do ICMS a Recolher (gerado SE vl_icms_recolher > 0)
//   E200 — Periodo da apuracao do ICMS ST, por UF (gerado SE ha ST retido)
//   E210 — Apuracao do ICMS ST da UF
//   E220 — Ajustes da apuracao do ST (codigos com '1' no 3o caractere)
//   E250 — Obrigacao do ST a recolher (so com vencimento+codigo cadastrados)
//   E500 — Periodo da apuracao do IPI        (gerado SE ha atividade de IPI)
//   E520 — Apuracao do IPI                   (gerado SE ha atividade de IPI)
//   E990 — Encerramento do Bloco E
//
// Comportamento:
//   - Simples Nacional: E110 zerada, SEM E116/ST/IPI (paga DAS, nao GARE).
//   - Lucro: calcula apuracao real de ICMS. Se saldo devedor > 0, gera E116
//     com vencimento e codigo de receita derivados da UF da empresa.
//     IPI: gera E200/E210 apenas quando ha debito ou credito de IPI nas notas
//     (industria/importador). Comercio/servico sem IPI nao recebe o bloco.
//
// Layout: Guia Pratico 3.2.2 / Leiaute 020.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';
import { classificarAjustes, aplicarAjustesApuracao, montarLinhasE111 } from './sped-ajustes-apuracao.js';
import { montarLinhasStBlocoE } from './sped-bloco-e-st.js';
import { montarLinhasE510 } from './sped-bloco-ipi-e510.js';
import { avisosDeSaldoAnterior } from './saldo-anterior-apuracao.js';
import { convertCfopParaEntrada } from './sped-fiscal-blocoC.js';

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
/**
 * Débito (saídas) ou crédito (entradas) de ICMS do período.
 *
 * EXPORTADA porque o detector de crédito acumulado precisa do MESMO número que
 * vai no E110 — dois jeitos de somar ICMS é o painel divergindo do arquivo, e
 * aí ninguém sabe qual dos dois está certo.
 */
export function somarIcmsPorDirecao(notas, direcao) {
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

    // Ajustes da apuração (E111): lançados na aba do card SPED Fiscal,
    // classificados pelo TIPO embutido no código (4º caractere) e aplicados
    // na fórmula do E110. Só pra Lucro — Simples não apura ICMS aqui.
    const uf = (dados?.empresa?.dadosFiscais?.uf || '').toUpperCase();
    const cls = classificarAjustes(regime === 'lucro' ? dados.ajustesApuracao : [], uf);
    // Só se avisa sobre o saldo do bloco que REALMENTE saiu — aviso sobre bloco
    // inexistente é o alarme sem ação que ensina a ignorar os que importam.
    let geraSt = false;
    let geraIpi = false;

    let ap = {
        vlTotDebitos: 0, vlTotAjDebitos: 0, vlEstornosCred: 0,
        vlTotCreditos: 0, vlTotAjCreditos: 0, vlEstornosDeb: 0,
        vlSldCredorAnt: 0, vlSldApurado: 0, vlTotDed: 0,
        vlIcmsRecolher: 0, vlSldCredorTransportar: 0, vlDebEsp: 0,
    };
    if (regime === 'lucro') {
        ap = aplicarAjustesApuracao({
            vlTotDebitos: somarIcmsPorDirecao(dados.notas, 'saida'),
            vlTotCreditos: somarIcmsPorDirecao(dados.notas, 'entrada'),
            vlSldCredorAnt: parseFloat(dados.saldoCredorIcmsAnterior || 0),
        }, cls);
    }

    linhas.push(fmt.buildLine([
        'E110',
        fmt.formatValue(ap.vlTotDebitos, 2),
        ZERO,                                       // VL_AJ_DEBITOS (ajuste de documento — não gerado)
        fmt.formatValue(ap.vlTotAjDebitos, 2),      // VL_TOT_AJ_DEBITOS (E111 tipo 0)
        fmt.formatValue(ap.vlEstornosCred, 2),      // VL_ESTORNOS_CRED  (E111 tipo 1)
        fmt.formatValue(ap.vlTotCreditos, 2),
        ZERO,                                       // VL_AJ_CREDITOS (ajuste de documento — não gerado)
        fmt.formatValue(ap.vlTotAjCreditos, 2),     // VL_TOT_AJ_CREDITOS (E111 tipo 2)
        fmt.formatValue(ap.vlEstornosDeb, 2),       // VL_ESTORNOS_DEB   (E111 tipo 3)
        fmt.formatValue(ap.vlSldCredorAnt, 2),
        fmt.formatValue(ap.vlSldApurado, 2),        // saldo DEVEDOR (0,00 quando credor)
        fmt.formatValue(ap.vlTotDed, 2),            // VL_TOT_DED        (E111 tipo 4)
        fmt.formatValue(ap.vlIcmsRecolher, 2),
        fmt.formatValue(ap.vlSldCredorTransportar, 2),
        fmt.formatValue(ap.vlDebEsp, 2),            // DEB_ESP           (E111 tipo 5)
    ]));

    // E111 — filhos do E110, um por ajuste lançado.
    for (const campos of montarLinhasE111(cls.validos)) {
        linhas.push(fmt.buildLine([
            campos[0],
            fmt.sanitizeString(campos[1], 8),
            fmt.sanitizeString(campos[2], 255),
            fmt.formatValue(campos[3], 2),
        ]));
    }

    if (regime === 'lucro' && ap.vlIcmsRecolher > 0) {
        linhas.push(buildE116(dados, ap.vlIcmsRecolher));
    }

    // ── ICMS-ST (E200/E210/E220/E250) — quem RETÉM ST na saída apura por UF
    //    de destino. Era o bloqueio nº 1 depois do E111 (painel 🚦).
    if (regime === 'lucro') {
        const st = montarLinhasStBlocoE({
            notas: dados.notas,
            ufEmpresa: uf,
            ajustes: dados.ajustesApuracao,
            dtIni: fmt.formatCompetenciaInicio(dados.competenciaInicio),
            dtFin: fmt.formatCompetenciaFim(dados.competenciaFim),
            obrigacoesPorUf: dados.obrigacoesStPorUf || {},
        });
        linhas.push(...st.linhas);
        if (Array.isArray(dados.warnings)) dados.warnings.push(...st.avisos);
        geraSt = st.linhas.length > 0;
    }

    // ── IPI (E500/E520) — só para Lucro COM atividade de IPI (indústria/
    //    importador). Comércio/serviço sem IPI não gera o bloco, evitando
    //    registro indevido pra empresa não-contribuinte de IPI.
    //    CORREÇÃO 04/08: o gerador antigo punha o IPI em E200/E210, que são
    //    registros do ICMS-ST. IPI é E500 (período) + E520 (apuração).
    if (regime === 'lucro') {
        const linhasIpi = buildE500E520(dados);
        linhas.push(...linhasIpi);
        geraIpi = linhasIpi.length > 0;
    }

    // ── O SALDO ANTERIOR DECLARADO SAI DITO, NUNCA CALADO ──────────────────
    //
    // Zero num campo de saldo é uma AFIRMAÇÃO à SEFAZ ("não havia crédito a
    // transportar"), não uma omissão — e para quem tem crédito acumulado isso
    // recolhe a MAIOR, sem nada denunciar, porque o arquivo é aceito.
    // Paulo, 17/08: *"a apuração não está considerando o saldo que já vinha
    // sendo acumulado nas competências anteriores"*.
    if (regime === 'lucro' && Array.isArray(dados.warnings)) {
        dados.warnings.push(...avisosDeSaldoAnterior({
            icmsAnterior: parseFloat(dados.saldoCredorIcmsAnterior || 0),
            origemIcms: 'ficha da competência anterior',
            ipiAnterior: parseFloat(dados.saldoCredorIpiAnterior || 0),
            origemIpi: 'campo "Cred. IPI do mês anterior" da ficha desta competência',
            geraIpi,
            geraSt,
        }));
    }

    const total = linhas.length + 1;
    linhas.push(fmt.buildLine(['E990', total]));

    return linhas;
}

/**
 * E500 — Período de Apuração do IPI
 * E520 — Apuração do IPI
 *
 * Só emite se houver atividade de IPI (débito, crédito ou saldo credor
 * anterior > 0). Empresas não-contribuintes de IPI (a maioria do comércio/
 * serviço) não recebem o bloco — replicar zerado geraria registro indevido
 * no PVA.
 *
 * E210 (Guia Prático 3.2.2 / Leiaute 020):
 *   IND_APUR_IPI(0=mensal), VL_SD_ANT_IPI, VL_DEB_IPI, VL_CRED_IPI,
 *   VL_OD_IPI, VL_OC_IPI, VL_SC_IPI, VL_SD_IPI.
 */
function buildE500E520(dados) {
    const vlDeb = somarImpostoPorDirecao(dados.notas, 'saida', 'vIPI', 'vIPI');
    const vlCred = somarImpostoPorDirecao(dados.notas, 'entrada', 'vIPI', 'vIPI');
    // Saldo anterior TAMBÉM segura o bloco de pé: mês sem movimento de IPI mas
    // com crédito vindo da competência anterior precisa do E520 para o saldo
    // não SUMIR da corrente de transporte — sumir calado é o defeito que este
    // campo teve até 19/08 (caso PWR: ficha com 2.547,39 e arquivo com 0,00).
    const vlSdAnt = parseFloat(dados.saldoCredorIpiAnterior || 0);
    if (vlDeb <= 0 && vlCred <= 0 && vlSdAnt <= 0) return [];
    const saldo = vlDeb - vlCred - vlSdAnt;
    const vlSdIpi = saldo >= 0 ? saldo : 0;   // saldo devedor a recolher
    const vlScIpi = saldo < 0 ? -saldo : 0;   // saldo credor a transportar

    // E510 — consolidação por CFOP+CST_IPI, ENTRE o E500 e o E520 (ordem do
    // arquivo real). Reaproveita o MESMO convertCfop do C190: o E510 é o C190
    // re-agregado. A soma do VL_IPI dos E510 de saída bate com o VL_DEB do
    // E520 (amarração da SEFAZ) — os dois saem da mesma varredura de itens.
    const e510 = montarLinhasE510(dados.notas, {
        convertCfop: (cfop, direcao, notaDados, nota) => convertCfopParaEntrada(cfop, direcao, notaDados, nota),
    });
    if (Array.isArray(dados.warnings)) dados.warnings.push(...e510.avisos);

    return [
        fmt.buildLine([
            'E500',
            '0',                          // IND_APUR: 0 = mensal
            fmt.formatCompetenciaInicio(dados.competenciaInicio),
            fmt.formatCompetenciaFim(dados.competenciaFim),
        ]),
        ...e510.linhas,
        fmt.buildLine([
            'E520',
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
