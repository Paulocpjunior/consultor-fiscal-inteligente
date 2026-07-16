// ============================================================================
// scripts/poc-saida-sp.mjs  (ESM) — Fase F0
//
// CLI de RECONHECIMENTO do portal da SEFAZ-SP para captura de NF-e de SAIDA
// (notas EMITIDAS pela propria empresa) — fluxo que o NFeDistribuicaoDFe
// NACIONAL nao entrega. Empresa piloto: J.N. VINATEX (raiz CNPJ 32.602.701).
//
// A logica pura (inspecao do A1, sonda mTLS, deteccao de WAF/captcha) vive em
// sefaz-backend/poc-saida-sp-core.js — fonte unica compartilhada com a rota
// admin poc-saida-sp-routes.js (que roda no backend implantado). Este arquivo
// e so o embrulho de linha de comando (args, senha oculta, relatorio).
//
// OBJETIVO F0 (somente reconhecimento):
//   1. Validar que o A1 (.pfx) abre e identificar o titular (CNPJ/razao/AC).
//   2. Testar se o A1 autentica via mTLS nos endpoints candidatos da SEFAZ-SP.
//   3. Mapear o fluxo: redirects, cookies de sessao, pagina de pouso.
//   4. DETECTAR captcha / WAF. Se encontrar → PARAR e reportar.
//
// DRY-RUN TOTAL — NAO grava Firestore/Storage, NAO importa firebase-admin nem
// sefaz-client.js, so faz GET de reconhecimento, NUNCA grava/loga a senha.
//
// USO (RODAR NA MAQUINA QUE TEM O .pfx):
//   node scripts/poc-saida-sp.mjs --pfx /caminho/para/cert.pfx
//   node scripts/poc-saida-sp.mjs --pfx cert.pfx --url https://exemplo/  (alvo extra)
//   node scripts/poc-saida-sp.mjs --pfx cert.pfx --json                  (saida JSON)
//
// Codigos de saida:
//   0  reconhecimento concluido sem WAF/captcha
//   3  WAF/captcha detectado em algum endpoint (PARAR — pivotar rota)
//   4  certificado invalido / senha incorreta / .pfx ilegivel
//   2  erro de uso (argumentos)
// ============================================================================

import { readFileSync } from 'node:fs';
import {
  inspecionarCert,
  sondarEndpoint,
  detectarWafCaptcha,
  requestMtls,
  extrairCnpj,
  CertError,
  ENDPOINTS_CANDIDATOS,
  RAIZ_PILOTO,
  HTTP_TIMEOUT_MS_DEFAULT,
} from '../sefaz-backend/poc-saida-sp-core.js';

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
    console.log(`     pivotar a rota de descoberta.`);
  } else {
    const algumMtls = sondagens.some(s => s.handshakeMtlsOk);
    if (algumMtls) {
      console.log(`  ✓ Ao menos um endpoint completou handshake mTLS sem WAF/captcha.`);
      console.log(`    Proximo passo: seguir a pagina de pouso/cookies ate a tela de`);
      console.log(`    "NF-e emitidas / relacao por periodo" e mapear o request de listagem.`);
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
const invocadoDireto = process.argv[1] && process.argv[1].endsWith('poc-saida-sp.mjs');
if (invocadoDireto) {
  main().catch((e) => {
    console.error(`[poc-saida-sp] erro inesperado: ${e && e.stack || e}`);
    process.exit(1);
  });
}

// Re-exporta o nucleo pra compat com quem importava do script.
export { inspecionarCert, extrairCnpj, detectarWafCaptcha, sondarEndpoint, requestMtls, CertError, ENDPOINTS_CANDIDATOS };
