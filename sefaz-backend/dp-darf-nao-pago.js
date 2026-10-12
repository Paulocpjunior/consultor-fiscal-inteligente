// ============================================================================
// sefaz-backend/dp-darf-nao-pago.js  (PURO — alerta de DARF do DP sem pagamento)
// ----------------------------------------------------------------------------
// Paulo, 12/10/2026: "podemos seguir com ... o alerta de darf nao pago no CFI".
// O DARF da DCTFWeb que o Consultor DP emite pelo túnel fica na auditoria do
// CFI (dp_dctfweb_log, operacao 'darf': CNPJ, competência, número, vencimento,
// valor). Depois do vencimento, o cron (dp-darf-nao-pago-cron.js) consulta a
// Receita (PAGTOWEB/PAGAMENTOS71) e grava a situação em dp_darf_situacao; o DP
// lê pela rota /api/dp-integration/pagamentos/situacao-darf e avisa no painel.
// O CFI não lê o banco do DP: só o que ele mesmo emitiu.
//
// Regras:
//  - um alvo por CNPJ + competência, com TODOS os números emitidos (reemissão
//    com juros gera número novo; qualquer um pago vale);
//  - "não localizado" não é "não pago": a arrecadação leva dias para aparecer.
//    Só depois de DIAS_UTEIS_DE_CARENCIA dias úteis do vencimento a situação
//    vira 'nao_localizado' (o alerta); antes é 'aguardando';
//  - antes do alerta, procura também por período de arrecadação: guia paga com
//    outro número (DARF gerado no e-CAC) e com o período de apuração da
//    competência conta como paga ("outro documento");
//  - consulta no máximo uma vez por dia e só até DIAS_DE_ACOMPANHAMENTO dias
//    corridos depois do vencimento; pago encerra;
//  - sem vencimento na emissão, o alvo fica de fora (não se chuta a data).
// ============================================================================

import { ehDiaUtil } from './feriados-nacionais.js';
import { normalizarNumeroDocumento } from './dp-pagamentos.js';

export const DIAS_UTEIS_DE_CARENCIA = 3;
export const DIAS_DE_ACOMPANHAMENTO = 60;
/** Emissões mais antigas que isso (dias) não entram na leitura do log. */
export const JANELA_DO_LOG_DIAS = 150;
export const MAX_CONSULTAS_POR_EXECUCAO = 60;

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_COMP = /^\d{4}-(0[1-9]|1[0-2])$/;

function paraData(iso) {
    const m = RE_DATA.exec(String(iso || ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}
function paraIso(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 'AAAA-MM-DD' + n dias corridos. */
export function somarDias(iso, n) {
    const d = paraData(iso);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return paraIso(d);
}

/** 'AAAA-MM-DD' + n dias úteis (feriados nacionais). */
export function somarDiasUteis(iso, n) {
    const d = paraData(iso);
    if (!d) return null;
    let falta = n;
    while (falta > 0) {
        d.setDate(d.getDate() + 1);
        if (ehDiaUtil(d)) falta -= 1;
    }
    return paraIso(d);
}

/** Data do log ('2026-10-20', '2026-10-20T00:00:00-03:00', Date) → 'AAAA-MM-DD' ou null. */
function soData(v) {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ''));
    return m && paraData(m[1]) ? m[1] : null;
}
const emMs = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) || 0 : 0);

export const idSituacao = (cnpj, competencia) => `${cnpj}_${competencia}`;

/**
 * Registros do dp_dctfweb_log → alvos por CNPJ + competência.
 * Entra só DARF emitido (operacao 'darf', ok, número válido). O vencimento, o
 * valor e a empresa do DP são os da emissão mais recente que os trouxe.
 */
export function alvosDosLogs(logs = []) {
    const alvos = new Map();
    const ordenados = [...logs].sort((a, b) => emMs(a?.em) - emMs(b?.em));
    for (const l of ordenados) {
        if (l?.operacao !== 'darf' || l.ok !== true) continue;
        const numero = normalizarNumeroDocumento(l.numeroDocumento);
        const cnpj = String(l.cnpj || '').replace(/\D/g, '');
        if (!numero || cnpj.length !== 14 || !RE_COMP.test(String(l.competencia || ''))) continue;
        const id = idSituacao(cnpj, l.competencia);
        const a = alvos.get(id) || { id, cnpj, competencia: l.competencia, empresaIdDp: null, numerosDocumento: [], vencimento: null, valor: null };
        if (!a.numerosDocumento.includes(numero)) a.numerosDocumento.push(numero);
        const venc = soData(l.vencimento);
        if (venc) a.vencimento = venc;
        if (typeof l.valor === 'number' && Number.isFinite(l.valor)) a.valor = l.valor;
        if (l.empresaIdDp) a.empresaIdDp = String(l.empresaIdDp);
        alvos.set(id, a);
    }
    return [...alvos.values()];
}

/**
 * Consulta hoje? → { consultar: boolean, motivo }.
 * `atual` é o documento de dp_darf_situacao (ou null).
 */
export function precisaConsultar(alvo, atual, hoje) {
    if (!alvo.vencimento) return { consultar: false, motivo: 'sem_vencimento' };
    if (hoje <= alvo.vencimento) return { consultar: false, motivo: 'nao_venceu' };
    const numerosNovos = alvo.numerosDocumento.some((n) => !(atual?.numerosDocumento || []).includes(n));
    if (atual?.situacao === 'pago' && !numerosNovos) return { consultar: false, motivo: 'pago' };
    if (hoje > somarDias(alvo.vencimento, DIAS_DE_ACOMPANHAMENTO)) return { consultar: false, motivo: 'fim_do_acompanhamento' };
    if (atual?.conferidoEm === hoje && !numerosNovos) return { consultar: false, motivo: 'ja_conferido_hoje' };
    return { consultar: true, motivo: numerosNovos && atual ? 'numero_novo' : 'vencido' };
}

/** Já passou a carência depois do vencimento (hora de alertar o que não apareceu)? */
export const passouCarencia = (alvo, hoje) => hoje >= somarDiasUteis(alvo.vencimento, DIAS_UTEIS_DE_CARENCIA);

/** Filtro por período para achar a guia paga com outro número: do mês seguinte à competência até hoje. */
export function filtroPorPeriodo(alvo, hoje) {
    const [a, m] = alvo.competencia.split('-').map(Number);
    const inicio = paraIso(new Date(a, m, 1));
    return { dataInicial: inicio <= hoje ? inicio : hoje, dataFinal: hoje };
}

/** O documento é da competência (período de apuração dele ou de um desmembramento)? */
function daCompetencia(doc, competencia) {
    const pas = [doc?.periodoApuracao, ...(doc?.desmembramentos || []).map((x) => x?.periodoApuracao)];
    return pas.some((p) => typeof p === 'string' && p.slice(0, 7) === competencia);
}

const resumoPagamento = (doc, outroDocumento) => ({
    numeroDocumento: doc.numeroDocumento ?? null,
    dataArrecadacao: doc.dataArrecadacao ?? null,
    valorTotal: doc.valorTotal ?? null,
    outroDocumento,
});

/**
 * Resultado das consultas → situação.
 * @param {object} alvo
 * @param {object} porNumero retorno de lerRetornoPagamentos (ok=true) da consulta pelos números
 * @param {object|null} porPeriodo idem, pela data de arrecadação (ou null se não consultado)
 * @param {string} hoje 'AAAA-MM-DD'
 */
export function classificar(alvo, porNumero, porPeriodo, hoje) {
    const achado = (porNumero?.situacoes || []).find((s) => s.localizado && s.pagamento);
    if (achado) return { situacao: 'pago', pagamento: resumoPagamento(achado.pagamento, false), aviso: null };
    const outro = (porPeriodo?.documentos || []).find((d) => daCompetencia(d, alvo.competencia));
    if (outro) return { situacao: 'pago', pagamento: resumoPagamento(outro, true), aviso: 'Pago com outro documento (mesmo período de apuração).' };
    if (!passouCarencia(alvo, hoje)) return { situacao: 'aguardando', pagamento: null, aviso: null };
    const aviso = porPeriodo?.podeHaverMais
        ? 'A consulta por período voltou cheia (100 documentos): pode haver pagamento com outro número que não foi visto.'
        : null;
    return { situacao: 'nao_localizado', pagamento: null, aviso };
}

/** Documento a gravar em dp_darf_situacao (sem undefined). */
export function documentoSituacao(alvo, resultado, hoje, anterior = null) {
    return {
        cnpj: alvo.cnpj,
        competencia: alvo.competencia,
        empresaIdDp: alvo.empresaIdDp ?? null,
        numerosDocumento: alvo.numerosDocumento,
        vencimento: alvo.vencimento,
        valor: alvo.valor ?? null,
        situacao: resultado.situacao,
        pagamento: resultado.pagamento ?? null,
        aviso: resultado.aviso ?? null,
        conferidoEm: hoje,
        consultas: (Number(anterior?.consultas) || 0) + 1,
        erro: null,
    };
}

/** O que a rota devolve ao DP (as situações de um CNPJ, da competência mais recente para trás). */
export function situacoesParaDp(docs = [], limite = 12) {
    return docs
        .map((d) => ({
            competencia: d.competencia, numerosDocumento: d.numerosDocumento || [], vencimento: d.vencimento ?? null, valor: d.valor ?? null,
            situacao: d.situacao, pagamento: d.pagamento ?? null, aviso: d.aviso ?? null, conferidoEm: d.conferidoEm ?? null, erro: d.erro ?? null,
        }))
        .filter((d) => RE_COMP.test(String(d.competencia || '')))
        .sort((a, b) => b.competencia.localeCompare(a.competencia))
        .slice(0, limite);
}
