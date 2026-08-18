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
const VERSAO = '1.01';
const HTTP_TIMEOUT_MS = 60_000;

// Mapa UF → código IBGE para o campo cUFAutor do envelope.
// cUFAutor exige o código IBGE da UF do autor (empresa), NUNCA 91 (Ambiente Nacional).
const UF_IBGE_MAP = {
  AC: '12', AL: '27', AP: '16', AM: '13', BA: '29', CE: '23', DF: '53',
  ES: '32', GO: '52', MA: '21', MT: '51', MS: '50', MG: '31', PA: '15',
  PB: '25', PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24', RS: '43',
  RO: '11', RR: '14', SC: '42', SP: '35', SE: '28', TO: '17',
};

function ufParaCodigoIBGE(uf) {
  const sigla = String(uf || '').trim().toUpperCase();
  const cod = UF_IBGE_MAP[sigla];
  if (!cod) throw new Error(`UF inválida ou não cadastrada: ${uf || '(vazio)'}`);
  return cod;
}

// Flag de dry-run: loga o envelope montado mas não chama SEFAZ.
// Útil pra validar o cUFAutor em prod sem risco antes de virar real.
const DRY_RUN = process.env.SEFAZ_DEBUG_DRY_RUN === '1';

export function montaEnvelope({ cnpj, ultNSU = '0', uf }) {
  const cnpjNum = String(cnpj).replace(/\D/g, '').padStart(14, '0');
  const nsu15 = String(ultNSU).replace(/\D/g, '').padStart(15, '0');
  const cUFAutor = ufParaCodigoIBGE(uf);
  // IMPORTANTE: XML minificado em uma linha. SEFAZ rejeita whitespace
  // entre elementos complexos com cStat 215 (Falha no esquema xml).
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">'
    + '<soap12:Body>'
    + '<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">'
    + '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">'
    + `<distDFeInt versao="${VERSAO}" xmlns="http://www.portalfiscal.inf.br/nfe">`
    + `<tpAmb>${TP_AMB}</tpAmb>`
    + `<cUFAutor>${cUFAutor}</cUFAutor>`
    + `<CNPJ>${cnpjNum}</CNPJ>`
    + `<distNSU><ultNSU>${nsu15}</ultNSU></distNSU>`
    + '</distDFeInt>'
    + '</nfeDadosMsg>'
    + '</nfeDistDFeInteresse>'
    + '</soap12:Body>'
    + '</soap12:Envelope>';
}

// Variante do montaEnvelope usando <consChNFe> em vez de <distNSU>. Consulta
// UMA NFe especifica pela chave de 44 digitos. Funciona se o CNPJ informado
// e interessado na NFe (emitente OU destinatario). Se nao for, SEFAZ retorna
// cStat=137 'Nenhum documento localizado' — util pra DIAGNOSTICAR se uma NFe
// foi emitida com o CNPJ do escritorio como destinatario ou nao.
export function montaEnvelopeConsChNFe({ chave, cnpjInteressado, uf }) {
  const cnpjNum = String(cnpjInteressado).replace(/\D/g, '').padStart(14, '0');
  const chaveLimpa = String(chave).replace(/\D/g, '');
  if (chaveLimpa.length !== 44) {
    throw new Error(`Chave invalida: esperado 44 digitos, recebido ${chaveLimpa.length}`);
  }
  const cUFAutor = ufParaCodigoIBGE(uf);
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">'
    + '<soap12:Body>'
    + '<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">'
    + '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">'
    + `<distDFeInt versao="${VERSAO}" xmlns="http://www.portalfiscal.inf.br/nfe">`
    + `<tpAmb>${TP_AMB}</tpAmb>`
    + `<cUFAutor>${cUFAutor}</cUFAutor>`
    + `<CNPJ>${cnpjNum}</CNPJ>`
    + `<consChNFe><chNFe>${chaveLimpa}</chNFe></consChNFe>`
    + '</distDFeInt>'
    + '</nfeDadosMsg>'
    + '</nfeDistDFeInteresse>'
    + '</soap12:Body>'
    + '</soap12:Envelope>';
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

/**
 * Variante que aceita um certificado especifico (da empresa).
 * Se certOverride for null, usa loadCertificate() (cert do escritorio).
 */
export async function consultaDistDFeComCert({ cnpj, ultNSU = '0', certOverride = null, uf }) {
  // DRY-RUN: loga o envelope que seria enviado e retorna mock sem chamar SEFAZ.
  if (DRY_RUN) {
    const envelopeDry = montaEnvelope({ cnpj, ultNSU, uf });
    console.log('[sefaz-client DRY-RUN] envelope que SERIA enviado:');
    console.log(envelopeDry);
    return {
      ok: true, cStat: 'DRY-RUN', xMotivo: 'Envelope logado, SEFAZ não chamada',
      ultNSU, maxNSU: ultNSU, dhResp: new Date().toISOString(),
      xmls: [], rateLimited: false,
    };
  }
  let cert = certOverride || await loadCertificate();
  const envelope = montaEnvelope({ cnpj, ultNSU, uf });

  if (process.env.SEFAZ_DEBUG === '1') {
    console.log('[sefaz-client DEBUG] ENVELOPE ENVIADO:');
    console.log(envelope);
    console.log('[sefaz-client DEBUG] cert CNPJ:', cert.cnpj || '?');
  }

  let response;
  try {
    response = await postSefaz(envelope, cert.pfxBuffer, cert.password);
  } catch (err) {
    if (/PFX|passphrase|decode|handshake/i.test(String(err.message))) {
      // Fallback de recarga SO vale pro cert do escritorio (certOverride null).
      // Quando o A1 PROPRIO da empresa falha no TLS, recair no cert do
      // escritorio garante cStat=593 pra cliente de outra raiz CNPJ — e o
      // sefaz_state fica gravado como "sincronizado com 593", mascarando a
      // causa real (PFX corrompido/senha errada). Melhor falhar explicito.
      if (certOverride) {
        throw new Error(`Certificado A1 da empresa falhou no TLS (PFX corrompido ou senha incorreta): ${err.message}. Re-envie o certificado da empresa.`);
      }
      console.warn('[sefaz-client] erro de TLS, recarregando cert:', err.message);
      invalidateCertificateCache();
      cert = await loadCertificate(true);
      response = await postSefaz(envelope, cert.pfxBuffer, cert.password);
    } else throw err;
  }
  if (response.statusCode !== 200) throw new Error(`SEFAZ HTTP ${response.statusCode}: ${response.body.slice(0, 500)}`);

  if (process.env.SEFAZ_DEBUG === '1') {
    console.log('[sefaz-client DEBUG] RESPONSE STATUS:', response.statusCode);
    console.log('[sefaz-client DEBUG] RESPONSE BODY (primeiros 2000 chars):');
    console.log(response.body.slice(0, 2000));
  }

  const parsed = parseRetorno(response.body);
  if (process.env.SEFAZ_DEBUG === '1') {
    console.log('[sefaz-client DEBUG] PARSED:', JSON.stringify({ cStat: parsed.cStat, xMotivo: parsed.xMotivo, ultNSU: parsed.ultNSU, maxNSU: parsed.maxNSU, docsCount: parsed.docs.length }));
  }
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

// Wrapper retrocompativel — usa cert do escritorio (legado)
export async function consultaDistDFe({ cnpj, ultNSU = '0', uf }) {
    return consultaDistDFeComCert({ cnpj, ultNSU, certOverride: null, uf });
}

/**
 * Consulta UMA NFe especifica pela chave (44 digitos) via DistDFe.
 *
 * - cnpjInteressado: CNPJ usado como <CNPJ> no envelope. Deve ser emitente
 *   OU destinatario da NFe pra SEFAZ retornar o XML. Se nao for, retorna
 *   cStat=137 — util pra DESCOBRIR se o destinatario e quem voce esperava.
 * - certOverride: cert proprio. Se null, usa loadCertificate() (escritorio).
 *
 * Retorna mesmo formato de consultaDistDFeComCert: { ok, cStat, xMotivo,
 * xmls: [{ nsu, schema, xml }] }. Se vier 1 xml, e a NFe consultada.
 */
export async function consultaNFePorChave({ chave, cnpjInteressado, uf, certOverride = null }) {
  if (DRY_RUN) {
    const envelopeDry = montaEnvelopeConsChNFe({ chave, cnpjInteressado, uf });
    console.log('[sefaz-client DRY-RUN consChNFe] envelope:', envelopeDry);
    return { ok: true, cStat: 'DRY-RUN', xMotivo: 'envelope logado', xmls: [] };
  }
  const envelope = montaEnvelopeConsChNFe({ chave, cnpjInteressado, uf });
  let cert = certOverride || await loadCertificate();
  let response;
  try {
    response = await postSefaz(envelope, cert.pfxBuffer, cert.password);
  } catch (err) {
    if (/PFX|passphrase|decode|handshake/i.test(String(err.message))) {
      // Mesma regra da consultaDistDFeComCert: nao trocar cert proprio da
      // empresa pelo do escritorio no retry — gera 593 mascarado.
      if (certOverride) {
        throw new Error(`Certificado A1 da empresa falhou no TLS (PFX corrompido ou senha incorreta): ${err.message}. Re-envie o certificado da empresa.`);
      }
      invalidateCertificateCache();
      cert = await loadCertificate(true);
      response = await postSefaz(envelope, cert.pfxBuffer, cert.password);
    } else throw err;
  }
  if (response.statusCode !== 200) {
    throw new Error(`SEFAZ HTTP ${response.statusCode}: ${response.body.slice(0, 500)}`);
  }
  const parsed = parseRetorno(response.body);
  const xmls = parsed.docs.map(d => {
    try { return { nsu: d.nsu, schema: d.schema, xml: descomprimirDocZip(d.base64) }; }
    catch (e) { return { nsu: d.nsu, schema: d.schema, xml: null, erroDescompressao: e.message }; }
  });
  return {
    ok: parsed.cStat === '138' || parsed.cStat === '137',
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo,
    xmls,
    rateLimited: parsed.cStat === '656',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSULTA SITUAÇÃO DA NF-e (NfeConsultaProtocolo4) — webservice DIFERENTE do
// DistDFe, usado só pra resolver "essa nota está cancelada?" quando a empresa
// não tem certificado A1 próprio (só A3, que não assina em nuvem).
//
// Paulo, 18/08 (caso MV LIDER 639): "o estranho é que cancelada deveria
// puxar" — e ele tinha razão, só que o webservice certo é outro. O DistDFe
// (`consChNFe`) ENTREGA o conteúdo do documento, e por isso SEFAZ exige que o
// CNPJ consultante seja parte do documento (emitente/destinatário/autXML). A
// Consulta Situação só devolve o STATUS (autorizada/cancelada/denegada), e por
// isso é uma consulta PÚBLICA: qualquer certificado A1 válido pode perguntar —
// inclusive o do escritório, que já está no cofre.
//
// ⚠️ DIFERENTE do DistDFe (host único do Ambiente Nacional), a Consulta
// Situação é do AUTORIZADOR de cada UF — não existe host nacional único. Este
// app só cadastra a UF que cobre a carteira real do escritório (SP); UF sem
// host cadastrado RECUSA com a causa, nunca tenta um endereço chutado (regra
// da casa: cadastro faltando é alerta, nunca contorno).
//
// 🚧 ENDEREÇO AINDA NÃO PROVADO CONTRA RESPOSTA REAL — este ambiente de
// desenvolvimento não alcança a rede da SEFAZ (mesma cegueira que já vale pro
// DistDFe: nunca foi testado daqui, só em produção). O host de SP abaixo segue
// a MESMA convenção de nome do endpoint de autorização de SP, que é estável e
// conhecido (`nfe.fazenda.sp.gov.br/ws/...`) — mas a prova real só vem de uma
// chamada em produção contra uma chave já confirmada cancelada (as 3 da MV
// LIDER que o Paulo já verificou no portal servem de prova).
const HOSTS_CONSULTA_SITUACAO = {
  SP: { host: 'nfe.fazenda.sp.gov.br', path: '/ws/nfeconsultaprotocolo4.asmx' },
};

const SOAP_ACTION_CONSULTA_SITUACAO = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF';

/** UFs com host de Consulta Situação cadastrado — usado pra decidir o fallback ANTES de gastar uma chamada. */
export function ufTemConsultaSituacao(uf) {
  return !!HOSTS_CONSULTA_SITUACAO[String(uf || '').trim().toUpperCase()];
}

export function montaEnvelopeConsultaSituacao({ chave, tpAmb = TP_AMB }) {
  const chaveLimpa = String(chave).replace(/\D/g, '');
  if (chaveLimpa.length !== 44) {
    throw new Error(`Chave inválida: esperado 44 dígitos, recebido ${chaveLimpa.length}`);
  }
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">'
    + '<soap12:Body>'
    + '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">'
    + `<consSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">`
    + `<tpAmb>${tpAmb}</tpAmb>`
    + '<xServ>CONSULTAR</xServ>'
    + `<chNFe>${chaveLimpa}</chNFe>`
    + '</consSitNFe>'
    + '</nfeDadosMsg>'
    + '</soap12:Body>'
    + '</soap12:Envelope>';
}

function parseRetornoConsultaSituacao(body) {
  const pick = (tag) => {
    const m = body.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    return m ? m[1].trim() : null;
  };
  return {
    cStat: pick('cStat'),
    xMotivo: pick('xMotivo'),
    nProt: pick('nProt'),
    dhRecbto: pick('dhRecbto'),
  };
}

/**
 * Pergunta o STATUS de uma chave (autorizada/cancelada/denegada) à Consulta
 * Situação, com o certificado do ESCRITÓRIO por padrão (funciona mesmo sem a
 * empresa ter A1 próprio — é o que a distingue do DistDFe).
 *
 * Devolve `{ ok:false, indisponivel:true, motivo }` quando a UF não tem host
 * cadastrado — nunca tenta adivinhar. Nunca lança por HTTP != 200: propaga a
 * exceção pra quem chama decidir (mesmo padrão de consultaNFePorChave).
 */
export async function consultaSituacaoNFe({ chave, uf, certOverride = null }) {
  const destino = HOSTS_CONSULTA_SITUACAO[String(uf || '').trim().toUpperCase()];
  if (!destino) {
    return {
      ok: false,
      indisponivel: true,
      cStat: null,
      xMotivo: null,
      motivo: `Consulta Situação não está cadastrada para a UF "${uf || '(vazia)'}" — só SP hoje. `
        + 'Sem o host confirmado desta UF, o app não tenta um endereço chutado.',
    };
  }
  const envelope = montaEnvelopeConsultaSituacao({ chave });
  if (DRY_RUN) {
    console.log('[sefaz-client DRY-RUN consultaSituacao] envelope:', envelope);
    return { ok: true, cStat: 'DRY-RUN', xMotivo: 'envelope logado', nProt: null, dhRecbto: null, rateLimited: false };
  }
  const cert = certOverride || await loadCertificate();
  const response = await new Promise((resolve, reject) => {
    const agent = new https.Agent({ pfx: cert.pfxBuffer, passphrase: cert.password, rejectUnauthorized: true, keepAlive: false });
    const req = https.request({
      host: destino.host, path: destino.path, method: 'POST', agent, timeout: HTTP_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'SOAPAction': SOAP_ACTION_CONSULTA_SITUACAO,
        'Content-Length': Buffer.byteLength(envelope, 'utf-8'),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Timeout ${HTTP_TIMEOUT_MS}ms na Consulta Situação`)));
    req.write(envelope);
    req.end();
  });
  if (response.statusCode !== 200) {
    throw new Error(`SEFAZ HTTP ${response.statusCode}: ${response.body.slice(0, 500)}`);
  }
  const parsed = parseRetornoConsultaSituacao(response.body);
  return {
    ok: true,
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo,
    nProt: parsed.nProt,
    dhRecbto: parsed.dhRecbto,
    rateLimited: parsed.cStat === '656',
  };
}
