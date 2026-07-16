// ============================================================================
// sefaz-backend/poc-saida-sp-core.js  (ESM) — Fase F0
//
// Nucleo PURO do reconhecimento SEFAZ-SP (NF-e de SAIDA): inspecao do A1,
// sonda mTLS com follow de redirects/cookies e deteccao de WAF/captcha.
//
// Fica em sefaz-backend/ (e nao em scripts/) de proposito: o Dockerfile de
// runtime copia server.js + sefaz-backend/, mas NAO copia scripts/. Deixar
// este nucleo aqui garante que a rota admin funcione na imagem implantada.
// Consumidores: poc-saida-sp-recon.js (rota) e scripts/poc-saida-sp.mjs (CLI).
//
// So faz GET de reconhecimento (nenhum POST que altere estado). NUNCA loga a
// senha do .pfx.
// ============================================================================

import https from 'node:https';
import forge from 'node-forge';
import { TLSSocket } from 'node:tls';

export const HTTP_TIMEOUT_MS_DEFAULT = 30_000;
const MAX_REDIRECTS = 6;

// Raiz do CNPJ da empresa piloto (8 primeiros digitos). So pra CONFERIR que o
// certificado carregado e mesmo da J.N. VINATEX — nunca bloqueia, so avisa.
export const RAIZ_PILOTO = '32602701';

// UA de navegador real. Portais .gov.br as vezes servem desafio pra UAs "de bot".
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

// ─── Endpoints CANDIDATOS da SEFAZ-SP ────────────────────────────────────────
// ATENCAO: sao CANDIDATOS a confirmar — o proprio reconhecimento diz quais
// respondem e quais aceitam o cert. Nao trate como URLs oficiais gravadas em
// lugar nenhum; nao mexa em URL/dominio/DNS de producao por causa disto.
export const ENDPOINTS_CANDIDATOS = [
  {
    id: 'pfe',
    label: 'PFE — Posto Fiscal Eletronico (area autenticada por certificado)',
    url: 'https://www.pfe.fazenda.sp.gov.br/',
    porqueImporta: 'provavel casa da consulta de NF-e emitidas (login via cert)',
  },
  {
    id: 'nfe-sp',
    label: 'Portal NF-e SP',
    url: 'https://www.nfe.fazenda.sp.gov.br/',
    porqueImporta: 'portal publico de NF-e do estado; ponto de partida do fluxo',
  },
  {
    id: 'portal-sefaz',
    label: 'Portal SEFAZ-SP',
    url: 'https://portal.fazenda.sp.gov.br/',
    porqueImporta: 'home institucional; pode redirecionar pro login por cert',
  },
];

export class CertError extends Error {}

// ─── inspecao do certificado (node-forge) ────────────────────────────────────
// Extrai identidade do titular sem NUNCA expor a senha. O CNPJ em certificados
// ICP-Brasil PJ vive no otherName do SubjectAltName (OID 2.16.76.1.3.3); como
// fallback aparece no CN no formato "RAZAO SOCIAL:CNPJ".
export function inspecionarCert(pfxBuffer, senha) {
  let pkcs12;
  try {
    const asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
    pkcs12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/mac could not be verified|invalid password|Invalid MAC/i.test(msg)) {
      throw new CertError('senha incorreta para o .pfx');
    }
    throw new CertError(`.pfx ilegivel: ${msg}`);
  }

  let cert = null;
  let temChave = false;
  for (const sc of pkcs12.safeContents) {
    for (const bag of sc.safeBags) {
      if (bag.type === forge.pki.oids.pkcs8ShroudedKeyBag || bag.type === forge.pki.oids.keyBag) {
        temChave = true;
      } else if (bag.type === forge.pki.oids.certBag && bag.cert && !cert) {
        cert = bag.cert;
      }
    }
  }
  if (!cert) throw new CertError('certificado folha nao encontrado no .pfx');
  if (!temChave) console.warn('[poc-saida-sp] aviso: chave privada nao localizada no .pfx (mTLS pode falhar).');

  const cnField = (cert.subject.getField('CN') || {}).value || '';
  const issuerCN = (cert.issuer.getField('CN') || {}).value || '';
  const cnpj = extrairCnpj(cert, cnField);
  const raiz = cnpj ? cnpj.slice(0, 8) : null;

  return {
    subjectCN: cnField,
    issuerCN,
    cnpj,
    raizConfere: raiz === RAIZ_PILOTO,
    notBefore: cert.validity.notBefore.toISOString(),
    notAfter: cert.validity.notAfter.toISOString(),
    expirado: cert.validity.notAfter.getTime() < Date.now(),
    diasParaVencer: Math.floor((cert.validity.notAfter.getTime() - Date.now()) / 86_400_000),
  };
}

export function extrairCnpj(cert, cnField) {
  // 1) SubjectAltName otherName OID 2.16.76.1.3.3 (padrao ICP-Brasil PJ).
  try {
    const san = cert.getExtension('subjectAltName');
    if (san && Array.isArray(san.altNames)) {
      for (const alt of san.altNames) {
        const val = String(alt.value || '');
        const m = val.match(/(\d{14})/);
        if (m && /2\.16\.76\.1\.3\.3/.test(String(alt.type) + String(alt.oid || ''))) return m[1];
      }
    }
  } catch { /* forge nem sempre parseia otherName; segue pro fallback */ }
  // 2) Fallback: 14 digitos no CN ("RAZAO:CNPJ").
  const m = String(cnField).match(/(\d{14})/);
  return m ? m[1] : null;
}

// ─── deteccao de WAF / captcha / desafio JS ──────────────────────────────────
export function detectarWafCaptcha({ statusCode, headers, body }) {
  const marcadores = [];
  const h = headers || {};
  const b = String(body || '');
  const lower = b.toLowerCase();

  const add = (tipo, evidencia) => marcadores.push({ tipo, evidencia });

  // Cloudflare
  if (h['cf-ray'] || /cloudflare/i.test(String(h['server'] || ''))) add('cloudflare', `header cf-ray/server`);
  if (/attention required|checking your browser|cf-browser-verification|__cf_chl|cf-challenge/i.test(b))
    add('cloudflare-challenge', 'body challenge cloudflare');
  // Akamai
  if (/akamaighost/i.test(String(h['server'] || ''))) add('akamai', 'server AkamaiGHost');
  if (/access denied/i.test(lower) && /reference\s*#?\s*\d/i.test(lower)) add('akamai-denied', 'Access Denied + reference #');
  // Imperva / Incapsula
  if (h['x-iinfo'] || /incap_ses|visid_incap|_incapsula_resource/i.test(b)) add('imperva', 'incapsula markers');
  // reCAPTCHA / hCaptcha / generico
  if (/www\.google\.com\/recaptcha|g-recaptcha|grecaptcha/i.test(b)) add('recaptcha', 'recaptcha script');
  if (/hcaptcha\.com|h-captcha/i.test(b)) add('hcaptcha', 'hcaptcha script');
  if (/\bcaptcha\b/i.test(lower) && marcadores.length === 0) add('captcha-generico', 'palavra "captcha" no body');
  // Codigos tipicos de bloqueio/desafio
  if ([403, 429, 503].includes(statusCode) && marcadores.length === 0)
    add('http-bloqueio', `HTTP ${statusCode} sem conteudo esperado`);

  return { bloqueado: marcadores.length > 0, marcadores };
}

// ─── sonda mTLS de UM endpoint (segue redirects, coleta cookies) ─────────────
export async function sondarEndpoint(urlInicial, pfxBuffer, senha, timeoutMs) {
  const cadeia = [];        // hops de redirect
  const cookiesVistos = new Set();
  let url = urlInicial;
  let ultimo = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await requestMtls(url, pfxBuffer, senha, timeoutMs);
    ultimo = r;
    cadeia.push({ url, statusCode: r.statusCode, location: r.headers?.location || null });

    for (const nome of nomesDeCookies(r.headers)) cookiesVistos.add(nome);

    if (r.erroTls) break; // handshake falhou — nao adianta seguir
    const loc = r.headers && r.headers.location;
    if (r.statusCode >= 300 && r.statusCode < 400 && loc) {
      url = new URL(loc, url).toString();
      continue;
    }
    break; // resposta final (2xx/4xx/5xx sem redirect)
  }

  const waf = ultimo && !ultimo.erroTls
    ? detectarWafCaptcha({ statusCode: ultimo.statusCode, headers: ultimo.headers, body: ultimo.body })
    : { bloqueado: false, marcadores: [] };

  return {
    urlInicial,
    urlFinal: cadeia[cadeia.length - 1]?.url || urlInicial,
    handshakeMtlsOk: !!ultimo && !ultimo.erroTls,
    erroTls: ultimo?.erroTls || null,
    tls: ultimo?.tls || null,
    statusFinal: ultimo?.erroTls ? null : ultimo?.statusCode ?? null,
    tituloPagina: ultimo?.erroTls ? null : extrairTitulo(ultimo?.body),
    redirects: cadeia,
    cookiesSessao: [...cookiesVistos],
    waf,
    bodySnippet: ultimo?.erroTls ? null : String(ultimo?.body || '').replace(/\s+/g, ' ').slice(0, 300),
  };
}

export function requestMtls(urlStr, pfxBuffer, senha, timeoutMs) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch { return resolve({ erroTls: `URL invalida: ${urlStr}` }); }

    const agent = new https.Agent({ pfx: pfxBuffer, passphrase: senha, rejectUnauthorized: true, keepAlive: false });
    const req = https.request({
      host: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'GET',
      agent,
      timeout: timeoutMs,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Connection': 'close',
      },
    }, (res) => {
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total <= 256 * 1024) chunks.push(c); // cap 256KB — recon nao precisa do body inteiro
      });
      res.on('end', () => {
        const sock = res.socket;
        const tls = sock instanceof TLSSocket
          ? { protocolo: sock.getProtocol?.() || null, cifra: sock.getCipher?.()?.name || null, servidorAutorizado: sock.authorized }
          : null;
        resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), tls });
      });
    });
    req.on('error', (err) => {
      // Erros de handshake mTLS (cert recusado, alerta TLS) caem aqui.
      resolve({ erroTls: classificarErroTls(err) });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${timeoutMs}ms`)));
    req.end();
  });
}

function classificarErroTls(err) {
  const msg = String(err && (err.message || err.code) || err);
  if (/alert|handshake|SSL|TLS|certificate|EPROTO/i.test(msg)) return `handshake mTLS falhou: ${msg}`;
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg)) return `rede/DNS: ${msg}`;
  return msg;
}

function nomesDeCookies(headers) {
  const raw = headers && headers['set-cookie'];
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).map((c) => String(c).split('=')[0].trim()).filter(Boolean);
}

function extrairTitulo(body) {
  const m = String(body || '').match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim().slice(0, 120) : null;
}
