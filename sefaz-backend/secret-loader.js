// ========================================================================================
// sefaz-backend/secret-loader.js  (ESM)
// Carrega o .pfx + senha do Secret Manager com cache em memória de 5 minutos.
// Extrai também PEM (cert + chave privada) pra xml-crypto.
// ========================================================================================

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import forge from 'node-forge';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'consultorfiscalapp';
const SECRET_CERT = process.env.SEFAZ_CERT_NAME || 'sefaz-cert-a1';
const SECRET_PASS = process.env.SEFAZ_PASS_NAME || 'sefaz-cert-password';

const CACHE_TTL_MS = 5 * 60 * 1000;
const client = new SecretManagerServiceClient();
let cache = null;

/**
 * Extrai chave privada e certificado em formato PEM a partir do .pfx (PKCS#12).
 * Necessário pra xml-crypto que não aceita .pfx direto.
 */
export function extrairPem(pfxBuffer, password) {
  const pkcs12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
  const pkcs12 = forge.pkcs12.pkcs12FromAsn1(pkcs12Asn1, password);

  let pemKey = null;
  let pemCert = null;

  // Procura a chave privada
  for (const safeContents of pkcs12.safeContents) {
    for (const safeBag of safeContents.safeBags) {
      if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === forge.pki.oids.keyBag) {
        pemKey = forge.pki.privateKeyToPem(safeBag.key);
      } else if (safeBag.type === forge.pki.oids.certBag) {
        // Pega o primeiro cert (folha — o do CNPJ); ignora cadeia ICP-Brasil
        if (!pemCert) pemCert = forge.pki.certificateToPem(safeBag.cert);
      }
    }
  }

  if (!pemKey) throw new Error('Chave privada não encontrada no .pfx');
  if (!pemCert) throw new Error('Certificado não encontrado no .pfx');

  return { pemKey, pemCert };
}

export async function loadCertificate(force = false) {
  if (!force && cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  const certPath = `projects/${PROJECT_ID}/secrets/${SECRET_CERT}/versions/latest`;
  const passPath = `projects/${PROJECT_ID}/secrets/${SECRET_PASS}/versions/latest`;
  const [certResponse] = await client.accessSecretVersion({ name: certPath });
  const [passResponse] = await client.accessSecretVersion({ name: passPath });
  const pfxBuffer = Buffer.from(certResponse.payload.data);
  const password = passResponse.payload.data.toString('utf-8');

  if (pfxBuffer.length < 100 || pfxBuffer.toString('utf-8', 0, 50).includes('PLACEHOLDER')) {
    throw new Error('Certificado não configurado -- faça upload via Configurações > Certificado Digital');
  }

  // Extrai PEM logo pra cachear (custa ~50ms, mas só roda 1x a cada 5 min)
  let pemKey = null;
  let pemCert = null;
  try {
    const pem = extrairPem(pfxBuffer, password);
    pemKey = pem.pemKey;
    pemCert = pem.pemCert;
  } catch (e) {
    console.warn(`[secret-loader] falha ao extrair PEM (assinatura XML não funcionará): ${e.message}`);
    // Não bloqueia — captura SEFAZ via NFeDistribuicaoDFe (que usa pfx direto) continua funcionando
  }

  cache = {
    // Compatibilidade retroativa: campos antigos
    pfxBuffer,
    password,
    loadedAt: Date.now(),
    version: certResponse.name.split('/').pop(),
    // Aliases pra novo cliente
    pkcs12: pfxBuffer,
    pemKey,
    pemCert,
  };
  console.log(`[secret-loader] cert carregado, version=${cache.version}, size=${pfxBuffer.length}B, pem=${!!pemKey}`);
  return cache;
}

export function invalidateCertificateCache() {
  cache = null;
  console.log('[secret-loader] cache invalidado');
}
