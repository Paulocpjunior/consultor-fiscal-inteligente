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
import { ajustarDiaUtil } from './calendario-obrigacoes.js';

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

// PIS/COFINS (faturamento) vencem dia 25 do mês seguinte (antecipa em dia não
// útil — Lei 11.933/2009); os demais mensais, último dia útil do mês seguinte.
const RECEITAS_DIA_25 = new Set(['8109', '2172', '6912', '5856']);

export function ultimoDiaDoMes(ano, mes) {
    return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** '2026-06' -> { ano: 2026, mes: 6 } (null se inválida) */
function parseCompetencia(competencia) {
    const m = String(competencia).match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    return { ano: parseInt(m[1]), mes: parseInt(m[2]) };
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
    if (!pa) return new Date().toISOString().slice(0, 10);
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

/** hoje em YYYY-MM-DD (UTC-3 aware o suficiente pro caso de uso) */
function hojeIso() {
    return new Date().toISOString().slice(0, 10);
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
    const { tipoPA, dataPA } = periodoApuracaoSicalc(
        competencia, req.tributo, req.periodicidade, codigoReceita
    );

    // Data de consolidação = data prevista de pagamento. Em dia: o próprio
    // vencimento (sem multa/juros). Vencido: hoje (ajustado a dia útil
    // seguinte) — o SICALC calcula os acréscimos legais.
    const hoje = hojeIso();
    let dataConsolidacao = req.dataPagamento || (vencimento >= hoje ? vencimento : hoje);
    {
        const [a, m, d] = dataConsolidacao.split('-').map(Number);
        dataConsolidacao = ajustarDiaUtil(a, m, d, 'postergar');
    }

    return {
        idSistema: DARF_ID_SISTEMA,
        idServico: DARF_ID_SERVICO,
        versaoSistema: DARF_VERSAO_SISTEMA,
        contribuinteCnpj: empresaCnpj,
        acao: 'Emitir',
        dados: {
            uf: req.uf || DARF_UF,
            municipio: String(req.municipio || DARF_MUNICIPIO),
            codigoReceita,
            codigoReceitaExtensao,
            tipoPA,
            dataPA,
            vencimento: iso00(vencimento),
            valorImposto: Number(valor).toFixed(2),
            dataConsolidacao: iso00(dataConsolidacao),
            // SICALC valida "tamanho deve ser entre 0 e 50" (EntradaIncorreta-
            // SICALC, caso real 08/07/2026) — trunca aqui pra proteger todo
            // chamador.
            observacao: String(req.observacao || '').slice(0, 50),
        },
    };
}
