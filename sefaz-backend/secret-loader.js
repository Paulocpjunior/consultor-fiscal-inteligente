// ========================================================================================
// sefaz-backend/secret-loader.js  (ESM)
// Carrega o .pfx + senha do Secret Manager com cache em memória de 5 minutos.
// ========================================================================================

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'consultorfiscalapp';
const SECRET_CERT = process.env.SEFAZ_CERT_NAME || 'sefaz-cert-a1';
const SECRET_PASS = process.env.SEFAZ_PASS_NAME || 'sefaz-cert-password';

const CACHE_TTL_MS = 5 * 60 * 1000;
const client = new SecretManagerServiceClient();
let cache = null;

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
  cache = { pfxBuffer, password, loadedAt: Date.now(), version: certResponse.name.split('/').pop() };
  console.log(`[secret-loader] cert carregado, version=${cache.version}, size=${pfxBuffer.length}B`);
  return cache;
}

export function invalidateCertificateCache() { cache = null; console.log('[secret-loader] cache invalidado'); }
