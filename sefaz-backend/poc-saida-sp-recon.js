// ============================================================================
// sefaz-backend/poc-saida-sp-recon.js  (ESM) — Fase F0
//
// Provider de RECONHECIMENTO do portal SEFAZ-SP (captura de NF-e de SAIDA),
// exposto como rota admin pra rodar no backend IMPLANTADO — evita o
// colaborador ter que instalar node/node-forge e manusear o .pfx localmente.
//
// Reaproveita a logica pura do script scripts/poc-saida-sp.mjs (fonte unica:
// inspecao do cert, sonda mTLS com follow de redirects, deteccao de WAF/captcha).
// Aqui o A1 vem do COFRE por empresa (cert-storage), nao de arquivo local.
//
// SOMENTE LEITURA — nao grava Firestore/Storage, nao toca sefaz-client.js,
// so faz GET de reconhecimento (nenhum POST que altere estado no portal).
// ============================================================================

import { inspecionarCert, sondarEndpoint, ENDPOINTS_CANDIDATOS } from './poc-saida-sp-core.js';

const TIMEOUT_MS_DEFAULT = 30_000;
const TIMEOUT_MS_MAX = 60_000;

/**
 * Roda o reconhecimento mTLS contra os endpoints candidatos da SEFAZ-SP.
 *
 * @param {object} p
 * @param {{ pfxBuffer: Buffer, password: string }} p.cert  cert A1 da empresa (loadCertEmpresa)
 * @param {string[]} [p.extraUrls]  endpoints extras a sondar
 * @param {number}   [p.timeoutMs]  timeout por requisicao
 * @returns {Promise<{ certInfo, sondagens, veredito }>}
 */
export async function reconhecerSaidaSp({ cert, extraUrls = [], timeoutMs = TIMEOUT_MS_DEFAULT }) {
  if (!cert || !cert.pfxBuffer) throw new Error('cert sem pfxBuffer (A1 da empresa nao carregado)');
  const to = Math.min(Number(timeoutMs) || TIMEOUT_MS_DEFAULT, TIMEOUT_MS_MAX);

  // Identidade do titular (nunca expoe a senha). Falha cedo se .pfx/senha ruins.
  const certInfo = inspecionarCert(cert.pfxBuffer, cert.password);

  const alvos = [
    ...ENDPOINTS_CANDIDATOS,
    ...extraUrls.map((u, i) => ({
      id: `extra-${i + 1}`, label: 'Extra (--url)', url: u,
      porqueImporta: 'informado na chamada da rota',
    })),
  ];

  // Sonda em SERIE (nao paralelizo: evita parecer varredura agressiva contra
  // portal .gov.br e disparar rate-limit/WAF por volume).
  const sondagens = [];
  for (const alvo of alvos) {
    const r = await sondarEndpoint(alvo.url, cert.pfxBuffer, cert.password, to);
    sondagens.push({ ...r, id: alvo.id, label: alvo.label, porqueImporta: alvo.porqueImporta });
  }

  const houveWaf = sondagens.some(s => s.waf?.bloqueado);
  const algumMtls = sondagens.some(s => s.handshakeMtlsOk);

  return {
    certInfo,
    sondagens,
    veredito: {
      houveWaf,
      algumMtls,
      // Sinal de PARAR (instrucao do dono): WAF/captcha exige pivotar a rota.
      recomendacao: houveWaf
        ? 'WAF/captcha detectado — PARAR e pivotar a rota de descoberta.'
        : algumMtls
          ? 'Handshake mTLS ok sem WAF — seguir mapeando a tela de NF-e emitidas.'
          : 'Nenhum endpoint completou mTLS — revisar cert/cadeia/egress.',
    },
  };
}
