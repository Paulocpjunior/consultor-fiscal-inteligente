// ============================================================================
// sefaz-backend/manifesto-client.js  (ESM)
// Cliente NFeRecepcaoEvento4 SEFAZ NACIONAL (Ambiente Nacional - cOrgao=91)
// para envio de Manifestação do Destinatário (tpEvento 210200/210210/220/240).
//
// Baseado em:
// - NT 2020.001 (Manifestação do Destinatário)
// - Schema envConfRecebto_v9.99.xsd
// - Endpoint: https://www1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx
//   (www1 = host dos WEBSERVICES do Ambiente Nacional, mesmo da DistribuicaoDFe.
//    O host "www." é o portal/site: a cadeia TLS dele não valida no Node —
//    486× "unable to get local issuer certificate" em 24/07/2026.)
//
// Fluxo:
//   1. Monta XML <infEvento>
//   2. Assina <infEvento> com XMLDSIG (RSA-SHA1, exclusive C14N)
//   3. Embrulha em <envEvento> + envelope SOAP
//   4. POST com mTLS (cert A1)
//   5. Parseia retorno e classifica resultado
// ============================================================================

import https from 'https';
import { SignedXml } from 'xml-crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { loadCertificate } from './secret-loader.js';

// ── Constantes SEFAZ ────────────────────────────────────────────────────────
const SEFAZ_HOST = 'www1.nfe.fazenda.gov.br';
const SEFAZ_PATH = '/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx';
// Namespace/action do WSDL v4 (25/07): o serviço é o NFeRecepcaoEvento4 e o
// namespace do nfeDadosMsg TEM o sufixo "4" — sem ele o .asmx não roteia a
// mensagem e devolve HTTP 500 com SOAP Fault (491× "SEFAZ HTTP 500" na noite
// de 24/07, TODAS as manifestações).
const NS_WSDL = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
const SOAP_ACTION = `${NS_WSDL}/nfeRecepcaoEvento`;
const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const NS_SOAP = 'http://www.w3.org/2003/05/soap-envelope';
const COD_AMBIENTE_NACIONAL = '91';

// tpAmb: 1=Produção, 2=Homologação. Default: produção (sobreescreva via env).
const TP_AMB = parseInt(process.env.SEFAZ_TPAMB || '1', 10);

// ── Mapeamento de tipos ──────────────────────────────────────────────────────
const TIPOS_EVENTO = {
  ciencia:           { tpEvento: '210210', descEvento: 'Ciencia da Operacao' },
  confirmacao:       { tpEvento: '210200', descEvento: 'Confirmacao da Operacao' },
  desconhecimento:   { tpEvento: '210220', descEvento: 'Desconhecimento da Operacao' },
  nao_realizada:     { tpEvento: '210240', descEvento: 'Operacao nao Realizada' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function dhEventoNow() {
  // ISO 8601 com TZD -03:00 (Brasil). SEFAZ exige formato AAAA-MM-DDTHH:MM:SS-03:00
  const d = new Date();
  const iso = new Date(d.getTime() - 3 * 3600 * 1000).toISOString();
  return iso.slice(0, 19) + '-03:00';
}

function escXml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================================
// 1) Monta o XML do <infEvento> (sem assinatura)
// ============================================================================
export function montarInfEvento({ chNFe, cnpjDestinatario, tipo, nSeqEvento = 1, xJustificativa = null }) {
  const cfg = TIPOS_EVENTO[tipo];
  if (!cfg) throw new Error(`Tipo de manifestação inválido: ${tipo}. Use: ${Object.keys(TIPOS_EVENTO).join(', ')}`);
  if (!chNFe || chNFe.length !== 44) throw new Error(`chNFe inválida: deve ter 44 dígitos (${chNFe?.length || 0})`);
  if (!cnpjDestinatario || cnpjDestinatario.replace(/\D/g, '').length !== 14) {
    throw new Error(`cnpjDestinatario inválido: ${cnpjDestinatario}`);
  }

  const cnpjLimpo = cnpjDestinatario.replace(/\D/g, '');
  const seqStr = String(nSeqEvento).padStart(2, '0');
  const Id = `ID${cfg.tpEvento}${chNFe}${seqStr}`;

  // Para "Operacao nao Realizada" precisa xJust; pros outros é opcional/proibido
  const xJustTag = (tipo === 'nao_realizada' && xJustificativa)
    ? `<xJust>${escXml(xJustificativa.substring(0, 255))}</xJust>`
    : '';

  return `<infEvento Id="${Id}">` +
    `<cOrgao>${COD_AMBIENTE_NACIONAL}</cOrgao>` +
    `<tpAmb>${TP_AMB}</tpAmb>` +
    `<CNPJ>${cnpjLimpo}</CNPJ>` +
    `<chNFe>${chNFe}</chNFe>` +
    `<dhEvento>${dhEventoNow()}</dhEvento>` +
    `<tpEvento>${cfg.tpEvento}</tpEvento>` +
    `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
      `<descEvento>${cfg.descEvento}</descEvento>` +
      xJustTag +
    `</detEvento>` +
  `</infEvento>`;
}

// ============================================================================
// 2) Assina o <infEvento> com XMLDSIG (RSA-SHA1 + Exclusive C14N)
// ============================================================================
// certOverride: certificado da EMPRESA destinatária ({ pemKey, pemCert }).
// SEFAZ rejeita evento cujo autor (CNPJ destinatário) tem raiz CNPJ diferente
// do certificado assinante — por isso o cert do escritório NÃO serve pra
// manifestar nota de cliente. Sem override, mantém o cert do escritório
// (válido só quando o destinatário é o próprio escritório).
export async function assinarEvento(infEventoXml, idAttr, certOverride = null) {
  const cert = certOverride || await loadCertificate();  // { pemCert, pemKey, pkcs12 }
  if (!cert.pemKey || !cert.pemCert) {
    throw new Error('Certificado sem PEM (chave/cert) — impossível assinar o evento de manifestação.');
  }

  // xml-crypto v6 API
  const sig = new SignedXml({
    privateKey: cert.pemKey,
    publicCert: cert.pemCert,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });

  // Adiciona referência ao <infEvento> via seu atributo Id
  sig.addReference({
    xpath: `//*[@Id='${idAttr}']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });

  // Envolve em <evento> pra dar contexto à assinatura
  const xmlPraAssinar = `<evento xmlns="${NS_NFE}" versao="1.00">${infEventoXml}</evento>`;
  sig.computeSignature(xmlPraAssinar, {
    location: { reference: `//*[local-name()='infEvento']`, action: 'after' },
  });

  return sig.getSignedXml();  // retorna <evento>...<infEvento>...</infEvento><Signature>...</Signature></evento>
}

// ============================================================================
// 3) Envia o lote SOAP pra SEFAZ Nacional
// ============================================================================
export async function enviarLoteSefaz(eventosAssinadosXml, idLote = null, certOverride = null) {
  const cert = certOverride || await loadCertificate();
  const lote = idLote || String(Date.now()).slice(-15);  // máx 15 dígitos

  // Envelope envEvento (lote) — pode conter até 20 eventos numa única requisição
  const envEvento = `<envEvento xmlns="${NS_NFE}" versao="1.00">` +
    `<idLote>${lote}</idLote>` +
    eventosAssinadosXml +  // já vem com <evento>...<Signature/></evento>
  `</envEvento>`;

  const soap = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap12:Envelope xmlns:soap12="${NS_SOAP}">` +
    `<soap12:Body>` +
      `<nfeDadosMsg xmlns="${NS_WSDL}">` +
        envEvento +
      `</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`;

  return new Promise((resolve, reject) => {
    const opts = {
      host: SEFAZ_HOST,
      port: 443,
      path: SEFAZ_PATH,
      method: 'POST',
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${SOAP_ACTION}"`,
        'Content-Length': Buffer.byteLength(soap, 'utf8'),
      },
      pfx: cert.pkcs12 || cert.pfxBuffer,
      passphrase: cert.password,
      rejectUnauthorized: true,
      timeout: 30000,
    };

    const req = https.request(opts, (res) => {
      let chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          // Extrai a RAZÃO do SOAP Fault (soap:Text / faultstring) — o erro
          // truncado no início do envelope escondia o motivo real ("erros sem
          // explicação" no card, 25/07). O trecho do envelope fica de fallback.
          const fault = (body.match(/<(?:\w+:)?Text[^>]*>([\s\S]*?)<\/(?:\w+:)?Text>/) || [])[1]
            || (body.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/) || [])[1]
            || (body.match(/<(?:\w+:)?Reason[^>]*>([\s\S]*?)<\/(?:\w+:)?Reason>/) || [])[1];
          const detalhe = fault ? `SOAP Fault: ${fault.trim().slice(0, 300)}` : body.slice(0, 500);
          return reject(new Error(`SEFAZ HTTP ${res.statusCode}: ${detalhe}`));
        }
        resolve(body);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout SEFAZ (30s)')); });
    req.write(soap);
    req.end();
  });
}

// ============================================================================
// 4) Parse do retorno SOAP — extrai cStat e xMotivo de cada retEvento
// ============================================================================
export function parseRetornoLote(soapResponse) {
  const result = { cStatLote: null, xMotivoLote: null, eventos: [] };
  // cStat geral do lote
  const mLote = soapResponse.match(/<retEnvEvento[^>]*>([\s\S]*?)<\/retEnvEvento>/);
  if (mLote) {
    const inner = mLote[1];
    const cStat = (inner.match(/<cStat>(\d+)<\/cStat>/) || [])[1] || null;
    const xMotivo = (inner.match(/<xMotivo>([^<]+)<\/xMotivo>/) || [])[1] || null;
    result.cStatLote = cStat;
    result.xMotivoLote = xMotivo;
  }
  // Eventos individuais
  const reEv = /<retEvento[^>]*>([\s\S]*?)<\/retEvento>/g;
  let m;
  while ((m = reEv.exec(soapResponse)) !== null) {
    const inner = m[1];
    const cStat = (inner.match(/<cStat>(\d+)<\/cStat>/) || [])[1] || null;
    const xMotivo = (inner.match(/<xMotivo>([^<]+)<\/xMotivo>/) || [])[1] || null;
    const chNFe = (inner.match(/<chNFe>(\d+)<\/chNFe>/) || [])[1] || null;
    const tpEvento = (inner.match(/<tpEvento>(\d+)<\/tpEvento>/) || [])[1] || null;
    const nProt = (inner.match(/<nProt>(\d+)<\/nProt>/) || [])[1] || null;
    const dhRegEvento = (inner.match(/<dhRegEvento>([^<]+)<\/dhRegEvento>/) || [])[1] || null;
    result.eventos.push({ chNFe, tpEvento, cStat, xMotivo, nProt, dhRegEvento });
  }
  return result;
}

// ============================================================================
// 5) Função pública: orquestra tudo (1 NFe por vez ou lote)
// ============================================================================
export async function manifestarNFe({ chNFe, cnpjDestinatario, tipo = 'ciencia', nSeqEvento = 1, xJustificativa = null, dryRun = false, certOverride = null }) {
  // 1) Monta + 2) Assina
  const infEventoXml = montarInfEvento({ chNFe, cnpjDestinatario, tipo, nSeqEvento, xJustificativa });
  const idAttr = `ID${TIPOS_EVENTO[tipo].tpEvento}${chNFe}${String(nSeqEvento).padStart(2, '0')}`;
  const eventoAssinado = await assinarEvento(infEventoXml, idAttr, certOverride);

  if (dryRun) {
    return { dryRun: true, eventoAssinado, idAttr, tipo, chNFe };
  }

  // 3) Envia
  const soapResp = await enviarLoteSefaz(eventoAssinado, null, certOverride);

  // 4) Parseia retorno
  const ret = parseRetornoLote(soapResp);
  return { dryRun: false, eventoAssinado, idAttr, tipo, chNFe, retorno: ret, soapBruto: soapResp };
}

// Aliases convenientes
export const TIPOS_MANIFESTACAO = Object.keys(TIPOS_EVENTO);
