// ============================================================================
// darf-payload-builder.js  (PURO)
//
// Monta o payload do Integra Contador SERPRO pra emissao de DARF + helpers de
// codigo de receita e vencimento. Extraido de darf-provider.js pra ser
// TESTAVEL: darf-provider importa serpro-client -> undici, que nao carrega no
// jest. Este modulo importa SO modulos puros (darf-codigos-receita,
// calendario-obrigacoes/feriados).
//
// Catalogo OFICIAL (docs Integra Contador, confirmado 08/07/2026):
//   idSistema: SICALC   idServico: CONSOLIDARGERARDARF51   versao: "2.9"
//   acao: /Emitir
//   dados: { uf, municipio, codigoReceita, codigoReceitaExtensao, tipoPA,
//            dataPA, vencimento (ISO), valorImposto, dataConsolidacao (ISO),
//            observacao }
// (os antigos PAGTOWEB/EMITEDARF61 eram chutes e não existem no catálogo —
//  ICGERENCIADOR-052.)
//
// O mesmo builder serve o ENVIO real (SerproProvider.gerarDarf) e o PREVIEW
// (GET /darf/preview) — garante que o admin ve no preview exatamente o que
// sera enviado.
// ============================================================================

import { sugerirCodigoReceita } from './darf-codigos-receita.js';
import { normalizarCompetencia, dataBrasilia } from './competencia.js';
import { ajustarDiaUtil } from './calendario-obrigacoes.js';
import { dinheiroDeEntrada } from './das-valor-utils.js';

const DARF_ID_SISTEMA = process.env.SERPRO_DARF_SISTEMA || 'SICALC';
const DARF_ID_SERVICO = process.env.SERPRO_DARF_SERVICO || 'CONSOLIDARGERARDARF51';
const DARF_VERSAO_SISTEMA = process.env.SERPRO_DARF_VERSAO || '2.9';

// Praça de pagamento impressa no cabeçalho do DARF (Tabela de Órgãos e
// Municípios da RFB — 7107 = São Paulo/SP, sede do escritório). Não afeta a
// alocação do pagamento; configurável por env sem rebuild.
const DARF_UF = process.env.SERPRO_DARF_UF || 'SP';
const DARF_MUNICIPIO = process.env.SERPRO_DARF_MUNICIPIO || '7107';

// Códigos de receita TRIMESTRAIS (IRPJ/CSLL Presumido e Real). Os demais
// tratamos como mensais (PIS/COFINS, estimativas, IRRF...).
const RECEITAS_TRIMESTRAIS = new Set(['2089', '0220', '2372', '6012']);

// PIS/COFINS (faturamento) e IPI mensal (demais produtos/bebidas/automóveis)
// vencem dia 25 do mês seguinte (antecipa em dia não útil — Lei 11.933/2009);
// os demais mensais, último dia útil do mês seguinte. IPI-cigarros (5110, dia
// 10) e IPI-importação (0676, desembaraço) NÃO entram aqui.
const RECEITAS_DIA_25 = new Set(['8109', '2172', '6912', '5856', '5123', '0668', '1097']);
// IRRF (retenção): vencimento até o último dia útil do 2º decêndio do mês
// seguinte — na prática dia 20, antecipado se não útil.
const RECEITAS_DIA_20 = new Set(['1708', '0561', '0588', '3208', '5952', '5987']);

export function ultimoDiaDoMes(ano, mes) {
    return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** '2026-06' -> { ano: 2026, mes: 6 } (null se inválida) */
/**
 * ⚠️ AS QUATRO FORMAS DA COMPETÊNCIA, pelo dono.
 *
 * Este parse conhecia só `AAAA-MM`. As outras formas que o app usa de verdade
 * — `202607` (colagem de arquivo), `07/2026` (catálogo e tarefas) e
 * `AAAA-MM-DD` (a ficha financeira grava as duas) — caíam no `null`, e daí:
 * o vencimento virava **HOJE** e o período de apuração **lançava**. Ou seja, a
 * emissão do DARF era recusada com uma mensagem de formato para uma
 * competência que o resto do app entende.
 */
function parseCompetencia(competencia) {
    const n = normalizarCompetencia(competencia);
    if (!n) return null;
    const [ano, mes] = n.split('-');
    return { ano: parseInt(ano, 10), mes: parseInt(mes, 10) };
}

function ehTrimestral(codigoReceita, tributo, periodicidade) {
    const raiz = String(codigoReceita || '').replace(/\D/g, '').slice(0, 4);
    if (raiz && RECEITAS_TRIMESTRAIS.has(raiz)) return true;
    const t = String(tributo || '').toUpperCase();
    return periodicidade === 'trimestral' && (t === 'IRPJ' || t === 'CSLL');
}

/**
 * Vencimento legal do tributo, ajustado a dia útil:
 *  - trimestral (IRPJ/CSLL): último dia útil do mês seguinte ao fim do trimestre
 *  - PIS/COFINS: dia 25 do mês seguinte, ANTECIPADO se não útil
 *  - demais mensais: último dia útil do mês seguinte
 */
export function calcularVencimentoDarf(competencia, tributo, periodicidade = 'trimestral', codigoReceita = '') {
    const pa = parseCompetencia(competencia);
    // 🚨 CAMPO DE DATA NÃO RECEBE DEFAULT. Aqui a ausência virava **HOJE** —
    // um DARF vencendo no dia em que foi emitido, sobre débito de outro
    // período. Hoje isso só não sai porque `periodoApuracaoSicalc`, duas
    // linhas adiante, lança antes; ou seja, o arquivo depende da ORDEM de duas
    // chamadas. É a família do `|| new Date()` do `.FML` (22/08).
    if (!pa) return null;
    let { ano, mes } = pa;

    if (ehTrimestral(codigoReceita, tributo, periodicidade)) {
        const trimestre = Math.floor((mes - 1) / 3) + 1;
        mes = trimestre * 3 + 1;                     // mês seguinte ao fim do trimestre
        if (mes > 12) { mes = 1; ano += 1; }
        return ajustarDiaUtil(ano, mes, ultimoDiaDoMes(ano, mes), 'antecipar');
    }

    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
    const raiz = String(codigoReceita || '').replace(/\D/g, '').slice(0, 4);
    const t = String(tributo || '').toUpperCase();
    if (RECEITAS_DIA_25.has(raiz) || t === 'PIS' || t === 'COFINS') {
        return ajustarDiaUtil(ano, mes, 25, 'antecipar');
    }
    if (RECEITAS_DIA_20.has(raiz) || t === 'IRRF') {
        return ajustarDiaUtil(ano, mes, 20, 'antecipar');
    }
    return ajustarDiaUtil(ano, mes, ultimoDiaDoMes(ano, mes), 'antecipar');
}

/**
 * tipoPA/dataPA no formato do SICALC:
 *  - mensal:     tipoPA 'ME', dataPA 'mm/aaaa'
 *  - trimestral: tipoPA 'TR', dataPA 'tt/aaaa' (01 a 04)
 */
export function periodoApuracaoSicalc(competencia, tributo, periodicidade = 'trimestral', codigoReceita = '') {
    const pa = parseCompetencia(competencia);
    if (!pa) throw new Error(`competencia inválida: ${competencia} (esperado YYYY-MM)`);
    if (ehTrimestral(codigoReceita, tributo, periodicidade)) {
        const trimestre = Math.floor((pa.mes - 1) / 3) + 1;
        return { tipoPA: 'TR', dataPA: `${String(trimestre).padStart(2, '0')}/${pa.ano}` };
    }
    return { tipoPA: 'ME', dataPA: `${String(pa.mes).padStart(2, '0')}/${pa.ano}` };
}

/**
 * Dado o "hoje" (YYYY-MM-DD), retorna qual trimestre de IRPJ/CSLL vence NESTE
 * mês e a competência-chave (último mês do trimestre, onde os débitos
 * trimestrais aparecem na DCTFWeb). Trimestrais vencem no último dia útil do
 * mês seguinte ao fim do trimestre: abr/jul/out/jan.
 *
 * @returns {null | { trimestre, competenciaAno, competenciaMes, vencimento }}
 */
export function trimestreVencendoEsteMes(hojeIsoStr) {
    const m = String(hojeIsoStr).match(/^(\d{4})-(\d{2})/);
    if (!m) return null;
    const ano = Number(m[1]);
    const mes = Number(m[2]);
    // mês de vencimento -> { trimestre, mês da competência-chave, ano da competência }
    const mapa = {
        4:  { trimestre: 1, competenciaMes: 3,  competenciaAno: ano },
        7:  { trimestre: 2, competenciaMes: 6,  competenciaAno: ano },
        10: { trimestre: 3, competenciaMes: 9,  competenciaAno: ano },
        1:  { trimestre: 4, competenciaMes: 12, competenciaAno: ano - 1 },
    };
    const info = mapa[mes];
    if (!info) return null;
    const comp = `${info.competenciaAno}-${String(info.competenciaMes).padStart(2, '0')}`;
    return {
        trimestre: info.trimestre,
        competenciaAno: info.competenciaAno,
        competenciaMes: info.competenciaMes,
        vencimento: calcularVencimentoDarf(comp, 'IRPJ', 'trimestral'),
    };
}

export function resolverCodigoReceita(req) {
    if (req.codigoReceita) return req.codigoReceita;
    const sug = sugerirCodigoReceita(req.regime, req.tributo, req.periodicidade);
    if (!sug) throw new Error(`Codigo de receita nao definido pra ${req.regime}/${req.tributo}`);
    return sug.codigo;
}

/**
 * Código (4 díg.) + extensão (2 díg.). Aceita:
 *  - req.codigoReceita com 6 dígitos (shape DCTFWeb, ex. '810902') — embute extensão
 *  - req.codigoReceitaExtensao explícito
 *  - resolução via tabela (regime/tributo) — usa a extensão da tabela
 */
export function resolverCodigoEExtensao(req) {
    if (req.codigoReceita) {
        const cod = String(req.codigoReceita).replace(/\D/g, '');
        return {
            codigo: cod.slice(0, 4),
            extensao: req.codigoReceitaExtensao || (cod.length >= 6 ? cod.slice(4, 6) : '01'),
        };
    }
    const sug = sugerirCodigoReceita(req.regime, req.tributo, req.periodicidade);
    if (!sug) throw new Error(`Codigo de receita nao definido pra ${req.regime}/${req.tributo}`);
    return { codigo: sug.codigo, extensao: req.codigoReceitaExtensao || sug.extensao || '01' };
}

/**
 * Hoje em YYYY-MM-DD no fuso de Brasília. NÃO usar toISOString() (UTC): o
 * container roda em UTC, então das 21h à meia-noite BRT o toISOString já
 * marca o dia seguinte — o que faria uma emissão no prazo virar "vencida" e
 * o SICALC cobrar multa/juros indevidos (achado 09/07/2026).
 */
export function hojeIso() {
    return dataBrasilia(new Date());
}

const iso00 = (yyyyMmDd) => `${yyyyMmDd}T00:00:00`;

/**
 * Monta o EXATO payload que seria enviado ao Integra Contador SERPRO
 * (SICALC / CONSOLIDARGERARDARF51).
 *
 * @param {object} req
 *   empresaCnpj, competencia (YYYY-MM), valor,
 *   regime?/tributo?/periodicidade? (resolvem código quando não informado),
 *   codigoReceita? (4 ou 6 dígitos — 6 embute a extensão),
 *   codigoReceitaExtensao?, vencimento? (YYYY-MM-DD),
 *   dataPagamento? (YYYY-MM-DD — consolidação p/ pagamento em atraso),
 *   uf?, municipio?, observacao?
 * @returns {{ idSistema, idServico, versaoSistema, contribuinteCnpj, acao, dados }}
 */
export function montarPayloadDarfSerpro(req) {
    const { empresaCnpj, competencia, valor } = req;
    if (!empresaCnpj || !competencia || !valor) {
        throw new Error('empresaCnpj, competencia e valor obrigatorios');
    }
    const { codigo: codigoReceita, extensao: codigoReceitaExtensao } = resolverCodigoEExtensao(req);

    const vencimento = req.vencimento
        || calcularVencimentoDarf(competencia, req.tributo, req.periodicidade, codigoReceita);
    // Sem vencimento derivável a guia NÃO SAI — e a recusa diz o que faltou.
    // Antes daqui ela saía com a data de HOJE, que é uma afirmação sobre o
    // prazo do cliente.
    if (!vencimento) {
        throw new Error(
            `competencia inválida: "${competencia}" — sem ela não dá para calcular o vencimento do DARF. `
            + 'Use AAAA-MM (ex.: 2026-07).',
        );
    }
    const { tipoPA, dataPA } = periodoApuracaoSicalc(
        competencia, req.tributo, req.periodicidade, codigoReceita
    );

    // 🚨 `Number(valor).toFixed(2)` mandava "NaN" ao SICALC quando o valor
    // chegava em pt-BR ("1.234,56"), e deixava passar negativo. O valor passa
    // pelo DONO da leitura de dinheiro; ilegível ou ≤ 0 é RECUSA nomeando o
    // campo — guia de imposto não sai "quase certa".
    const valorImposto = dinheiroDeEntrada(valor);
    if (valorImposto === null || valorImposto <= 0) {
        throw new Error(
            `valor inválido (${JSON.stringify(valor)}) — informe o valor do imposto em reais, maior que zero `
            + '(ex.: 1234,56). Nada foi enviado ao SICALC.',
        );
    }

    // Data de consolidação = data prevista de pagamento. Em dia: o próprio
    // vencimento (sem multa/juros). Vencido: hoje (ajustado a dia útil
    // seguinte) — o SICALC calcula os acréscimos legais.
    const hoje = hojeIso();
    let dataConsolidacao = req.dataPagamento || (vencimento >= hoje ? vencimento : hoje);
    {
        const [a, m, d] = dataConsolidacao.split('-').map(Number);
        dataConsolidacao = ajustarDiaUtil(a, m, d, 'postergar');
    }

    const dados = {
        uf: req.uf || DARF_UF,
        municipio: String(req.municipio || DARF_MUNICIPIO),
        codigoReceita,
        codigoReceitaExtensao,
        tipoPA,
        dataPA,
        vencimento: iso00(vencimento),
        valorImposto: valorImposto.toFixed(2),
        dataConsolidacao: iso00(dataConsolidacao),
        // SICALC valida "tamanho deve ser entre 0 e 50" (EntradaIncorreta-
        // SICALC, caso real 08/07/2026) — trunca aqui pra proteger todo
        // chamador.
        observacao: String(req.observacao || '').slice(0, 50),
    };
    // Quota do IRPJ/CSLL trimestral (Lei 9.430 art. 5º — até 3 quotas).
    // O SICALC calcula os juros SELIC+1% das quotas 2/3 a partir da cota +
    // data de consolidação. String, como no exemplo oficial da doc.
    if (req.cota) dados.cota = String(req.cota);

    return {
        idSistema: DARF_ID_SISTEMA,
        idServico: DARF_ID_SERVICO,
        versaoSistema: DARF_VERSAO_SISTEMA,
        contribuinteCnpj: empresaCnpj,
        acao: 'Emitir',
        dados,
    };
}
