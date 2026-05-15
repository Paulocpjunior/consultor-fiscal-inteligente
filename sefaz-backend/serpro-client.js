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

const BASE_URL = process.env.SERPRO_BASE_URL || 'https://gateway.apiserpro.serpro.gov.br';
const OAUTH_URL = process.env.SERPRO_OAUTH_URL || `${BASE_URL}/oauth2/v1/token`;
const BASE_INVOKE = `${BASE_URL}/integra-contador/v1`;
const INVOKE_URL = `${BASE_INVOKE}/Consultar`;  // legacy default

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
        log('error', 'oauth_failed', { status: res.status, body: txt.slice(0, 500) });
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
                    'jwt_token': token,  // SERPRO exige duplicado em header próprio
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
                throw new Error(`${res.status}: ${bodyTxt.slice(0, 200)}`);
            }
            if (!res.ok) {
                // Erro de negócio (400, 403, etc): não vale retry, joga pra cima
                log('error', 'business_error', { status: res.status, body: bodyTxt.slice(0, 500) });
                throw new Error(`SERPRO ${res.status}: ${bodyTxt.slice(0, 500)}`);
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
            log('warn', 'invoke_attempt_failed', { attempt, error: err.message });
        }
    }
    log('error', 'invoke_exhausted_retries', { error: lastError?.message });
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
