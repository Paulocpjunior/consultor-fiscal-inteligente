// ============================================================================
// sefaz-backend/cte-client.js  (ESM)
// Cliente CTeDistribuicaoDFe SEFAZ NACIONAL com mTLS via https.Agent.
//
// Espelha ponto a ponto o cliente que já funciona em produção pro NF-e
// (`sefaz-client.js` / `NFeDistribuicaoDFe`) — mesma estrutura de envelope
// (`distDFeInt` com tpAmb/cUFAutor/CNPJ/distNSU), só troca o namespace de
// `.../nfe` pra `.../cte` e o schema esperado no docZip (resCTe/procCTe em
// vez de resNFe/nfeProc). É a MESMA infraestrutura nacional, com o mesmo
// padrão de nome de webservice.
//
// Paulo, 18/08 (caso EDUARDO GUERRA, CT-e de frete tomado — 0 documentos
// capturados apesar de ela ser a DESTINATÁRIA/tomadora): "como automatizar
// as CTeS então" — a captura de NF-e nunca perguntou por CT-e porque não
// existe webservice compartilhado; o CT-e tem o dele próprio.
//
// ✅ HOST E ESTRUTURA DO ENVELOPE PROVADOS EM PRODUÇÃO (19/08, botão 🚚 CT-e
// beta na EDUARDO GUERRA): a SEFAZ respondeu com um cStat estruturado
// (239 — versão do XML não suportada), não com erro de rede/TLS/schema. Isso
// prova o host, a porta, o handshake mTLS e o envelope SOAP — só a VERSÃO do
// `distDFeInt` estava errada (ver comentário na constante `VERSAO` abaixo).
// Ainda falta provar uma rodada com `ok: true` de verdade.
// ============================================================================

import https from 'https';
import zlib from 'zlib';
import { loadCertificate, invalidateCertificateCache } from './secret-loader.js';

const CTE_HOST = 'www1.cte.fazenda.gov.br';
const CTE_PATH = '/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx';
const SOAP_ACTION = 'http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe/cteDistDFeInteresse';

const TP_AMB = 1;
// 🚨 NÃO É "1.01" DA NF-e — o CTeDistribuicaoDFe tem VERSÃO PRÓPRIA (NT
// 2015.002), e usar a versão da NF-e aqui foi exatamente o defeito da 1ª
// tentativa: Paulo testou em produção (EDUARDO GUERRA, 19/08) e a SEFAZ
// recusou com cStat 239 "Cabecalho — A versao do arquivo xml nao e
// suportada". O host RESPONDEU (TLS ok, SOAP entendido) — só a versão do
// envelope estava errada, o que já prova que o resto do envelope (mesma
// estrutura provada do NFe DistDFe) está certo.
// "1.00" vem CORROBORADO por múltiplas implementações independentes
// (PySPED, PyNFe, e um script de terceiro com o comentário explícito
// "NAO e a 1.35 da NF-e — o layout de distribuicao do CT-e tem versao
// PROPRIA") — não é documentação oficial (rede da SEFAZ/gov.br segue
// bloqueada deste ambiente), mas é a MESMA técnica de corroboração por
// fonte externa já usada nesta casa. Se a SEFAZ recusar de novo, o cStat
// da resposta real vale mais que qualquer fonte externa.
const VERSAO = '1.00';
const HTTP_TIMEOUT_MS = 60_000;

// Mesmo mapa UF → código IBGE do cliente NFe (cUFAutor exige o código IBGE
// da UF do autor da consulta, nunca 91 = Ambiente Nacional).
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

const DRY_RUN = process.env.SEFAZ_DEBUG_DRY_RUN === '1';

export function montaEnvelopeCte({ cnpj, ultNSU = '0', uf }) {
  const cnpjNum = String(cnpj).replace(/\D/g, '').padStart(14, '0');
  const nsu15 = String(ultNSU).replace(/\D/g, '').padStart(15, '0');
  const cUFAutor = ufParaCodigoIBGE(uf);
  // XML minificado numa linha — o NFe DistDFe recusa (cStat 215) whitespace
  // entre elementos complexos, e não há razão pra crer que o CTe seja mais
  // tolerante (mesma infraestrutura de validação).
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">'
    + '<soap12:Body>'
    + '<cteDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe">'
    + '<cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe">'
    + `<distDFeInt versao="${VERSAO}" xmlns="http://www.portalfiscal.inf.br/cte">`
    + `<tpAmb>${TP_AMB}</tpAmb>`
    + `<cUFAutor>${cUFAutor}</cUFAutor>`
    + `<CNPJ>${cnpjNum}</CNPJ>`
    + `<distNSU><ultNSU>${nsu15}</ultNSU></distNSU>`
    + '</distDFeInt>'
    + '</cteDadosMsg>'
    + '</cteDistDFeInteresse>'
    + '</soap12:Body>'
    + '</soap12:Envelope>';
}

function postCte(envelope, pfxBuffer, password) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ pfx: pfxBuffer, passphrase: password, rejectUnauthorized: true, keepAlive: false });
    const req = https.request({
      host: CTE_HOST, path: CTE_PATH, method: 'POST', agent, timeout: HTTP_TIMEOUT_MS,
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
    req.on('timeout', () => req.destroy(new Error(`Timeout ${HTTP_TIMEOUT_MS}ms na chamada CTeDistribuicaoDFe`)));
    req.write(envelope);
    req.end();
  });
}

function parseRetornoCte(body) {
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

function descomprimirDocZip(base64) {
  const buf = Buffer.from(base64, 'base64');
  return zlib.gunzipSync(buf).toString('utf-8');
}

/**
 * Mesmo contrato de `consultaDistDFeComCert` (sefaz-client.js) — a
 * intercambialidade é de propósito: o sync-orchestrator-cte.js chama esta
 * função exatamente como o NFe chama a dele, com o MESMO ciclo de páginas,
 * cursor e regras anti-656 (reaproveitadas, não reescritas).
 */
export async function consultaDistDFeCteComCert({ cnpj, ultNSU = '0', certOverride = null, uf }) {
  if (DRY_RUN) {
    const envelopeDry = montaEnvelopeCte({ cnpj, ultNSU, uf });
    console.log('[cte-client DRY-RUN] envelope que SERIA enviado:');
    console.log(envelopeDry);
    return {
      ok: true, cStat: 'DRY-RUN', xMotivo: 'Envelope logado, SEFAZ não chamada',
      ultNSU, maxNSU: ultNSU, dhResp: new Date().toISOString(),
      xmls: [], rateLimited: false,
    };
  }
  let cert = certOverride || await loadCertificate();
  const envelope = montaEnvelopeCte({ cnpj, ultNSU, uf });

  let response;
  try {
    response = await postCte(envelope, cert.pfxBuffer, cert.password);
  } catch (err) {
    if (/PFX|passphrase|decode|handshake/i.test(String(err.message))) {
      if (certOverride) {
        throw new Error(`Certificado A1 da empresa falhou no TLS (PFX corrompido ou senha incorreta): ${err.message}. Re-envie o certificado da empresa.`);
      }
      invalidateCertificateCache();
      cert = await loadCertificate(true);
      response = await postCte(envelope, cert.pfxBuffer, cert.password);
    } else throw err;
  }
  if (response.statusCode !== 200) {
    throw new Error(`SEFAZ HTTP ${response.statusCode}: ${response.body.slice(0, 500)}`);
  }
  const parsed = parseRetornoCte(response.body);
  const xmls = parsed.docs.map((d) => {
    try { return { nsu: d.nsu, schema: d.schema, xml: descomprimirDocZip(d.base64) }; }
    catch (e) { return { nsu: d.nsu, schema: d.schema, xml: null, erroDescompressao: e.message }; }
  });
  const ok = parsed.cStat === '138' || parsed.cStat === '137';
  return {
    ok, cStat: parsed.cStat, xMotivo: parsed.xMotivo,
    ultNSU: parsed.ultNSU, maxNSU: parsed.maxNSU, dhResp: parsed.dhResp,
    xmls, rateLimited: parsed.cStat === '656',
  };
}
