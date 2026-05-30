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
// LoginICP é o endpoint de autenticação via cert ICP-Brasil. Confirmado
// via inspeção do fluxo no Safari (DevTools mostrou LoginICP.aspx como 1ª request).
const ENDPOINT_LOGIN_ICP = '/LoginICP.aspx';
// User-Agent de Safari real — alguns portais governamentais rejeitam
// agentes não-padronizados retornando HTML genérico em vez do redirect.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15';

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
 * Carrega cookies de sessão salvos manualmente pelo admin via UI.
 * Validades típicas: PMSP_NFeID dura algumas horas; admin renova quando expirar.
 */
export async function loadSessaoManual() {
    const admin = (await import('firebase-admin')).default;
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    const db = admin.firestore();
    const snap = await db.collection('nfsesp_portal_session').doc('cookies').get();
    if (!snap.exists) {
        throw new Error('Cookies do portal SP não cadastrados. Admin precisa colar via UI > 🛰️ Captura Automática > Cookies Portal SP.');
    }
    const data = snap.data();
    const expira = data.expiraEm?.toMillis?.() ?? 0;
    if (expira && expira < Date.now()) {
        throw new Error('Cookies do portal SP expiraram. Admin precisa renovar via UI.');
    }
    if (!data.cookies || !data.cookies['PMSP_NFeID']) {
        throw new Error('Cookies salvos não têm PMSP_NFeID — formato inválido.');
    }
    return { cookies: data.cookies, atualizadoEm: data.atualizadoEm, expiraEm: data.expiraEm };
}

/**
 * Salva cookies da sessão do portal (recebe string raw "k=v; k=v; ..."
 * que o admin copia do DevTools).
 */
export async function saveSessaoManual(cookieString, importadoPor) {
    const admin = (await import('firebase-admin')).default;
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    const cookies = {};
    for (const pair of String(cookieString || '').split(';')) {
        const [k, ...rest] = pair.split('=');
        const key = k?.trim();
        const value = rest.join('=').trim();
        if (key && value) cookies[key] = value;
    }
    if (!cookies['PMSP_NFeID']) {
        throw new Error('Cookie PMSP_NFeID não encontrado. Copie da aba Rede do DevTools após login.');
    }
    // PMSP_NFeID dura ~3h no portal. Marca expira em 2h pra ter margem.
    const expiraEm = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const db = admin.firestore();
    await db.collection('nfsesp_portal_session').doc('cookies').set({
        cookies,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        atualizadoPor: importadoPor || 'admin',
        expiraEm: admin.firestore.Timestamp.fromDate(expiraEm),
    });
    return { ok: true, cookiesNomes: Object.keys(cookies), expiraEm: expiraEm.toISOString() };
}

/**
 * Estabelece sessão no portal SP via cert ICP-Brasil.
 *
 * Fluxo confirmado por inspeção em browser:
 *   1. GET /LoginICP.aspx COM cert mTLS → portal valida cert → 302 redirect
 *      + Set-Cookie PMSP_NFeID, PMSP_NFE_CPFCNPJ, ASP.NET_SessionId
 *   2. GET /contribuinte/opcoes.aspx COM os cookies → 200 OK (sessão ativa)
 *
 * Retorna jar de cookies a usar nas próximas chamadas.
 */
export async function loginPortalSp({ pfxBuffer, password } = {}) {
    // Se não passou cert, carrega o default (escritório)
    if (!pfxBuffer) {
        const cert = await loadCertificate();
        pfxBuffer = cert.pfxBuffer;
        password = cert.password;
    }

    // PASSO 0: GET na home pra inicializar SessionId anônimo
    const resHome = await httpsRequest({
        host: PORTAL_HOST,
        path: '/',
        method: 'GET',
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9',
        },
        pfxBuffer, password,
    });
    let cookies = parseCookies(resHome.setCookies);
    console.log(`[nfsesp-portal] home GET status=${resHome.statusCode}, cookies=${Object.keys(cookies).join(',')}`);

    // PASSO 1: GET em /LoginICP.aspx com mTLS + cookies — portal autentica
    const resLogin = await httpsRequest({
        host: PORTAL_HOST,
        path: ENDPOINT_LOGIN_ICP,
        method: 'GET',
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9',
            'Referer': `https://${PORTAL_HOST}/`,
            'Cookie': cookieJarToHeader(cookies),
        },
        pfxBuffer, password,
    });

    // Coleta cookies (LoginICP geralmente retorna 302 com Set-Cookie)
    cookies = mergeCookies(cookies, resLogin.setCookies);
    console.log(`[nfsesp-portal] LoginICP status=${resLogin.statusCode}, cookies=${Object.keys(cookies).join(',')}`);

    if (!cookies['PMSP_NFeID']) {
        // Se PMSP_NFeID não veio, login falhou — provavelmente cert não autorizado
        const bodyHead = resLogin.body.toString('latin1').slice(0, 800).replace(/\s+/g, ' ');
        const locationHdr = resLogin.headers.location || '';
        throw new Error(`Portal SP LoginICP: PMSP_NFeID não retornado (HTTP ${resLogin.statusCode}, location=${locationHdr}). Cookies recebidos: ${Object.keys(cookies).join(',') || '(nenhum)'}. Body head: ${bodyHead.slice(0, 400)}`);
    }

    // Se houve redirect, segue ele pra estabelecer sessão completa
    if (resLogin.statusCode === 302 || resLogin.statusCode === 301) {
        const loc = resLogin.headers.location || ENDPOINT_OPCOES;
        const path = loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : loc;
        const resRedirect = await httpsRequest({
            host: PORTAL_HOST,
            path,
            method: 'GET',
            headers: { Cookie: cookieJarToHeader(cookies) },
            pfxBuffer, password,
        });
        cookies = mergeCookies(cookies, resRedirect.setCookies);
    }

    if (!cookies['ASP.NET_SessionId']) {
        throw new Error('Portal SP login: ASP.NET_SessionId não estabelecido após redirect');
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
