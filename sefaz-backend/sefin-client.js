// ============================================================================
// sefaz-backend/sefin-client.js
//
// Cliente HTTP mTLS pra API Sefin Nacional / ADN (NFSe Padrão Nacional).
//
// Autenticação: certificado A1 ICP-Brasil por empresa (NÃO do escritório).
//
// Endpoints base (configurados via env SEFIN_BASE_URL e SEFIN_ADN_URL):
//   - sefin.producaorestrita.nfse.gov.br  (homologação)
//   - sefin.nfse.gov.br                   (produção)
//
//   - adn.producaorestrita.nfse.gov.br    (consumo DFe restrita)
//   - adn.nfse.gov.br                     (consumo DFe produção)
//
// Funções principais:
//   - getEmpresaDispatcher(empresaId) - retorna Agent mTLS com cert da empresa
//   - consumirDFe(empresaId, ultimoNSU) - GET /contribuintes/DFe/{nsu}
//   - consultarNfsePorChave(empresaId, chave) - GET /contribuintes/NFSe/{chave}
//   - consultarEventos(empresaId, chave) - GET /contribuintes/NFSe/{chave}/Eventos
//
// Modo dry-run: SEFIN_DRY_RUN=1 retorna respostas mock sem chamar API.
// ============================================================================

import { Agent, request as undiciRequest } from 'undici';
import forge from 'node-forge';
import { loadCertEmpresa } from './cert-storage.js';
import { loadCertificate as loadCertEscritorio } from './secret-loader.js';

const SEFIN_BASE_URL = process.env.SEFIN_BASE_URL || 'https://sefin.producaorestrita.nfse.gov.br';
const SEFIN_ADN_URL = process.env.SEFIN_ADN_URL || 'https://adn.producaorestrita.nfse.gov.br';
const DRY_RUN = process.env.SEFIN_DRY_RUN === '1';

// ─── Cache de dispatchers mTLS por empresaId ──────────────────────────────
// TTL 60min — recarrega cert do Storage só depois disso.
const dispatcherCache = new Map(); // empresaId -> { dispatcher, expiresAt, cnpj }
const DISPATCHER_TTL_MS = 60 * 60 * 1000;

// ─── Logging estruturado JSON ─────────────────────────────────────────────
function log(level, msg, extra = {}) {
    console.log(JSON.stringify({
        ts: new Date().toISOString(),
        level,
        component: 'sefin-client',
        msg,
        ...extra,
    }));
}

// ─── Converte .pfx em PEM (key + cert) ────────────────────────────────────
function pfxToPem(pfxBuffer, password) {
    const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    let pemKey = null;
    let pemCert = null;

    // Extrai chave privada
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0];
    if (!keyBag) throw new Error('Chave privada não encontrada no .pfx');
    pemKey = forge.pki.privateKeyToPem(keyBag.key);

    // Extrai certificado
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag][0];
    if (!certBag) throw new Error('Certificado não encontrado no .pfx');
    pemCert = forge.pki.certificateToPem(certBag.cert);

    return { pemKey, pemCert };
}

// ─── Obtém Agent mTLS pra empresa específica ──────────────────────────────
export async function getEmpresaDispatcher(empresaId) {
    if (!empresaId) throw new Error('empresaId obrigatório');

    const now = Date.now();
    const cached = dispatcherCache.get(empresaId);
    if (cached && now < cached.expiresAt) {
        return { dispatcher: cached.dispatcher, cnpj: cached.cnpj };
    }

    let cert = await loadCertEmpresa(empresaId);
    let certSource = 'empresa-storage';

    if (!cert) {
        // Fallback: tenta cert do escritorio (Secret Manager legacy)
        // Usado pra empresas que ainda nao tem cert proprio carregado pela UI.
        try {
            const certEsc = await loadCertEscritorio();
            cert = {
                pfxBuffer: certEsc.pfxBuffer,
                password: certEsc.password,
                cnpj: certEsc.cnpj || 'cert-escritorio',
            };
            certSource = 'escritorio-secretmanager';
            log('info', 'fallback_cert_escritorio', { empresaId, cnpj: cert.cnpj });
        } catch (e) {
            throw new Error(`Certificado A1 não encontrado para empresa ${empresaId} (nem no Storage nem no Secret Manager): ${e.message}`);
        }
    }

    const { pemKey, pemCert } = pfxToPem(cert.pfxBuffer, cert.password);

    const dispatcher = new Agent({
        connect: {
            key: pemKey,
            cert: pemCert,
            rejectUnauthorized: true,
        },
        keepAliveTimeout: 30000,
        keepAliveMaxTimeout: 60000,
    });

    dispatcherCache.set(empresaId, {
        dispatcher,
        expiresAt: now + DISPATCHER_TTL_MS,
        cnpj: cert.cnpj,
    });

    log('info', 'dispatcher_created', { empresaId, cnpj: cert.cnpj, certSource });
    return { dispatcher, cnpj: cert.cnpj };
}

// ─── Invalida cache pra forçar reload (após upload de novo cert) ──────────
export function invalidateEmpresaDispatcher(empresaId) {
    dispatcherCache.delete(empresaId);
    log('info', 'dispatcher_invalidated', { empresaId });
}

// ─── HTTP request mTLS genérico ───────────────────────────────────────────
async function sefinRequest({ empresaId, method, url, body, headers = {}, timeoutMs = 30000 }) {
    if (DRY_RUN) {
        log('info', 'dry_run_skip', { empresaId, method, url });
        return { status: 200, body: { dryRun: true, mock: true }, headers: {} };
    }

    const { dispatcher } = await getEmpresaDispatcher(empresaId);

    const t0 = Date.now();
    try {
        const res = await undiciRequest(url, {
            method,
            dispatcher,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'SP-Assessoria-NFSe-Tomada/1.0',
                ...headers,
            },
            body: body ? JSON.stringify(body) : undefined,
            bodyTimeout: timeoutMs,
            headersTimeout: timeoutMs,
        });

        const text = await res.body.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { parsed = text; }

        log(res.statusCode === 200 ? 'info' : 'warn', 'sefin_response', {
            empresaId, method, url,
            status: res.statusCode,
            durationMs: Date.now() - t0,
            bodyLength: text.length,
            bodyPreview: res.statusCode !== 200 ? text.slice(0, 500) : undefined,
        });

        return {
            status: res.statusCode,
            body: parsed,
            headers: res.headers,
        };
    } catch (err) {
        log('error', 'sefin_request_failed', {
            empresaId, method, url,
            error: err.message,
            durationMs: Date.now() - t0,
        });
        throw err;
    }
}

// ─── Consumo de DFe por NSU (NFSe tomadas, eventos) ───────────────────────
// Endpoint: GET https://adn.../contribuintes/DFe/{ultimoNSU}
// Retorna lista de até 50 documentos com NSU > ultimoNSU.
//
// Spec: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica
export async function consumirDFe(empresaId, ultimoNSU = 0) {
    const url = `${SEFIN_ADN_URL}/contribuintes/DFe/${ultimoNSU}`;
    return await sefinRequest({ empresaId, method: 'GET', url });
}

// ─── Consulta NFSe específica por chave (50 chars) ────────────────────────
export async function consultarNfsePorChave(empresaId, chaveAcesso) {
    if (!chaveAcesso || chaveAcesso.length !== 50) {
        throw new Error('chaveAcesso deve ter 50 chars');
    }
    const url = `${SEFIN_ADN_URL}/contribuintes/NFSe/${chaveAcesso}`;
    return await sefinRequest({ empresaId, method: 'GET', url });
}

// ─── Consulta eventos de uma NFSe (cancelamentos, manifestações) ──────────
export async function consultarEventos(empresaId, chaveAcesso) {
    const url = `${SEFIN_ADN_URL}/contribuintes/NFSe/${chaveAcesso}/Eventos`;
    return await sefinRequest({ empresaId, method: 'GET', url });
}

// ─── Helpers públicos ─────────────────────────────────────────────────────
export function getSefinMode() {
    if (DRY_RUN) return 'dry-run';
    if (SEFIN_BASE_URL.includes('producaorestrita')) return 'restrita';
    return 'producao';
}

export function getSefinBaseUrls() {
    return { sefin: SEFIN_BASE_URL, adn: SEFIN_ADN_URL };
}
