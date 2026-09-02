// ============================================================================
// sefaz-backend/sefaz-sp-nfce-client.js  (ESM)
//
// Cliente do SAE-NFC-e (Servicos de Apoio a Escrituracao da NFC-e) da SEFAZ-SP.
// Permite ao CONTRIBUINTE, com o proprio e-CNPJ (A1), listar as chaves das
// NFC-e (modelo 65) que ELE emitiu num periodo e baixar o XML completo.
//
// Isto resolve a captura de SAIDA de NFC-e (varejo) — o que o DistDFe nacional
// nao entrega ao emitente (cStat 641). NAO cobre NF-e modelo 55.
//
// Spec portada da implementacao de referencia NFePHP\NFe\SAE (nfephp-org/
// sped-nfe, storage/wsae_nfce.json). SOAP 1.2 + mTLS, mesmo padrao do
// sefaz-client.js (DistDFe). NAO importa/grava nada — so fala com a SEFAZ-SP.
//
// LIMITES (NT SAE-NFC-e v1.0.0):
//  - janela maxima de 100 dias por consulta;
//  - 2000 chaves por requisicao (cStat 101 => paginar via dhEmisUltNfce);
//  - a NFC-e consultada tem de pertencer ao CNPJ do certificado.
// ============================================================================

import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pfxToPem } from './pfx-to-pem.js';
import { recortarEventos, resumirEventos } from './sae-nfce-cancelamento.js';

// Bundle de CAs da ICP-Brasil que assina o SSL dos webservices SEFAZ NF-e/NFC-e
// (AC do SERPRO SSLv1 + AC Raiz Brasileira v10). O servidor da SEFAZ-SP encadeia
// nessa raiz, que NAO esta no bundle Mozilla do Node — sem ela o handshake da
// "unable to get local issuer certificate". E o mesmo bundle usado por libs de
// referencia (fazendatech/brafis) para verificar TODAS as UFs, inclusive SP.
// Continua validando o servidor (rejectUnauthorized:true).
const CA_BUNDLE = (() => {
  try {
    const p = fileURLToPath(new URL('./sefaz-sp-nfce-ca.pem', import.meta.url));
    const pem = fs.readFileSync(p, 'utf-8');
    // separa em certs individuais (o Node aceita array de PEMs em ca)
    return pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
  } catch (e) {
    console.warn('[sae-nfce] nao carregou o bundle de CA ICP-Brasil:', e.message);
    return [];
  }
})();

// Monta as credenciais mTLS do cliente a partir do .pfx do titular.
//
// PROBLEMA: o OpenSSL 3 (Node 22) removeu ciphers legados (RC2-40/3DES) do
// provider padrao. Muitos A1 da ICP-Brasil foram exportados com esse cipher
// antigo — passar o pfx bruto para o https.Agent faz o OpenSSL lancar
// "Unsupported PKCS12 PFX data" e a captura quebra logo na listagem.
//
// SOLUCAO: converter o pfx para cert+key PEM com node-forge (JS puro, entende
// os ciphers legados). Se o forge falhar (pfx moderno AES-GCM que ele nao le),
// cai pro pfx bruto — que nesse caso o OpenSSL 3 aceita. Cobrimos os dois lados.
function credenciaisCliente(pfxBuffer, password) {
  try {
    const { pemKey, pemCert } = pfxToPem(pfxBuffer, password);
    return { cert: pemCert, key: pemKey };
  } catch {
    return { pfx: pfxBuffer, passphrase: password };
  }
}

const NAMESPACE = 'http://www.portalfiscal.inf.br/nfe';
const VERSAO = '1.00';
const HTTP_TIMEOUT_MS = 60_000;

// Endpoints por ambiente (SP). tpAmb: 1=producao, 2=homologacao.
const ENDPOINTS = {
  1: {
    listagem: 'https://nfce.fazenda.sp.gov.br/ws/NFCeListagemChaves.asmx',
    download: 'https://nfce.fazenda.sp.gov.br/ws/NFCeDownloadXML.asmx',
  },
  2: {
    listagem: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFCeListagemChaves.asmx',
    download: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFCeDownloadXML.asmx',
  },
};

// operation/method conforme wsae_nfce.json da sped-nfe.
const SERVICOS = {
  listagem: { operation: 'NFCeListagemChaves', method: 'nfceListagemChaves' },
  download: { operation: 'NFCeDownloadXML', method: 'nfceDownloadXML' },
};

// ─── montagem do envelope SOAP 1.2 ──────────────────────────────────────────
// Espelha NFePHP\NFe\SAE::send(): body = <nfeDadosMsg xmlns="{ns}/wsdl/{op}">
// {content}</nfeDadosMsg>, action = "{ns}/wsdl/{op}/{method}".
function montaEnvelope(operation, method, content) {
  const nsOp = `${NAMESPACE}/wsdl/${operation}`;
  const action = `${nsOp}/${method}`;
  const envelope = '<?xml version="1.0" encoding="utf-8"?>'
    + '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://www.w3.org/2003/05/soap-envelope">'
    + '<soap:Body>'
    + `<nfeDadosMsg xmlns="${nsOp}">${content}</nfeDadosMsg>`
    + '</soap:Body>'
    + '</soap:Envelope>';
  return { envelope, action };
}

export function montaEnvelopeListagem({ tpAmb = 1, dataHoraInicial, dataHoraFinal = null }) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(dataHoraInicial))) {
    throw new Error(`dataHoraInicial invalida (use AAAA-MM-DDThh:mm): ${dataHoraInicial}`);
  }
  if (dataHoraFinal && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(dataHoraFinal))) {
    throw new Error(`dataHoraFinal invalida (use AAAA-MM-DDThh:mm): ${dataHoraFinal}`);
  }
  const content = `<nfceListagemChaves versao="${VERSAO}" xmlns="${NAMESPACE}">`
    + `<tpAmb>${tpAmb}</tpAmb>`
    + `<dataHoraInicial>${dataHoraInicial}</dataHoraInicial>`
    + (dataHoraFinal ? `<dataHoraFinal>${dataHoraFinal}</dataHoraFinal>` : '')
    + '</nfceListagemChaves>';
  return montaEnvelope(SERVICOS.listagem.operation, SERVICOS.listagem.method, content);
}

export function montaEnvelopeDownload({ tpAmb = 1, chNFCe }) {
  const ch = String(chNFCe || '').replace(/\s/g, '');
  if (ch.length !== 44 || !/^[0-9A-Za-z]{44}$/.test(ch)) {
    throw new Error(`Chave NFC-e invalida: esperado 44 alfanumericos, recebido ${ch.length}`);
  }
  const content = `<nfceDownloadXML versao="${VERSAO}" xmlns="${NAMESPACE}">`
    + `<tpAmb>${tpAmb}</tpAmb>`
    + `<chNFCe>${ch}</chNFCe>`
    + '</nfceDownloadXML>';
  return montaEnvelope(SERVICOS.download.operation, SERVICOS.download.method, content);
}

// ─── POST mTLS (mesmo padrao do sefaz-client.js) ────────────────────────────
function postSae(url, envelope, action, pfxBuffer, password) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const ca = [...CA_BUNDLE, ...tls.rootCertificates];
    let agent;
    try {
      agent = new https.Agent({ ...credenciaisCliente(pfxBuffer, password), ca, rejectUnauthorized: true, keepAlive: false });
    } catch (e) {
      return reject(new Error(`Certificado A1 invalido ou nao suportado (${e.message}). Reexporte o .pfx e reenvie no cofre.`));
    }
    const req = https.request({
      host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST', agent,
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        // SOAP 1.2 leva a action no proprio Content-Type; mantemos SOAPAction
        // tambem por compatibilidade (mesma abordagem defensiva do DistDFe).
        'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
        'SOAPAction': `"${action}"`,
        'Content-Length': Buffer.byteLength(envelope, 'utf-8'),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Timeout ${HTTP_TIMEOUT_MS}ms na chamada SAE-NFC-e`)));
    req.write(envelope);
    req.end();
  });
}

// ─── parsing das respostas ──────────────────────────────────────────────────
function pick(body, tag) {
  const m = String(body).match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function parseListagem(body) {
  const cStat = pick(body, 'cStat');
  const xMotivo = pick(body, 'xMotivo');
  const dhEmisUltNfce = pick(body, 'dhEmisUltNfce');
  const chaves = [];
  const re = /<chNFCe[^>]*>([0-9A-Za-z]{44})<\/chNFCe>/gi;
  let m;
  while ((m = re.exec(body)) !== null) chaves.push(m[1]);
  return {
    cStat, xMotivo, chaves, dhEmisUltNfce,
    completa: cStat === '100',          // 100 = lista completa
    incompleta: cStat === '101',        // 101 = ha mais de 2000; paginar
    vazio: cStat === '107',             // 107 = nenhuma no periodo
  };
}

// 🚨 O CORPO PODIA TRAZER O EVENTO E ESTE LEITOR JOGAVA FORA (02/09, caso
// NFC-e 1194 da ARMAZEM DE BICHOS — cancelada e aparecendo COM VALOR no app).
//
// Ele recortava SÓ `<nfeProc>` e descartava todo o resto do corpo. Se a SEFAZ
// devolve o `<procEventoNFe>` do cancelamento junto (ou no lugar) da
// autorizada, o app nunca ficaria sabendo — é a família do `localErroAviso`
// (12/08) e do `dhEmisUltNfce`: **o dado chega e o leitor descarta**.
//
// ⚠️ Isto NÃO afirma que o SAE manda o evento — nada aqui foi medido contra
// uma resposta real. O que muda é que, se vier, ele deixa de ser jogado fora;
// e quando NÃO vier, o `cStat`/`xMotivo` sobem inteiros para quem perguntar
// ver a resposta do órgão em vez de um "não achei" do app.
function parseDownload(body) {
  const texto = String(body);
  const cStat = pick(body, 'cStat');
  const xMotivo = pick(body, 'xMotivo');
  const nProt = pick(body, 'nProt');
  // O XML autorizado vem INLINE em <nfeProc>...</nfeProc> (sem gzip/base64).
  const m = texto.match(/<nfeProc[\s>][\s\S]*?<\/nfeProc>/i);
  const nfeProcXml = m ? m[0] : null;
  // Evento (cancelamento, CC-e). A ORDEM importa e ela foi medida contra o
  // print do Paulo (02/09): `retEvento` — que carrega o cStat da HOMOLOGAÇÃO —
  // é IRMÃO de `evento`, não filho. Um recorte `<evento>…</evento>` traz o
  // pedido ASSINADO e deixa o protocolo de fora, e aí o leitor vê o tpEvento
  // 110111 sem cStat nenhum. Por isso: embrulho completo > par evento+retEvento
  // > evento solto.
  const eventosXml = recortarEventos(texto);
  const eventosResumo = resumirEventos(eventosXml);
  return {
    cStat, xMotivo, nProt, nfeProcXml, eventosXml, eventosResumo,
    ok: cStat === '200' && !!nfeProcXml,   // 200 = download com sucesso
  };
}

// ─── API publica ────────────────────────────────────────────────────────────
/**
 * Lista as chaves de NFC-e emitidas pelo CNPJ do certificado num periodo.
 * @param {object} p
 * @param {string} p.dataHoraInicial AAAA-MM-DDThh:mm
 * @param {string} [p.dataHoraFinal] AAAA-MM-DDThh:mm (opcional; ate agora se omitido)
 * @param {{pfxBuffer:Buffer,password:string}} p.cert  A1 do PROPRIO contribuinte
 * @param {number} [p.tpAmb] 1=producao (padrao), 2=homologacao
 */
export async function listarChavesNFCe({ dataHoraInicial, dataHoraFinal = null, cert, tpAmb = 1 }) {
  if (!cert?.pfxBuffer) throw new Error('cert (A1 do contribuinte) obrigatorio');
  const { envelope, action } = montaEnvelopeListagem({ tpAmb, dataHoraInicial, dataHoraFinal });
  const url = ENDPOINTS[tpAmb].listagem;
  const resp = await postSae(url, envelope, action, cert.pfxBuffer, cert.password);
  if (resp.statusCode !== 200) throw new Error(`SAE-NFC-e HTTP ${resp.statusCode}: ${resp.body.slice(0, 400)}`);
  return parseListagem(resp.body);
}

/**
 * Baixa o XML completo (nfeProc) de uma NFC-e pela chave, com o cert do CNPJ
 * emitente (que deve coincidir com a chave).
 * @param {object} p
 * @param {string} p.chNFCe chave de 44 posicoes
 * @param {{pfxBuffer:Buffer,password:string}} p.cert
 * @param {number} [p.tpAmb]
 */
export async function baixarXmlNFCe({ chNFCe, cert, tpAmb = 1 }) {
  if (!cert?.pfxBuffer) throw new Error('cert (A1 do contribuinte) obrigatorio');
  const { envelope, action } = montaEnvelopeDownload({ tpAmb, chNFCe });
  const url = ENDPOINTS[tpAmb].download;
  const resp = await postSae(url, envelope, action, cert.pfxBuffer, cert.password);
  if (resp.statusCode !== 200) throw new Error(`SAE-NFC-e HTTP ${resp.statusCode}: ${resp.body.slice(0, 400)}`);
  return parseDownload(resp.body);
}
