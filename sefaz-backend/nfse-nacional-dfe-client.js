// ============================================================================
// sefaz-backend/nfse-nacional-dfe-client.js
// ----------------------------------------------------------------------------
// Cliente REST para captura de NFSe Nacional via ADN (Ambiente de Dados
// Nacional). Análogo ao sefaz-client.js mas REST/JSON em vez de SOAP/XML.
//
// Endpoints:
//   Produção:           https://adn.nfse.gov.br/contribuintes/
//   Produção restrita:  https://adn.producaorestrita.nfse.gov.br/contribuintes/
//
//   GET /DFe/{NSU}                     — retorna DF-e a partir do NSU
//   GET /NFSe/{ChaveAcesso}/Eventos    — eventos de uma NFSe específica
//
// Autenticação: mTLS com cert ICP-Brasil. O cert pode ser:
//   (a) Cert da empresa-cliente   → via loadCertEmpresa(empresaId)
//   (b) Cert do escritório SP     → via loadCertificate() — exige procuração
//                                    e-CAC com escopo NFSe-Nacional registrada
//                                    pra cada empresa-cliente consultada
//
// IMPORTANTE: Receita Federal valida CNPJ raiz entre o cert e o CNPJ consultado.
// Cert do escritório SP só consulta empresas se houver procuração e-CAC ativa.
// ============================================================================

import https from 'node:https';
import { loadCertificate } from './secret-loader.js';
import { loadCertEmpresa } from './cert-storage.js';

const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');
const TP_AMB = process.env.NFSE_NAC_AMB || 'producao'; // 'producao' | 'homologacao'
const HOST_PROD = 'adn.nfse.gov.br';
const HOST_HOMOL = 'adn.producaorestrita.nfse.gov.br';
const BASE_PATH = '/contribuintes';
const HTTP_TIMEOUT_MS = 60_000;

// Flag dry-run: loga o que seria chamado, retorna mock
const DRY_RUN = process.env.NFSE_NAC_DEBUG_DRY_RUN === '1';

function host() {
    return TP_AMB === 'homologacao' ? HOST_HOMOL : HOST_PROD;
}

/**
 * Retorna { pfxBuffer, password } pra usar no https.Agent.
 * Preferência: cert da empresa (se houver) → cert do escritório (fallback).
 */
async function obterCertParaConsulta(empresaId, empresaCnpj) {
    const cnpjNum = String(empresaCnpj || '').replace(/\D/g, '');
    // 1ª tentativa: cert específico da empresa
    if (empresaId) {
        try {
            const empCert = await loadCertEmpresa(empresaId);
            if (empCert?.pfxBuffer && empCert?.password) {
                return { pfx: empCert.pfxBuffer, password: empCert.password, fonte: 'empresa' };
            }
        } catch (e) {
            throw new Error(`Certificado A1 da empresa invalido/indisponivel para ADN: ${e.message}`);
        }
    }

    if (cnpjNum.slice(0, 8) !== CNPJ_ESCRITORIO.slice(0, 8)) {
        throw new Error(
            'NFSe Nacional ADN exige certificado A1 proprio da empresa. ' +
            'O certificado do escritorio nao pode consultar CNPJ de outra raiz (ADN retorna E2243).'
        );
    }

    // Fallback permitido somente para a propria S&P, cujo CNPJ bate com o cert.
    const escritorio = await loadCertificate();
    return { pfx: escritorio.pfxBuffer, password: escritorio.password, fonte: 'escritorio' };
}

/**
 * Faz um GET REST no ADN com mTLS.
 *
 * @param {string} path - ex: '/DFe/0?tipoNSU=DISTRIBUICAO'
 * @param {object} cert - { pfx: Buffer, password: string }
 * @returns {Promise<{statusCode:number, body:string, headers:object}>}
 */
function getAdn(path, cert) {
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
            method: 'GET',
            agent,
            timeout: HTTP_TIMEOUT_MS,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'CFI-NFSe-Nacional-DFe/1.0',
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
        req.on('timeout', () => req.destroy(new Error(`Timeout ${HTTP_TIMEOUT_MS}ms na chamada ADN`)));
        req.end();
    });
}

/**
 * Captura DF-e a partir de um NSU. Página única — orquestrador chama em loop.
 *
 * @param {object} args - { empresaId, empresaCnpj, nsu, tipoNSU }
 * @returns {Promise<{ok, statusCode, lote, ultNSU, maxNSU, motivo}>}
 *
 * Estrutura esperada do response JSON do ADN (baseada em swagger + manual):
 * {
 *   "lote": [
 *     {
 *       "nsu": "000000000000123",
 *       "tipo": "NFSe" | "Evento",
 *       "chaveAcesso": "<50 chars>",
 *       "xmlGzipBase64": "<conteudo>",
 *       ...
 *     }
 *   ],
 *   "ultNSU": "000000000000172",
 *   "maxNSU": "000000000000172"
 * }
 *
 * NOTA: o leiaute exato pode variar — fizemos parse defensivo dos campos
 * principais e logamos o resto pra inspeção/ajuste futuro.
 */
export async function consultarDFe({ empresaId, empresaCnpj, nsu = '0', tipoNSU = 'DISTRIBUICAO' }) {
    if (!empresaCnpj) throw new Error('empresaCnpj obrigatório');
    const cnpjNum = String(empresaCnpj).replace(/\D/g, '');
    if (cnpjNum.length !== 14) throw new Error(`CNPJ inválido: ${empresaCnpj}`);

    const nsuStr = String(nsu).replace(/\D/g, '').padStart(15, '0');
    const path = `/DFe/${nsuStr}?tipoNSU=${encodeURIComponent(tipoNSU)}&cnpjConsulta=${cnpjNum}`;

    if (DRY_RUN) {
        console.log(`[nfse-nac-dfe DRY-RUN] GET https://${host()}${BASE_PATH}${path}`);
        return {
            ok: true,
            statusCode: 200,
            lote: [],
            ultNSU: nsuStr,
            maxNSU: nsuStr,
            motivo: 'dry-run',
            fonte: 'dry-run',
        };
    }

    const cert = await obterCertParaConsulta(empresaId, cnpjNum);
    const { statusCode, body } = await getAdn(path, cert);

    // Não foi 200 — retorna pra orquestrador decidir o que fazer
    if (statusCode !== 200) {
        return {
            ok: false,
            statusCode,
            lote: [],
            ultNSU: nsuStr,
            maxNSU: null,
            motivo: `HTTP ${statusCode}: ${body.slice(0, 200)}`,
            fonte: cert.fonte,
        };
    }

    let parsed;
    try {
        parsed = JSON.parse(body);
    } catch (e) {
        return {
            ok: false,
            statusCode,
            lote: [],
            ultNSU: nsuStr,
            maxNSU: null,
            motivo: `JSON inválido: ${e.message}`,
            fonte: cert.fonte,
        };
    }

    // Extração defensiva — aceita nomes alternativos comuns no padrão NFSe
    const lote = parsed.lote || parsed.DFes || parsed.documentos || parsed.dfes || [];
    const ultNSU = parsed.ultNSU || parsed.ultimoNSU || parsed.maxNSUConsultado || nsuStr;
    const maxNSU = parsed.maxNSU || parsed.ultimoNSUDisponivel || ultNSU;

    return {
        ok: true,
        statusCode,
        lote: Array.isArray(lote) ? lote : [],
        ultNSU: String(ultNSU),
        maxNSU: String(maxNSU),
        motivo: null,
        fonte: cert.fonte,
        // Para debugging / observabilidade
        raw: parsed,
    };
}

/**
 * Consulta eventos de uma NFSe específica pela chave.
 */
export async function consultarEventos({ empresaId, chaveAcesso }) {
    if (!chaveAcesso || chaveAcesso.length < 40) throw new Error('chaveAcesso inválida');
    if (DRY_RUN) {
        console.log(`[nfse-nac-dfe DRY-RUN] GET /NFSe/${chaveAcesso}/Eventos`);
        return { ok: true, eventos: [] };
    }
    const cert = await obterCertParaConsulta(empresaId, null);
    const path = `/NFSe/${encodeURIComponent(chaveAcesso)}/Eventos`;
    const { statusCode, body } = await getAdn(path, cert);
    if (statusCode !== 200) {
        return { ok: false, statusCode, motivo: `HTTP ${statusCode}: ${body.slice(0, 200)}` };
    }
    try {
        const parsed = JSON.parse(body);
        return { ok: true, eventos: parsed.eventos || parsed.lote || [] };
    } catch (e) {
        return { ok: false, motivo: `JSON inválido: ${e.message}` };
    }
}
