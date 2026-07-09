// ============================================================================
// sefaz-backend/serpro-client.js
//
// Lib transversal para o Integra Contador SERPRO.
// Suporta:
//   - OAuth2 client credentials com cache de token (TTL respeitado)
//   - Chamada POST /Consultar com payload padrão (contratante/autor/contribuinte)
//   - Retry com exponential backoff (4s → 8s → 16s)
//   - Modo SERPRO_DRY_RUN=1 pra desenvolvimento sem chamar API real
//   - Logging estruturado JSON
//
// Configuração via env vars:
//   SERPRO_BASE_URL          (default: https://gateway.apiserpro.serpro.gov.br)
//   SERPRO_OAUTH_URL         (default: <base>/oauth2/v1/token)
//   SERPRO_CONSUMER_KEY      (obrigatória pra modo real)
//   SERPRO_CONSUMER_SECRET   (obrigatória pra modo real)
//   SERPRO_CONTRATANTE_CNPJ  (CNPJ SP Contábil — contratante do Integra)
//   SERPRO_AUTOR_CNPJ        (default: igual a contratante)
//   SERPRO_DRY_RUN=1         (não chama API; loga e retorna response simulado)
//
// Uso típico:
//   import { invokeIntegraContador } from './serpro-client.js';
//   const result = await invokeIntegraContador({
//       idSistema: 'PGDASD',
//       idServico: 'GERARDAS21',
//       contribuinteCnpj: '12345678000190',
//       dados: { periodoApuracao: '202504' },
//   });
// ============================================================================

import { Agent } from 'undici';
import { loadCertificate } from './secret-loader.js';
import { createSerproRetryableError } from './serpro-error-utils.js';

const BASE_URL = process.env.SERPRO_BASE_URL || 'https://gateway.apiserpro.serpro.gov.br';
const OAUTH_URL = process.env.SERPRO_OAUTH_URL || `${BASE_URL}/token`;
const BASE_INVOKE = process.env.SERPRO_BASE_INVOKE || `${BASE_URL}/integra-contador/v1`;
const INVOKE_URL = `${BASE_INVOKE}/Consultar`;  // legacy default

// ─── Modo OAuth ───────────────────────────────────────────────────────────
// 'mtls': /authenticate com cert digital do escritorio (PROD real)
// 'basic': /token sem cert (TRIAL only)
const OAUTH_MODE = process.env.SERPRO_OAUTH_MODE || 'mtls';
const OAUTH_URL_MTLS = process.env.SERPRO_OAUTH_URL_MTLS
    || 'https://autenticacao.sapi.serpro.gov.br/authenticate';

// undici Dispatcher reutilizado por chamadas mTLS (recreate quando cert muda)
let mtlsDispatcherCache = { dispatcher: null, certVersion: null };

async function getMtlsDispatcher() {
    const cert = await loadCertificate();
    if (mtlsDispatcherCache.dispatcher && mtlsDispatcherCache.certVersion === cert.version) {
        return mtlsDispatcherCache.dispatcher;
    }
    if (!cert.pemKey || !cert.pemCert) {
        throw new Error(
            'Cert digital ICP-Brasil do escritorio precisa estar configurado em ' +
            'Configuracoes > Certificado Digital pra autenticacao SERPRO mTLS.'
        );
    }
    const dispatcher = new Agent({
        connect: {
            key: cert.pemKey,
            cert: cert.pemCert,
            rejectUnauthorized: true,
        },
    });
    mtlsDispatcherCache = { dispatcher, certVersion: cert.version };
    log('info', 'mtls_dispatcher_created', { certVersion: cert.version });
    return dispatcher;
}


function urlPorAcao(acao) {
    const acoesValidas = ['Consultar', 'Declarar', 'Emitir', 'Apoiar', 'Monitorar'];
    if (!acoesValidas.includes(acao)) throw new Error(`Acao invalida: ${acao}`);
    return `${BASE_INVOKE}/${acao}`;
}

const CONSUMER_KEY = process.env.SERPRO_CONSUMER_KEY || '';
const CONSUMER_SECRET = process.env.SERPRO_CONSUMER_SECRET || '';
const CONTRATANTE_CNPJ = (process.env.SERPRO_CONTRATANTE_CNPJ || '').replace(/\D/g, '');
const AUTOR_CNPJ = (process.env.SERPRO_AUTOR_CNPJ || CONTRATANTE_CNPJ).replace(/\D/g, '');
const DRY_RUN = process.env.SERPRO_DRY_RUN === '1';

// ─── Token cache em memória ───────────────────────────────────────────────
let tokenCache = { token: null, expiresAt: 0 };

function parseMaybeJson(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    try { return JSON.parse(trimmed); }
    catch { return value; }
}

function parseSerproBody(body) {
    const parsed = parseMaybeJson(body);
    if (parsed && typeof parsed === 'object' && typeof parsed.dados === 'string') {
        return { ...parsed, dados: parseMaybeJson(parsed.dados) };
    }
    return parsed;
}

function normalizeSerproMessage(msg) {
    if (!msg) return null;
    if (typeof msg === 'string') return { texto: msg };
    if (typeof msg !== 'object') return { texto: String(msg) };
    const texto = msg.texto || msg.mensagem || msg.message || msg.descricao || msg.detail || '';
    const codigo = msg.codigo || msg.code || msg.codMensagem || msg.id || '';
    if (!texto && !codigo) return null;
    return { codigo, texto: texto || codigo };
}

function extractSerproMessages(parsed) {
    const body = parseSerproBody(parsed);
    const candidates = [
        body?.mensagens,
        body?.messages,
        body?.erros,
        body?.errors,
        body?.dados?.mensagens,
        body?.dados?.messages,
        body?.dados?.erros,
        body?.dados?.errors,
    ];
    const messages = [];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const list = Array.isArray(candidate) ? candidate : [candidate];
        for (const item of list) {
            const normalized = normalizeSerproMessage(item);
            if (normalized) messages.push(normalized);
        }
    }
    return messages;
}

function formatSerproBusinessMessage(status, body) {
    const parsed = parseSerproBody(body);
    const messages = extractSerproMessages(parsed);
    if (messages.length > 0) {
        return `SERPRO ${status}: ${messages.map((m) => (
            m.codigo ? `${m.codigo} - ${m.texto}` : m.texto
        )).join('; ')}`;
    }
    return `SERPRO ${status}: requisicao recusada por regra de negocio. Consulte o log estruturado da chamada.`;
}

function maskCnpj(cnpj) {
    const clean = String(cnpj || '').replace(/\D/g, '');
    if (clean.length !== 14) return '';
    return `${clean.slice(0, 2)}**********${clean.slice(-2)}`;
}

// Redige dados sensíveis do contribuinte antes de logar o corpo cru do SERPRO:
// CNPJ/CPF (11-14 díg) e sequências longas de dígitos (valores, recibos). Só
// pra diagnóstico — nunca deixa o dado bruto no Cloud Logging (varredura 09/07).
function redigirCorpo(txt) {
    return String(txt || '')
        .replace(/\b\d{11,14}\b/g, '«id»')
        .replace(/\b\d{4,}\b/g, '«num»');
}

// Erro de negocio do SERPRO (4xx que nao seja 401/429): retry NAO resolve.
// Sinaliza ao loop de retry que deve abortar imediatamente.
class SerproBusinessError extends Error {
    constructor(status, body) {
        super(formatSerproBusinessMessage(status, body));
        this.name = 'SerproBusinessError';
        this.status = status;
        this.httpStatus = status;
        this.code = 'SERPRO_BUSINESS_ERROR';
        this.serproBody = body;
        this.serproResponse = parseSerproBody(body);
        this.serproMessages = extractSerproMessages(this.serproResponse);
        this.serproMessage = this.message;
    }
}

function log(level, msg, extra = {}) {
    // Logging estruturado JSON pra Cloud Logging parsear bem.
    console.log(JSON.stringify({
        ts: new Date().toISOString(),
        level,
        component: 'serpro-client',
        msg,
        ...extra,
    }));
}

function assertCredentialsConfigured() {
    if (DRY_RUN) return;
    if (!CONSUMER_KEY || !CONSUMER_SECRET) {
        throw new Error(
            'SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET são obrigatórias. ' +
            'Configure via env var ou ative SERPRO_DRY_RUN=1 pra dev sem credenciais.'
        );
    }
    if (!CONTRATANTE_CNPJ || CONTRATANTE_CNPJ.length !== 14) {
        throw new Error('SERPRO_CONTRATANTE_CNPJ obrigatória (14 dígitos).');
    }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── OAuth2 client credentials ────────────────────────────────────────────

export async function getAccessToken() {
    if (DRY_RUN) return 'dry-run-token';

    const now = Date.now();
    // Reusa token se ainda válido (com 1min de margem)
    if (tokenCache.token && now < tokenCache.expiresAt - 60_000) {
        return tokenCache.token;
    }

    assertCredentialsConfigured();

    const basic = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');

    // ─── Modo mTLS: /authenticate com cert digital ICP-Brasil (PROD real) ───
    if (OAUTH_MODE === 'mtls') {
        const dispatcher = await getMtlsDispatcher();
        log('info', 'requesting_oauth_token_mtls', { url: OAUTH_URL_MTLS });
        const resMtls = await fetch(OAUTH_URL_MTLS, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basic}`,
                'role-type': 'TERCEIROS',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
            dispatcher,
        });

        if (!resMtls.ok) {
            const txtMtls = await resMtls.text().catch(() => '');
            log('error', 'oauth_mtls_failed', { status: resMtls.status, body: redigirCorpo(txtMtls.slice(0, 500)) });
            throw new Error(`SERPRO OAuth mTLS falhou ${resMtls.status}: ${txtMtls.slice(0, 200)}`);
        }
        const dataMtls = await resMtls.json();
        tokenCache = {
            token: dataMtls.access_token,
            jwtToken: dataMtls.jwt_token || null,
            expiresAt: now + (dataMtls.expires_in * 1000),
        };
        log('info', 'oauth_token_cached_mtls', {
            expires_in: dataMtls.expires_in,
            hasJwtToken: !!dataMtls.jwt_token,
        });
        return tokenCache.token;
    }

    // ─── Modo basic: /token sem cert (TRIAL only) ───────────────────────────
    log('info', 'requesting_oauth_token', { url: OAUTH_URL });

    const res = await fetch(OAUTH_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        log('error', 'oauth_failed', { status: res.status, body: redigirCorpo(txt.slice(0, 500)) });
        throw new Error(`SERPRO OAuth falhou ${res.status}: ${txt.slice(0, 200)}`);
    }

    const data = await res.json();
    tokenCache = {
        token: data.access_token,
        expiresAt: now + (data.expires_in || 3600) * 1000,
    };
    log('info', 'oauth_token_cached', { expires_in: data.expires_in });
    return tokenCache.token;
}

// ─── Invocação do Integra Contador ────────────────────────────────────────

/**
 * Chama o endpoint /Consultar do Integra Contador.
 *
 * @param {object} req
 * @param {string} req.idSistema         Ex: 'PGDASD', 'CAIXAPOSTAL', 'NFSE'
 * @param {string} req.idServico         Ex: 'GERARDAS21', 'OBTERLISTAMSGS53'
 * @param {string} req.contribuinteCnpj  CNPJ da empresa cliente (14 dígitos)
 * @param {object} req.dados             Payload específico do serviço
 * @param {string} [req.versaoSistema='1.0']
 *
 * @returns {Promise<object>} { status, dados (objeto JSON parseado), mensagens }
 */
// Retorna o jwt_token do cache (capturado durante getAccessToken em modo mTLS).
// Se cache esta vazio ou em DRY_RUN, chama getAccessToken pra popular.
export async function getJwtToken() {
    if (DRY_RUN) return 'dry-run-jwt';
    if (!tokenCache.jwtToken) {
        await getAccessToken();  // popula cache, incluindo jwtToken
    }
    return tokenCache.jwtToken || null;
}

export async function invokeIntegraContador(req) {
    const { idSistema, idServico, contribuinteCnpj, dados, versaoSistema = '1.0', acao = 'Consultar' } = req;
    if (!idSistema || !idServico) throw new Error('idSistema e idServico obrigatórios');
    if (!contribuinteCnpj) throw new Error('contribuinteCnpj obrigatório');

    const cnpjLimpo = String(contribuinteCnpj).replace(/\D/g, '');
    if (cnpjLimpo.length !== 14) throw new Error(`contribuinteCnpj inválido: ${contribuinteCnpj}`);

    // Modo dry-run pra desenvolvimento sem credenciais
    if (DRY_RUN) {
        log('info', 'dry_run_invoke', { idSistema, idServico, contribuinteCnpj: cnpjLimpo });
        return {
            status: 200,
            dados: { _dryRun: true, idSistema, idServico, params: dados },
            mensagens: [{ codigo: 'DRY-RUN', texto: 'Resposta simulada (SERPRO_DRY_RUN=1)' }],
        };
    }

    assertCredentialsConfigured();

    const payload = {
        contratante: { numero: CONTRATANTE_CNPJ, tipo: 2 },     // tipo 2 = CNPJ
        autorPedidoDados: { numero: AUTOR_CNPJ, tipo: 2 },
        contribuinte: { numero: cnpjLimpo, tipo: 2 },
        pedidoDados: {
            idSistema,
            idServico,
            versaoSistema,
            dados: JSON.stringify(dados || {}),  // SERPRO exige `dados` como string JSON
        },
    };

    // Retry com backoff: 4s → 8s → 16s. Total ~30s no pior caso.
    const delays = [0, 4_000, 8_000, 16_000];
    let lastError;
    for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt] > 0) {
            log('warn', 'retry_attempt', { attempt, delay: delays[attempt] });
            await sleep(delays[attempt]);
        }
        try {
            const token = await getAccessToken();
            const res = await fetch(urlPorAcao(acao), {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'jwt_token': tokenCache.jwtToken || token,  // jwt_token retornado pela SAPI (mTLS) ou fallback ao Bearer
                },
                body: JSON.stringify(payload),
            });

            const bodyTxt = await res.text();

            // 401 → token expirou; invalida cache e refaz
            if (res.status === 401) {
                tokenCache = { token: null, expiresAt: 0 };
                throw new Error(`401: token inválido; refazendo`);
            }
            // 429 / 5xx → retry
            if (res.status === 429 || res.status >= 500) {
                const retryErr = createSerproRetryableError(res.status, bodyTxt, {
                    idSistema,
                    idServico,
                    acao,
                    contribuinteCnpj: maskCnpj(cnpjLimpo),
                });
                log('warn', 'upstream_retryable_error', {
                    status: res.status,
                    idSistema,
                    idServico,
                    acao,
                    contribuinteCnpj: maskCnpj(cnpjLimpo),
                    bodyHash: retryErr.serproBodyHash,
                    bodyBytes: retryErr.serproBodyBytes,
                });
                throw retryErr;
            }
            if (!res.ok) {
                // Erro de negócio (400, 403, etc): retry NÃO resolve.
                // Lança SerproBusinessError — o catch abaixo aborta o loop.
                const parsedBody = parseSerproBody(bodyTxt);
                const mensagens = extractSerproMessages(parsedBody);
                log('error', 'business_error', {
                    status: res.status,
                    idSistema,
                    idServico,
                    acao,
                    contribuinteCnpj: maskCnpj(cnpjLimpo),
                    mensagens,
                    bodyPreview: mensagens.length ? undefined : redigirCorpo(bodyTxt.slice(0, 500)),
                });
                throw new SerproBusinessError(res.status, bodyTxt);
            }

            const body = JSON.parse(bodyTxt);
            // SERPRO retorna dados como string JSON aninhado — desserializa pra conveniência
            let dadosParsed = body.dados;
            if (typeof dadosParsed === 'string') {
                try { dadosParsed = JSON.parse(dadosParsed); }
                catch { /* mantém string se não for JSON */ }
            }
            log('info', 'invoke_success', { idSistema, idServico, status: body.status });
            return {
                status: body.status || res.status,
                dados: dadosParsed,
                mensagens: body.mensagens || [],
            };
        } catch (err) {
            lastError = err;
            // Erro de negocio (403/400 etc): retry nao muda o resultado — aborta ja.
            if (err instanceof SerproBusinessError) {
                log('warn', 'invoke_business_abort', { status: err.status });
                throw err;
            }
            log('warn', 'invoke_attempt_failed', {
                attempt,
                idSistema,
                idServico,
                acao,
                error: err.message,
                code: err.code,
                status: err.status,
            });
        }
    }
    log('error', 'invoke_exhausted_retries', {
        idSistema,
        idServico,
        acao,
        error: lastError?.message,
        code: lastError?.code,
        status: lastError?.status,
    });
    throw lastError || new Error('SERPRO: todas as tentativas falharam');
}

// ─── Utilidades exportadas ────────────────────────────────────────────────

export function getSerproConfig() {
    return {
        baseUrl: BASE_URL,
        dryRun: DRY_RUN,
        hasCredentials: !!(CONSUMER_KEY && CONSUMER_SECRET),
        contratanteCnpj: CONTRATANTE_CNPJ ? '***configured***' : '(not set)',
    };
}

export function _resetTokenCacheForTests() {
    tokenCache = { token: null, expiresAt: 0 };
}
