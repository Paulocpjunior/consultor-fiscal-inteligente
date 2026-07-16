// ============================================================================
// scripts/poc-saida-sp.mjs  (ESM) — Fase F0
//
// POC de RECONHECIMENTO do portal da SEFAZ-SP para captura de NF-e de SAIDA
// (notas EMITIDAS pela propria empresa) — fluxo que o NFeDistribuicaoDFe
// NACIONAL nao entrega. Empresa piloto: J.N. VINATEX (raiz CNPJ 32.602.701).
//
// OBJETIVO F0 (somente reconhecimento):
//   1. Validar que o certificado A1 (.pfx) abre e identificar o titular
//      (CNPJ / razao / validade / AC emissora ICP-Brasil).
//   2. Testar se o A1 autentica via mTLS nos endpoints candidatos da SEFAZ-SP.
//   3. Mapear o fluxo de acesso: redirects, cookies de sessao, pagina de pouso.
//   4. DETECTAR captcha / WAF / desafio JS. Se encontrar → PARAR e reportar,
//      pra decidir pivotar a rota de descoberta (instrucao do dono).
//
// DRY-RUN TOTAL — este script:
//   - NAO grava nada em Firestore/Storage;
//   - NAO importa firebase-admin nem sefaz-client.js;
//   - NAO comita nada;
//   - So faz GET de reconhecimento (nenhum POST que altere estado no portal);
//   - NUNCA grava/loga a senha do .pfx (lida por stdin oculto, descartada apos).
//
// USO (RODAR NA MAQUINA QUE TEM O .pfx — nao neste container remoto):
//   node scripts/poc-saida-sp.mjs --pfx /caminho/para/cert.pfx
//   node scripts/poc-saida-sp.mjs --pfx cert.pfx --url https://exemplo/  (alvo extra)
//   node scripts/poc-saida-sp.mjs --pfx cert.pfx --json                  (saida JSON)
//
// A senha e pedida interativamente (oculta). Como ultimo recurso aceita
// SP_PFX_PASS no ambiente, mas isso deixa rastro no historico do shell —
// evite. Nada de senha e escrito em disco por este script.
//
// Codigos de saida:
//   0  reconhecimento concluido sem WAF/captcha
//   3  WAF/captcha detectado em algum endpoint (PARAR — pivotar rota)
//   4  certificado invalido / senha incorreta / .pfx ilegivel
//   2  erro de uso (argumentos)
// ============================================================================

import https from 'node:https';
import forge from 'node-forge';
import { readFileSync } from 'node:fs';
import { TLSSocket } from 'node:tls';

// Raiz do CNPJ da empresa piloto (8 primeiros digitos). So pra CONFERIR que o
// certificado carregado e mesmo da J.N. VINATEX — nunca bloqueia, so avisa.
const RAIZ_PILOTO = '32602701';

const HTTP_TIMEOUT_MS_DEFAULT = 30_000;
const MAX_REDIRECTS = 6;

// UA de navegador real. Portais .gov.br as vezes servem desafio pra UAs "de bot".
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

// ─── Endpoints CANDIDATOS da SEFAZ-SP ────────────────────────────────────────
// ATENCAO: sao CANDIDATOS a confirmar — o proprio reconhecimento diz quais
// respondem e quais aceitam o cert. Nao trate como URLs oficiais gravadas em
// lugar nenhum; nao mexa em URL/dominio/DNS de producao por causa disto.
// O PFE (Posto Fiscal Eletronico) e a area autenticada por certificado onde
// tipicamente ficam os servicos de NF-e do contribuinte em SP.
const ENDPOINTS_CANDIDATOS = [
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

// ─── args ───────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { pfx: null, extraUrls: [], json: false, timeout: HTTP_TIMEOUT_MS_DEFAULT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pfx') args.pfx = argv[++i];
    else if (a === '--url') args.extraUrls.push(argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a === '--timeout') args.timeout = Number(argv[++i]) || HTTP_TIMEOUT_MS_DEFAULT;
    else if (a === '--help' || a === '-h') args.help = true;
    else console.warn(`[poc-saida-sp] argumento ignorado: ${a}`);
  }
  return args;
}

function printUsage() {
  console.log(`Uso: node scripts/poc-saida-sp.mjs --pfx <cert.pfx> [--url <extra>] [--json] [--timeout ms]

  --pfx      caminho do certificado A1 (.pfx / PKCS#12)  [obrigatorio]
  --url      endpoint extra a sondar (pode repetir)
  --json     imprime relatorio em JSON no fim
  --timeout  timeout por requisicao em ms (padrao ${HTTP_TIMEOUT_MS_DEFAULT})

  A senha e pedida de forma oculta (ou via env SP_PFX_PASS, desaconselhado).
  RODE NA MAQUINA QUE TEM O .pfx. Nao grava nada; so faz GET de reconhecimento.`);
}

// ─── leitura de senha OCULTA por stdin (nunca ecoa, nunca grava) ─────────────
function lerSenhaOculta(prompt = 'Senha do .pfx (oculta): ') {
  // Preferencia: env explicito (aceito, mas avisado). So pra automacao local.
  if (process.env.SP_PFX_PASS != null && process.env.SP_PFX_PASS !== '') {
    console.warn('[poc-saida-sp] usando SP_PFX_PASS do ambiente (evite — deixa rastro no shell).');
    return Promise.resolve(process.env.SP_PFX_PASS);
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    // Sem TTY (pipe/redirecionamento): le a primeira linha, sem eco possivel.
    if (!stdin.isTTY) {
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (d) => { buf += d; });
      stdin.on('end', () => resolve(buf.replace(/\r?\n$/, '')));
      stdin.on('error', reject);
      return;
    }
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let senha = '';
    const onData = (ch) => {
      const code = ch.charCodeAt(0);
      if (ch === '\n' || ch === '\r' || code === 4) {          // Enter / Ctrl-D (EOT)
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(senha);
      } else if (code === 3) {                                  // Ctrl-C
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        reject(new Error('cancelado pelo usuario (Ctrl-C)'));
      } else if (code === 127 || code === 8) {                  // Backspace / DEL
        senha = senha.slice(0, -1);
      } else if (code >= 32) {                                  // imprimivel — ignora controles
        senha += ch;
      }
    };
    stdin.on('data', onData);
  });
}

// ─── inspecao do certificado (node-forge) ────────────────────────────────────
// Extrai identidade do titular sem NUNCA expor a senha. O CNPJ em certificados
// ICP-Brasil PJ vive no otherName do SubjectAltName (OID 2.16.76.1.3.3); como
// fallback aparece no CN no formato "RAZAO SOCIAL:CNPJ".
function inspecionarCert(pfxBuffer, senha) {
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

function extrairCnpj(cert, cnField) {
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

class CertError extends Error {}

// ─── deteccao de WAF / captcha / desafio JS ──────────────────────────────────
function detectarWafCaptcha({ statusCode, headers, body }) {
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
async function sondarEndpoint(urlInicial, pfxBuffer, senha, timeoutMs) {
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

function requestMtls(urlStr, pfxBuffer, senha, timeoutMs) {
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

// ─── relatorio ────────────────────────────────────────────────────────────────
function imprimirRelatorio(certInfo, sondagens, jsonMode) {
  const linha = '─'.repeat(74);
  console.log(`\n${linha}\n RECONHECIMENTO SEFAZ-SP — Fase F0 (DRY-RUN, so leitura)\n${linha}`);

  console.log('\n[1] CERTIFICADO A1');
  console.log(`  Titular (CN) : ${certInfo.subjectCN || '(vazio)'}`);
  console.log(`  CNPJ         : ${certInfo.cnpj || '(nao extraido)'}  ${certInfo.cnpj ? (certInfo.raizConfere ? '✓ raiz 32.602.701 (J.N. VINATEX)' : '⚠ raiz NAO confere com a piloto') : ''}`);
  console.log(`  Emissora (AC): ${certInfo.issuerCN || '(vazio)'}`);
  console.log(`  Validade     : ${certInfo.notBefore} → ${certInfo.notAfter}`);
  console.log(`  Status       : ${certInfo.expirado ? '⚠ EXPIRADO' : `valido (${certInfo.diasParaVencer} dias restantes)`}`);

  console.log('\n[2] SONDAGEM mTLS DOS ENDPOINTS');
  let algumWaf = false;
  for (const s of sondagens) {
    console.log(`\n  ▸ ${s.label}`);
    console.log(`    url       : ${s.urlInicial}`);
    if (!s.handshakeMtlsOk) {
      console.log(`    mTLS      : ✗ ${s.erroTls}`);
      continue;
    }
    console.log(`    mTLS      : ✓ handshake ok  (${s.tls?.protocolo || '?'} / ${s.tls?.cifra || '?'})`);
    console.log(`    HTTP final: ${s.statusFinal}   pagina: "${s.tituloPagina || '(sem <title>)'}"`);
    console.log(`    url final : ${s.urlFinal}`);
    if (s.redirects.length > 1) console.log(`    redirects : ${s.redirects.map(r => r.statusCode).join(' → ')} (${s.redirects.length} hops)`);
    console.log(`    cookies   : ${s.cookiesSessao.length ? s.cookiesSessao.join(', ') : '(nenhum)'}`);
    if (s.waf.bloqueado) {
      algumWaf = true;
      console.log(`    WAF/CAPTCHA: ⛔ DETECTADO → ${s.waf.marcadores.map(m => m.tipo).join(', ')}`);
      for (const m of s.waf.marcadores) console.log(`                 - ${m.tipo}: ${m.evidencia}`);
    } else {
      console.log(`    WAF/CAPTCHA: nenhum marcador`);
    }
  }

  console.log(`\n${linha}\n VEREDITO`);
  if (algumWaf) {
    console.log(`  ⛔ WAF/captcha detectado. PARAR conforme combinado: reportar ao dono e`);
    console.log(`     pivotar a rota de descoberta (ex.: fluxo headless com desafio, ou`);
    console.log(`     rever se ha web service SP autenticado por cert sem WAF).`);
  } else {
    const algumMtls = sondagens.some(s => s.handshakeMtlsOk);
    if (algumMtls) {
      console.log(`  ✓ Ao menos um endpoint completou handshake mTLS sem WAF/captcha.`);
      console.log(`    Proximo passo do reconhecimento: seguir a pagina de pouso/cookies de`);
      console.log(`    sessao acima ate a tela de "NF-e emitidas / relacao por periodo" e`);
      console.log(`    mapear o request de listagem de chaves. (Ainda F0 — sem gravar nada.)`);
    } else {
      console.log(`  ⚠ Nenhum endpoint completou handshake mTLS. Ver erros TLS acima`);
      console.log(`    (cert recusado? cadeia ICP-Brasil? rede bloqueando a saida?).`);
    }
  }
  console.log(`${linha}`);
  console.log(`\n  Lembrete: F1 (download consChNFe, throttle, dedup direcao='saida') so`);
  console.log(`  comeca depois desta F0 validada e com OK explicito do dono.\n`);

  if (jsonMode) {
    // Relatorio JSON — NUNCA inclui senha nem body cru alem do snippet.
    console.log('\n===JSON===');
    console.log(JSON.stringify({ certInfo, sondagens }, null, 2));
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printUsage(); process.exit(0); }
  if (!args.pfx) { printUsage(); process.exit(2); }

  let pfxBuffer;
  try {
    pfxBuffer = readFileSync(args.pfx);
  } catch (e) {
    console.error(`[poc-saida-sp] nao consegui ler o .pfx em "${args.pfx}": ${e.message}`);
    process.exit(4);
  }

  let senha;
  try {
    senha = await lerSenhaOculta();
  } catch (e) {
    console.error(`[poc-saida-sp] ${e.message}`);
    process.exit(2);
  }

  // 1) Inspeciona o certificado (falha cedo se senha errada / pfx ruim).
  let certInfo;
  try {
    certInfo = inspecionarCert(pfxBuffer, senha);
  } catch (e) {
    console.error(`[poc-saida-sp] ${e instanceof CertError ? e.message : e.message}`);
    process.exit(4);
  }
  if (!certInfo.raizConfere) {
    console.warn(`[poc-saida-sp] AVISO: CNPJ do cert (${certInfo.cnpj || '?'}) nao bate com a raiz piloto ${RAIZ_PILOTO}. Seguindo mesmo assim (so reconhecimento).`);
  }

  // 2) Monta lista de alvos: candidatos + extras do usuario.
  const alvos = [
    ...ENDPOINTS_CANDIDATOS,
    ...args.extraUrls.map((u, i) => ({ id: `extra-${i + 1}`, label: `Extra (--url)`, url: u, porqueImporta: 'informado na linha de comando' })),
  ];

  // 3) Sonda cada alvo em SERIE (nao paralelizo: nao quero parecer varredura
  //    agressiva contra o portal .gov.br e disparar rate-limit/WAF por volume).
  const sondagens = [];
  for (const alvo of alvos) {
    process.stderr.write(`[poc-saida-sp] sondando ${alvo.id} → ${alvo.url} ...\n`);
    const r = await sondarEndpoint(alvo.url, pfxBuffer, senha, args.timeout);
    sondagens.push({ ...r, id: alvo.id, label: alvo.label, porqueImporta: alvo.porqueImporta });
  }

  // Descarta a senha da memoria assim que possivel (best-effort).
  senha = null;

  imprimirRelatorio(certInfo, sondagens, args.json);

  const houveWaf = sondagens.some(s => s.waf?.bloqueado);
  process.exit(houveWaf ? 3 : 0);
}

// So executa quando chamado direto (node scripts/poc-saida-sp.mjs ...).
// Ao ser importado (testes), expoe as funcoes puras sem disparar main().
const invocadoDireto = process.argv[1] && process.argv[1].endsWith('poc-saida-sp.mjs');
if (invocadoDireto) {
  main().catch((e) => {
    console.error(`[poc-saida-sp] erro inesperado: ${e && e.stack || e}`);
    process.exit(1);
  });
}

export { inspecionarCert, extrairCnpj, detectarWafCaptcha, sondarEndpoint, requestMtls, CertError, ENDPOINTS_CANDIDATOS };
