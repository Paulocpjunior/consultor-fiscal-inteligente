// ============================================================================
// nfse-nacional-emissao-client.js
//
// Cliente HTTP mTLS para EMISSAO de NFS-e Padrao Nacional via SEFIN
// (Sistema Nacional NFS-e — modulo de emissao do contribuinte).
//
// Endpoints oficiais (gov.br/nfse, Manual v1.2 out/2025):
//   - Producao:           https://sefin.nfse.gov.br/SefinNacional
//   - Producao Restrita:  https://sefin.producaorestrita.nfse.gov.br/SefinNacional
//
// Operacoes (modulo SEFIN, perspectiva contribuinte):
//   - POST /nfse                       emite NFS-e a partir do DPS (sincrono)
//   - GET  /dps/{id}                   consulta DPS pelo Id
//   - HEAD /dps/{id}                   verifica se DPS ja virou NFS-e
//   - POST /nfse/{chave}/eventos       cancela / outros eventos
//   - GET  /nfse/{chave}/eventos       lista eventos da NFS-e
//
// Autenticacao: mTLS com cert ICP-Brasil A1/A3 do PRESTADOR (ou tomador, ou
// intermediario). Sem OAuth/Bearer. NAO ha endpoint Bearer fallback.
//
// Payload: o XML DPS assinado vai GZip + Base64 dentro do envelope JSON.
// Manual nao publica wire format exato sem cert; convencao oficial e o campo
// "dpsXmlGZipB64" no body. PRIMEIRO teste real pode pedir nome de campo
// diferente — body shape e parametrizavel.
//
// Reusa pattern do nfse-nacional-dfe-client.js (https.Agent + pfx).
// ============================================================================

import https from 'node:https';
import { gzipSync } from 'node:zlib';
import { loadCertEmpresa } from './cert-storage.js';
import { pfxToPem } from './pfx-to-pem.js';

const TP_AMB = process.env.NFSE_NAC_EMISSAO_AMB || 'homologacao'; // 'producao' | 'homologacao'
const HOST_PROD = 'sefin.nfse.gov.br';
const HOST_HOMOL = 'sefin.producaorestrita.nfse.gov.br';
const BASE_PATH = '/SefinNacional';
const HTTP_TIMEOUT_MS = 60_000;

// Flag dry-run: nao envia ao SEFIN, retorna o body montado pra inspecao
// manual antes do primeiro disparo real.
export const EMISSAO_DRY_RUN = process.env.NFSE_NAC_EMISSAO_DRY_RUN === '1';

function host() {
    return TP_AMB === 'producao' ? HOST_PROD : HOST_HOMOL;
}

export function getEmissaoAmbiente() {
    return { ambiente: TP_AMB, host: host(), dryRun: EMISSAO_DRY_RUN };
}

/**
 * Carrega cert do prestador. EMISSAO exige cert do prestador — sem fallback
 * silencioso pro escritorio (a assinatura precisa do CNPJ do prestador).
 * Quando precisar usar cert do escritorio (procuracao e-CAC), o caller passa
 * `permitirEscritorio: true` e a gente loga claramente que foi essa via.
 */
export async function carregarCertPrestador(empresaId, { permitirEscritorio = false } = {}) {
    if (!empresaId) throw new Error('empresaId obrigatorio pra carregar cert do prestador');
    try {
        const cert = await loadCertEmpresa(empresaId);
        if (cert?.pfxBuffer && cert?.password) {
            const { pemKey, pemCert } = pfxToPem(cert.pfxBuffer, cert.password);
            return { pfxBuffer: cert.pfxBuffer, password: cert.password, pemKey, pemCert, fonte: 'empresa' };
        }
    } catch (_) { /* sem cert da empresa — talvez permitir escritorio */ }
    if (!permitirEscritorio) {
        throw new Error(
            `Cert do prestador (${empresaId}) nao encontrado. Cadastre o cert A1 da empresa em ` +
            `Configuracoes > Certificado Digital. Cert do escritorio so vale com procuracao e-CAC ` +
            `ativa pra NFS-e Nacional (passe permitirEscritorio=true se for esse o caso).`
        );
    }
    // Fallback explicito
    const { loadCertificate } = await import('./secret-loader.js');
    const esc = await loadCertificate();
    return {
        pfxBuffer: esc.pfxBuffer, password: esc.password,
        pemKey: esc.pemKey, pemCert: esc.pemCert,
        fonte: 'escritorio',
    };
}

/**
 * Faz uma requisicao mTLS contra o SEFIN.
 *
 * @param {object} args
 * @param {'GET'|'POST'|'HEAD'} args.method
 * @param {string} args.path - inclui base, ex: '/nfse'
 * @param {Buffer|null} args.body
 * @param {{pfx: Buffer, password: string}} args.cert
 * @param {object} args.headers extras
 */
function requestSefin({ method, path, body, cert, headers = {} }) {
    return new Promise((resolve, reject) => {
        const agent = new https.Agent({
            pfx: cert.pfx,
            passphrase: cert.password,
            rejectUnauthorized: true,
            keepAlive: false,
        });
        const fullPath = `${BASE_PATH}${path}`;
        const req = https.request({
            host: host(),
            path: fullPath,
            method,
            agent,
            timeout: HTTP_TIMEOUT_MS,
            headers: {
                Accept: 'application/json',
                'User-Agent': 'CFI-NFSe-Nacional-Emissao/1.0',
                ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}),
                ...headers,
            },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf-8'),
            }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error(`Timeout ${HTTP_TIMEOUT_MS}ms na chamada SEFIN`)));
        if (body) req.write(body);
        req.end();
    });
}

/**
 * Envia DPS assinada para emissao. Sincrono — SEFIN devolve NFS-e completa
 * na mesma resposta.
 *
 * @param {object} args
 * @param {string} args.xmlDpsAssinado XML completo da DPS, ja assinado
 * @param {{pfxBuffer: Buffer, password: string}} args.cert
 * @returns {Promise<object>} { statusCode, raw, dryRun?, body? }
 */
export async function emitirDps({ xmlDpsAssinado, cert }) {
    if (!xmlDpsAssinado) throw new Error('xmlDpsAssinado obrigatorio');
    if (!cert?.pfxBuffer) throw new Error('cert.pfxBuffer obrigatorio (cert do prestador)');

    const gz = gzipSync(Buffer.from(xmlDpsAssinado, 'utf-8'));
    const dpsXmlGZipB64 = gz.toString('base64');
    // Body conforme convencao do Manual v1.2. PRIMEIRO real-run pode pedir
    // outro nome de campo (ex: "dpsAssinada"); deixe parametrizavel via env.
    const fieldName = process.env.NFSE_NAC_EMISSAO_BODY_FIELD || 'dpsXmlGZipB64';
    const bodyObj = { [fieldName]: dpsXmlGZipB64 };
    const body = Buffer.from(JSON.stringify(bodyObj), 'utf-8');

    if (EMISSAO_DRY_RUN) {
        // Constroi tudo mas NAO envia. Devolve material pra inspecao.
        return {
            dryRun: true,
            ambiente: TP_AMB,
            host: host(),
            path: `${BASE_PATH}/nfse`,
            bodyBytes: body.length,
            bodyPreview: bodyObj,
            xmlDps: xmlDpsAssinado,
        };
    }

    const res = await requestSefin({
        method: 'POST',
        path: '/nfse',
        body,
        cert: { pfx: cert.pfxBuffer, password: cert.password },
    });
    let parsed = null;
    try { parsed = JSON.parse(res.body); }
    catch { /* SEFIN pode retornar XML em algum cenario; mantemos raw */ }
    return { statusCode: res.statusCode, raw: res.body, body: parsed };
}

/**
 * Consulta DPS pelo Id (verifica se ja autorizou).
 */
export async function consultarDps({ idDps, cert }) {
    if (!idDps) throw new Error('idDps obrigatorio');
    const res = await requestSefin({
        method: 'GET',
        path: `/dps/${encodeURIComponent(idDps)}`,
        body: null,
        cert: { pfx: cert.pfxBuffer, password: cert.password },
    });
    let parsed = null;
    try { parsed = JSON.parse(res.body); } catch { /* */ }
    return { statusCode: res.statusCode, raw: res.body, body: parsed };
}

/**
 * Cancela NFS-e via evento POST /nfse/{chave}/eventos.
 * Payload do evento e tambem XML assinado (Manual Anexo eventos) — mesma
 * estrategia de buildEventoXml + assinar + gzip+base64 pode ser feita aqui.
 * Por ora exposto stub que delega o XML pronto do caller.
 */
export async function postEvento({ chaveNfse, xmlEventoAssinado, cert }) {
    if (!chaveNfse) throw new Error('chaveNfse obrigatorio');
    if (!xmlEventoAssinado) throw new Error('xmlEventoAssinado obrigatorio');
    const gz = gzipSync(Buffer.from(xmlEventoAssinado, 'utf-8'));
    const fieldName = process.env.NFSE_NAC_EMISSAO_BODY_FIELD || 'dpsXmlGZipB64';
    const body = Buffer.from(JSON.stringify({ [fieldName]: gz.toString('base64') }), 'utf-8');

    if (EMISSAO_DRY_RUN) {
        return { dryRun: true, ambiente: TP_AMB, host: host(), path: `${BASE_PATH}/nfse/${chaveNfse}/eventos`, bodyBytes: body.length };
    }
    const res = await requestSefin({
        method: 'POST',
        path: `/nfse/${encodeURIComponent(chaveNfse)}/eventos`,
        body,
        cert: { pfx: cert.pfxBuffer, password: cert.password },
    });
    let parsed = null;
    try { parsed = JSON.parse(res.body); } catch { /* */ }
    return { statusCode: res.statusCode, raw: res.body, body: parsed };
}
