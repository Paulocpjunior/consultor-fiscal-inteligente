// ============================================================================
// sefaz-backend/nfse-sp-portal-client.js
// Cliente HTTP do portal nfe.prefeitura.sp.gov.br via mTLS (cert A1).
//
// SUBSTITUI o WS SOAP legacy (que devolvia erro 1102 desde a Reforma
// Tributária 2026). Replica EXATAMENTE o fluxo que o portal usa quando
// um humano clica "EXPORTAR ARQUIVO":
//   1. mTLS com cert A1 do escritório
//   2. GET /contribuinte/exportaarquivo.aspx → captura tokens ASP.NET
//   3. POST com form data → recebe CSV em ISO-8859-1
//
// Validado em produção: 1 login do escritório baixa CSV de TODAS as
// empresas que o escritório é contador (o dropdown ddlPrestador lista
// 200+ CCMs autorizadas).
// ============================================================================

import https from 'node:https';
import { loadCertificate } from './secret-loader.js';

const PORTAL_HOST = 'nfe.prefeitura.sp.gov.br';
const ENDPOINT_EXPORTAR = '/contribuinte/exportaarquivo.aspx';
const ENDPOINT_OPCOES = '/contribuinte/opcoes.aspx';
const USER_AGENT = 'Mozilla/5.0 (consultor-fiscal-inteligente/1.0)';

// IDs/names confirmados via inspeção do HTML real do portal (30/05/2026):
const FORM_FIELDS = {
    prestador: 'ctl00$body$ddlPrestador',
    guiasRadio: 'ctl00$body$Guias',
    dataInicio: 'ctl00$body$tbInicio',
    dataFim: 'ctl00$body$tbFim',
    naoCanceladas: 'ctl00$body$ckNaoCanceladas',
    tipoArquivo: 'ctl00$body$ddlTipoArquivo',  // 2 = CSV
    layoutArquivo: 'ctl00$body$ddlLayoutArquivo', // 6 = V.006
    botaoGerar: 'ctl00$body$btGerar',
};

const RADIO_VALUES = {
    emitidas: 'rbNotasEmitidas',
    recebidas: 'rbNotasRecebidas',
    rps: 'rbRPS',
    intermediadas: 'rbNotasIntermediadas',
};

// ─── HTTP utilities ─────────────────────────────────────────────────────────

function parseCookies(setCookieHeaders = []) {
    const cookies = {};
    for (const sc of setCookieHeaders) {
        const [pair] = String(sc).split(';');
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (name) cookies[name] = value;
    }
    return cookies;
}

function cookieJarToHeader(jar) {
    return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function mergeCookies(jar, setCookieHeaders) {
    const novos = parseCookies(setCookieHeaders);
    return { ...jar, ...novos };
}

function httpsRequest({ host, path, method, headers, body, pfxBuffer, password }) {
    return new Promise((resolve, reject) => {
        const reqOpts = {
            host, path, method,
            minVersion: 'TLSv1.2',
            rejectUnauthorized: true,
            headers: { 'User-Agent': USER_AGENT, ...(headers || {}) },
            timeout: 60000,
        };
        if (pfxBuffer) {
            reqOpts.pfx = pfxBuffer;
            reqOpts.passphrase = password;
        }

        const req = https.request(reqOpts, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode || 0,
                    headers: res.headers,
                    setCookies: res.headers['set-cookie'] || [],
                    body: Buffer.concat(chunks),
                });
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Portal SP: timeout')));
        if (body) req.write(body);
        req.end();
    });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Estabelece sessão no portal SP via mTLS. Retorna jar de cookies a usar
 * nas próximas chamadas.
 */
export async function loginPortalSp({ pfxBuffer, password } = {}) {
    // Se não passou cert, carrega o default (escritório)
    if (!pfxBuffer) {
        const cert = await loadCertificate();
        pfxBuffer = cert.pfxBuffer;
        password = cert.password;
    }
    // GET raiz com mTLS → portal autentica via cert e devolve cookies
    const res = await httpsRequest({
        host: PORTAL_HOST,
        path: ENDPOINT_OPCOES,
        method: 'GET',
        pfxBuffer, password,
    });
    if (res.statusCode === 302 || res.statusCode === 301) {
        // Segue redirect mantendo cookies
        const cookies = parseCookies(res.setCookies);
        return { cookies, statusCode: res.statusCode, location: res.headers.location };
    }
    if (res.statusCode !== 200) {
        throw new Error(`Portal SP login: HTTP ${res.statusCode}`);
    }
    const cookies = parseCookies(res.setCookies);
    if (!cookies['ASP.NET_SessionId']) {
        throw new Error('Portal SP login: sessão não estabelecida (sem ASP.NET_SessionId)');
    }
    return { cookies };
}

/**
 * GET /contribuinte/exportaarquivo.aspx → extrai tokens ASP.NET + lista
 * de prestadores autorizados (dropdown ddlPrestador).
 */
export async function carregarTelaExportacao({ cookies, pfxBuffer, password }) {
    const res = await httpsRequest({
        host: PORTAL_HOST,
        path: ENDPOINT_EXPORTAR,
        method: 'GET',
        headers: { Cookie: cookieJarToHeader(cookies) },
        pfxBuffer, password,
    });
    if (res.statusCode === 302 || res.statusCode === 301) {
        throw new Error(`Portal SP: sessão expirou (HTTP ${res.statusCode} redirect → ${res.headers.location})`);
    }
    if (res.statusCode !== 200) {
        throw new Error(`Portal SP exportaarquivo GET: HTTP ${res.statusCode}`);
    }
    // Atualiza cookies (servidor pode ter renovado SessionId)
    const novosCookies = mergeCookies(cookies, res.setCookies);
    const html = res.body.toString('latin1');

    const extrair = (id) => {
        const m = html.match(new RegExp(`id="${id}" value="([^"]+)"`));
        return m ? m[1] : null;
    };

    const tokens = {
        viewState: extrair('__VIEWSTATE'),
        viewStateGenerator: extrair('__VIEWSTATEGENERATOR'),
        eventValidation: extrair('__EVENTVALIDATION'),
    };
    if (!tokens.viewState || !tokens.eventValidation) {
        throw new Error('Portal SP: tokens ASP.NET não encontrados na resposta');
    }

    // Extrai prestadores (cada <option value="CCM">label</option> do dropdown)
    const dropdownMatch = html.match(/<select[^>]*name="ctl00\$body\$ddlPrestador"[^>]*>([\s\S]*?)<\/select>/);
    const prestadores = [];
    if (dropdownMatch) {
        const optRegex = /<option\s+(?:selected="selected"\s+)?value="([^"]+)"[^>]*>([^<]+)</g;
        let m;
        while ((m = optRegex.exec(dropdownMatch[1])) !== null) {
            const value = m[1].trim();
            const label = m[2].trim();
            if (!value) continue; // pula "Selecione o contribuinte..."
            // Extrai CCM e nome (label: "7.139.111-8 - S&P ASSESSORIA CONTABIL S/S")
            const labelMatch = label.match(/^([\d.\-]+)\s*-\s*(.+)$/);
            prestadores.push({
                value,
                ccm: labelMatch ? labelMatch[1].replace(/\D/g, '') : value,
                nome: labelMatch ? labelMatch[2].trim() : label,
            });
        }
    }

    return { tokens, prestadores, cookies: novosCookies };
}

/**
 * Faz o POST que dispara o download do CSV.
 *
 * @param {object} args
 * @param {object} args.cookies — jar atual
 * @param {object} args.tokens — { viewState, viewStateGenerator, eventValidation }
 * @param {string} args.prestadorValue — value do dropdown (geralmente o CCM sem formatação)
 * @param {string} args.tipo — 'emitidas' | 'recebidas' | 'rps' | 'intermediadas'
 * @param {string} args.dataInicio — formato 'DD/MM/YYYY'
 * @param {string} args.dataFim — formato 'DD/MM/YYYY'
 * @param {boolean} args.naoCanceladas — true = checkbox marcado (não exporta canceladas)
 * @param {Buffer} args.pfxBuffer
 * @param {string} args.password
 */
export async function baixarCsv({
    cookies,
    tokens,
    prestadorValue,
    tipo = 'emitidas',
    dataInicio,
    dataFim,
    naoCanceladas = false,
    pfxBuffer, password,
}) {
    const radioValue = RADIO_VALUES[tipo];
    if (!radioValue) throw new Error(`Tipo inválido: ${tipo}`);
    if (!prestadorValue) throw new Error('prestadorValue obrigatório');
    if (!dataInicio || !dataFim) throw new Error('dataInicio e dataFim obrigatórias (formato DD/MM/YYYY)');

    const params = new URLSearchParams();
    params.set('__EVENTTARGET', '');
    params.set('__EVENTARGUMENT', '');
    params.set('__VIEWSTATE', tokens.viewState);
    params.set('__VIEWSTATEGENERATOR', tokens.viewStateGenerator || '');
    params.set('__EVENTVALIDATION', tokens.eventValidation);
    params.set(FORM_FIELDS.prestador, prestadorValue);
    params.set(FORM_FIELDS.guiasRadio, radioValue);
    params.set(FORM_FIELDS.dataInicio, dataInicio);
    params.set(FORM_FIELDS.dataFim, dataFim);
    if (naoCanceladas) params.set(FORM_FIELDS.naoCanceladas, 'on');
    params.set(FORM_FIELDS.tipoArquivo, '2');     // CSV
    params.set(FORM_FIELDS.layoutArquivo, '6');   // V.006
    params.set(FORM_FIELDS.botaoGerar, 'Exportar Arquivo');

    const body = params.toString();
    const res = await httpsRequest({
        host: PORTAL_HOST,
        path: ENDPOINT_EXPORTAR,
        method: 'POST',
        headers: {
            Cookie: cookieJarToHeader(cookies),
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body),
            Referer: `https://${PORTAL_HOST}${ENDPOINT_EXPORTAR}`,
        },
        body,
        pfxBuffer, password,
    });

    const ct = String(res.headers['content-type'] || '').toLowerCase();
    const cd = String(res.headers['content-disposition'] || '');

    if (res.statusCode === 302 || res.statusCode === 301) {
        throw new Error(`Portal SP: sessão expirou no POST (redirect → ${res.headers.location})`);
    }
    if (res.statusCode !== 200) {
        throw new Error(`Portal SP exportar POST: HTTP ${res.statusCode}`);
    }
    if (!ct.includes('text/csv') && !cd.includes('.csv')) {
        // Resposta voltou HTML (erro de validação no form) — devolve trecho pra diagnóstico
        const html = res.body.toString('latin1').slice(0, 1500);
        throw new Error(`Portal SP não retornou CSV. Content-Type=${ct}. Body head: ${html.replace(/\s+/g, ' ').slice(0, 500)}`);
    }

    // Extrai filename do content-disposition
    const fileNameMatch = cd.match(/filename=([^;]+)/);
    const fileName = fileNameMatch ? fileNameMatch[1].trim() : `nfse-sp-${prestadorValue}.csv`;

    return {
        fileName,
        csv: res.body, // Buffer ISO-8859-1
        size: res.body.length,
        cookies: mergeCookies(cookies, res.setCookies),
    };
}

/**
 * Helper: formata Date pra "DD/MM/YYYY".
 */
export function fmtDataPt(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
}
