// ============================================================================
// sefaz-backend/dp-fechamento-esocial.js  (selo do eSocial no semáforo da DCTFWeb)
// ----------------------------------------------------------------------------
// O Integra Contador NÃO tem consulta de fechamento do eSocial: ESOCIAL/
// CONSULTARFECHAMENTO devolve 400 [EntradaIncorreta-ICGERENCIADOR-052]
// "Valor inexistente no catálogo de serviços" (medido em produção em
// 13/10/2026). O selo nunca funcionou pelo SERPRO.
//
// A prova passa a ser o FECHAMENTO que o próprio Consultor DP transmitiu e
// registrou (Paulo, 13/10/2026: "pode seguir com o S-1299 no semáforo"):
// esocial_envios no Firestore do DP (services/esocial/transmissaoService.ts),
//   { empresaId, cnpj, tpAmb, situacao, enviadoEm,
//     eventos: [{ id, tipo: 'S-1299'|'S-1298'|…, perApur: 'AAAA-MM', cdResposta, nrRecibo }] }
//
// A leitura é feita COM O TOKEN DO USUÁRIO, pela REST do Firestore do DP — o
// mesmo padrão de dp-acesso-empresa.js: as regras do DP decidem (esocial_envios
// libera read/list para podeEmpresa(empresaId)); o CFI não tem acesso de
// servidor ao banco do DP. Nada do corpo da requisição entra aqui além do
// empresaId já conferido na carteira (confirmarEmpresaDaCarteiraDp).
//
// Régua (a mesma da Saúde do eSocial do DP, services/esocial/anomalias.ts):
//   · só produção (tpAmb 1) e só o empregador da DCTFWeb (raiz do CNPJ);
//   · S-1299 do perApur, lote processado e evento aceito (201/202 com recibo);
//   · S-1298 do mesmo perApur DEPOIS do último S-1299 aceito reabre o período e
//     derruba o selo — a não ser que tenha sido recusado (lote recusado/não
//     recebido ou evento com resposta e sem recibo);
//   · sem registro: pendente, com o motivo; leitura que falha: indeterminado.
// ============================================================================

import { PROJETO } from './require-cross-project-auth.js';

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJETO.dpFolha}/databases/(default)/documents`;

export const FONTE_FECHAMENTO_DP = 'Consultor DP (S-1299 transmitido e aceito no eSocial)';

const LOTE_PENDENTE = new Set(['transmitindo', 'sem-resposta', 'enviado', 'em-processamento']);
const LOTE_NAO_CHEGOU = new Set(['recusado', 'nao-recebido']);

const digitos = (s) => String(s ?? '').replace(/\D/g, '');
const semResposta = (ev) => ev?.cdResposta === undefined || ev?.cdResposta === null;
const aceito = (ev) => !!ev?.nrRecibo && (Number(ev?.cdResposta) === 201 || Number(ev?.cdResposta) === 202);
const mesAno = (competencia) => `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;

/** Valor da REST do Firestore ({ stringValue }, { mapValue }…) → valor JS. */
export function valorFirestore(v) {
    if (!v || typeof v !== 'object') return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue?.values || []).map(valorFirestore);
    if ('mapValue' in v) {
        const out = {};
        for (const [k, x] of Object.entries(v.mapValue?.fields || {})) out[k] = valorFirestore(x);
        return out;
    }
    return null;
}

/**
 * Fechamento do eSocial da competência pelos envios do DP (núcleo PURO).
 * Devolve o formato que seloEsocial lê: { ok, entregue, situacao, dataEntrega, nrRecibo?, motivo? }.
 */
export function avaliarFechamentoEsocial(envios, { cnpj, competencia }) {
    const raiz = digitos(cnpj).slice(0, 8);
    const eventos = [];
    for (const env of Array.isArray(envios) ? envios : []) {
        if (Number(env?.tpAmb) !== 1) continue;
        if (raiz.length !== 8 || digitos(env?.cnpj).slice(0, 8) !== raiz) continue;
        const quando = Date.parse(String(env?.enviadoEm || ''));
        (Array.isArray(env?.eventos) ? env.eventos : []).forEach((ev, i) => {
            if (ev?.perApur !== competencia || (ev?.tipo !== 'S-1299' && ev?.tipo !== 'S-1298')) return;
            // Sem data de envio: conta como o mais recente (o lado conservador).
            eventos.push({ env, ev, t: Number.isFinite(quando) ? quando : Infinity, i });
        });
    }
    eventos.sort((a, b) => (a.t - b.t) || (a.i - b.i));

    const fechou = (x) => x.ev.tipo === 'S-1299' && x.env.situacao === 'processado' && aceito(x.ev);
    const reabriu = (x) => x.ev.tipo === 'S-1298' && !LOTE_NAO_CHEGOU.has(x.env.situacao) && (aceito(x.ev) || semResposta(x.ev));
    let ultimo = -1;
    eventos.forEach((x, k) => { if (fechou(x)) ultimo = k; });

    if (ultimo < 0) {
        const aguardando = eventos.some((x) => x.ev.tipo === 'S-1299' && LOTE_PENDENTE.has(x.env.situacao) && semResposta(x.ev));
        return aguardando
            ? { ok: true, entregue: false, situacao: 'S1299_SEM_RESULTADO', dataEntrega: null,
                motivo: `O S-1299 de ${mesAno(competencia)} saiu pelo Consultor DP e ainda não tem o resultado do eSocial (veja a Saúde do eSocial).` }
            : { ok: true, entregue: false, situacao: 'SEM_S1299', dataEntrega: null,
                motivo: `Fechamento do eSocial (S-1299) não encontrado no DP para ${mesAno(competencia)}.` };
    }
    if (eventos.slice(ultimo + 1).some(reabriu)) {
        return { ok: true, entregue: false, situacao: 'REABERTO_S1298', dataEntrega: null,
            motivo: `${mesAno(competencia)} foi reaberta por S-1298 depois do fechamento: transmita o S-1299 de novo antes da DCTFWeb.` };
    }
    const f = eventos[ultimo];
    return {
        ok: true, entregue: true, situacao: 'S1299_ACEITO',
        dataEntrega: typeof f.env.enviadoEm === 'string' && f.env.enviadoEm ? f.env.enviadoEm.slice(0, 10) : null,
        nrRecibo: String(f.ev.nrRecibo),
    };
}

/**
 * Lê esocial_envios da empresa no Firestore do DP com o token do usuário (as
 * regras do DP decidem). Lança Error com o motivo quando a leitura falha.
 * `fetchImpl` é injetável para teste.
 */
export async function lerEnviosEsocialDp({ token, empresaId, fetchImpl = fetch }) {
    if (!token) throw new Error('sem o token do usuário do Consultor DP');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(empresaId || ''))) throw new Error('empresa do Consultor DP não informada');
    const campos = ['empresaId', 'cnpj', 'tpAmb', 'situacao', 'eventos', 'enviadoEm'];
    const r = await fetchImpl(`${BASE}:runQuery`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId: 'esocial_envios' }],
                where: { fieldFilter: { field: { fieldPath: 'empresaId' }, op: 'EQUAL', value: { stringValue: String(empresaId) } } },
                select: { fields: campos.map((fieldPath) => ({ fieldPath })) },
            },
        }),
    });
    if (r.status === 403) throw new Error('as regras do Consultor DP não liberaram a leitura dos envios do eSocial desta empresa (HTTP 403)');
    if (!r.ok) throw new Error(`leitura dos envios do eSocial no Consultor DP falhou (HTTP ${r.status})`);
    const linhas = await r.json();
    return (Array.isArray(linhas) ? linhas : [])
        .filter((l) => l?.document?.fields)
        .map((l) => valorFirestore({ mapValue: { fields: l.document.fields } }));
}

/** Leitura + avaliação. Nunca lança: falha de leitura volta ok:false (selo indeterminado). */
export async function consultarFechamentoEsocialDp({ token, empresaId, cnpj, competencia, fetchImpl }) {
    try {
        const envios = await lerEnviosEsocialDp({ token, empresaId, fetchImpl });
        return { ...avaliarFechamentoEsocial(envios, { cnpj, competencia }), fonte: FONTE_FECHAMENTO_DP };
    } catch (err) {
        return { ok: false, entregue: false, situacao: 'indisponivel', dataEntrega: null, erro: `envios do eSocial no Consultor DP: ${err?.message || err}`, fonte: FONTE_FECHAMENTO_DP };
    }
}

/**
 * Sem o token do DP (tela do CFI): o registro do fechamento não é lido daqui.
 * Indeterminado com o motivo — nunca "recebido" nem "pendente" sem ter lido.
 */
export function fechamentoSemLeituraDoDp() {
    return {
        ok: false, entregue: false, situacao: 'sem_leitura_dp', dataEntrega: null,
        erro: 'o fechamento (S-1299) é registrado no Consultor DP e só é lido com o login do DP: confira na DCTFWeb da folha, no Consultor DP',
        fonte: FONTE_FECHAMENTO_DP,
    };
}
