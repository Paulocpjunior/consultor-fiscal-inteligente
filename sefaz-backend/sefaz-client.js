// ============================================================================
// sefaz-backend/sefaz-client.js  (ESM)
// Cliente NFeDistribuicaoDFe SEFAZ NACIONAL com mTLS via https.Agent.
// ============================================================================

import https from 'https';
import zlib from 'zlib';
import { loadCertificate, invalidateCertificateCache } from './secret-loader.js';

const SEFAZ_HOST = 'www1.nfe.fazenda.gov.br';
const SEFAZ_PATH = '/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
const SOAP_ACTION = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';

const TP_AMB = 1;
const C_UF_AUTOR = 91;
const VERSAO = '1.01';
const HTTP_TIMEOUT_MS = 60_000;

function montaEnvelope({ cnpj, ultNSU = '0' }) {
  const cnpjNum = String(cnpj).replace(/\D/g, '').padStart(14, '0');
  const nsu15 = String(ultNSU).replace(/\D/g, '').padStart(15, '0');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt versao="${VERSAO}" xmlns="http://www.portalfiscal.inf.br/nfe">
          <tpAmb>${TP_AMB}</tpAmb>
          <cUFAutor>${C_UF_AUTOR}</cUFAutor>
          <CNPJ>${cnpjNum}</CNPJ>
          <distNSU>
            <ultNSU>${nsu15}</ultNSU>
          </distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

function postSefaz(envelope, pfxBuffer, password) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ pfx: pfxBuffer, passphrase: password, rejectUnauthorized: true, keepAlive: false });
    const req = https.request({
      host: SEFAZ_HOST, path: SEFAZ_PATH, method: 'POST', agent, timeout: HTTP_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'SOAPAction': SOAP_ACTION,
        'Content-Length': Buffer.byteLength(envelope, 'utf-8'),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Timeout ${HTTP_TIMEOUT_MS}ms na chamada SEFAZ`)));
    req.write(envelope);
    req.end();
  });
}

function parseRetorno(body) {
  const pick = (tag) => {
    const m = body.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    return m ? m[1].trim() : null;
  };
  const cStat = pick('cStat');
  const xMotivo = pick('xMotivo');
  const ultNSU = pick('ultNSU');
  const maxNSU = pick('maxNSU');
  const dhResp = pick('dhResp');
  const docZipRegex = /<docZip\s+([^>]+)>([^<]+)<\/docZip>/gi;
  const docs = [];
  let match;
  while ((match = docZipRegex.exec(body)) !== null) {
    const attrs = match[1];
    const base64 = match[2].trim();
    const nsu = (attrs.match(/NSU="([^"]+)"/) || [])[1] || null;
    const schema = (attrs.match(/schema="([^"]+)"/) || [])[1] || null;
    docs.push({ nsu, schema, base64 });
  }
  return { cStat, xMotivo, ultNSU, maxNSU, dhResp, docs };
}

export function descomprimirDocZip(base64) {
  const buf = Buffer.from(base64, 'base64');
  return zlib.gunzipSync(buf).toString('utf-8');
}

export async function consultaDistDFe({ cnpj, ultNSU = '0' }) {
  let cert = await loadCertificate();
  const envelope = montaEnvelope({ cnpj, ultNSU });

  // DEBUG TEMPORARIO — investigar cStat 215
  console.log('[sefaz-client DEBUG] ENVELOPE ENVIADO:');
  console.log(envelope);
  console.log('[sefaz-client DEBUG] cert CNPJ:', cert.cnpj || '?');

  let response;
  try {
    response = await postSefaz(envelope, cert.pfxBuffer, cert.password);
  } catch (err) {
    if (/PFX|passphrase|decode|handshake/i.test(String(err.message))) {
      console.warn('[sefaz-client] erro de TLS, recarregando cert:', err.message);
      invalidateCertificateCache();
      cert = await loadCertificate(true);
      response = await postSefaz(envelope, cert.pfxBuffer, cert.password);
    } else throw err;
  }
  if (response.statusCode !== 200) throw new Error(`SEFAZ HTTP ${response.statusCode}: ${response.body.slice(0, 500)}`);

  // DEBUG TEMPORARIO — investigar cStat 215
  console.log('[sefaz-client DEBUG] RESPONSE STATUS:', response.statusCode);
  console.log('[sefaz-client DEBUG] RESPONSE BODY (primeiros 2000 chars):');
  console.log(response.body.slice(0, 2000));

  const parsed = parseRetorno(response.body);
  console.log('[sefaz-client DEBUG] PARSED:', JSON.stringify({ cStat: parsed.cStat, xMotivo: parsed.xMotivo, ultNSU: parsed.ultNSU, maxNSU: parsed.maxNSU, docsCount: parsed.docs.length }));
  const xmls = parsed.docs.map(d => {
    try { return { nsu: d.nsu, schema: d.schema, xml: descomprimirDocZip(d.base64) }; }
    catch (e) {
      console.error(`[sefaz-client] falha ao descomprimir NSU=${d.nsu}:`, e.message);
      return { nsu: d.nsu, schema: d.schema, xml: null, erroDescompressao: e.message };
    }
  });
  const ok = parsed.cStat === '138' || parsed.cStat === '137';
  return {
    ok, cStat: parsed.cStat, xMotivo: parsed.xMotivo,
    ultNSU: parsed.ultNSU, maxNSU: parsed.maxNSU, dhResp: parsed.dhResp,
    xmls, rateLimited: parsed.cStat === '656',
  };
}
