// ============================================================================
// sefaz-backend/cofre-sharepoint-arquivo.js  (ESM)  — Fase 3
// ----------------------------------------------------------------------------
// Arquiva no SharePoint os XMLs que o cofre de e-mail importou (saída mod 55 e
// entrada), na MESMA estrutura de pastas que o sync já usa:
//
//   Empresas/{grupo}/DEPARTAMENTO FISCAL/{ano}/{mês}-{ano}/{empresaPasta}/XML {SAÍDA|ENTRADA}
//
// Lê o XML do Firebase Storage (onde o importer gravou), sobe via a rota
// /api/sharepoint/upload do proxy (que tem as credenciais Graph), e marca o doc
// com spArquivadoEm pra não subir duplicado. Idempotente e retomável.
// ============================================================================

import admin from 'firebase-admin';

const PROXY_URL = process.env.SHAREPOINT_PROXY_URL
  || 'https://consultor-fiscal-proxy-631239634290.us-west1.run.app';
const PROXY_TOKEN = process.env.SHAREPOINT_PROXY_TOKEN || process.env.PROXY_SHARED_TOKEN || '';
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'consultor-fiscal-inteligente';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;

function getDb() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin.firestore();
}

/** direcao interna ('saida'/'entrada') → rótulo da pasta ('SAÍDA'/'ENTRADA'). */
export function rotuloDirecao(direcao) {
  return String(direcao) === 'saida' ? 'SAÍDA' : String(direcao) === 'entrada' ? 'ENTRADA' : null;
}

/**
 * Monta o caminho da pasta no SharePoint — MESMA árvore do sharepoint-auto-sync.
 * @returns {string|null} null se faltar dado obrigatório.
 */
export function buildFolderPathArquivo(grupo, empresaPasta, competencia, direcao) {
  const rot = rotuloDirecao(direcao);
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || ''));
  if (!grupo || !empresaPasta || !rot || !m) return null;
  const [, ano, mes] = m;
  return `Empresas/${grupo}/DEPARTAMENTO FISCAL/${ano}/${mes}-${ano}/${empresaPasta}/XML ${rot}`;
}

async function fetchProxyUpload(folderPath, filename, contentBase64) {
  const resp = await fetch(`${PROXY_URL}/api/sharepoint/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(PROXY_TOKEN ? { Authorization: `Bearer ${PROXY_TOKEN}` } : {}) },
    body: JSON.stringify({ folderPath, filename, contentBase64, mimeType: 'application/xml' }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Proxy upload ${resp.status}`);
  }
  return resp.json();
}

// empresas com sharePointConfig completo, indexadas por empresaId.
async function carregarConfigsSharePoint(db) {
  const porId = new Map();
  for (const col of ['simples_empresas', 'lucro_empresas']) {
    const snap = await db.collection(col).get();
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const cfg = d.sharePointConfig;
      if (cfg && cfg.grupo && cfg.empresaPasta) {
        porId.set(doc.id, { grupo: cfg.grupo, empresaPasta: cfg.empresaPasta, nome: d.razaoSocial || d.nome || '—' });
      }
    });
  }
  return porId;
}

/**
 * Arquiva no SharePoint os docs do cofre ainda não arquivados.
 * @param {object} [p]
 * @param {number} [p.maxDocs=200]  teto por rodada
 */
export async function arquivarNoSharePoint({ maxDocs = 200 } = {}) {
  const t0 = Date.now();
  const db = getDb();
  const bucket = admin.storage().bucket(STORAGE_BUCKET);

  const r = {
    ok: true, candidatos: 0, arquivados: 0, semConfig: 0, semStorage: 0,
    semCaminho: 0, erros: 0, errosDetalhe: [], porEmpresa: {},
  };

  const porId = await carregarConfigsSharePoint(db);
  r.empresasComConfig = porId.size;

  // Docs importados pelo cofre (origem=email) ainda não arquivados. Firestore
  // não filtra "campo ausente"; então trazemos por origem e filtramos aqui.
  const snap = await db.collection('documentos_fiscais')
    .where('origem', '==', 'email')
    .limit(maxDocs * 3)
    .get();

  const pendentes = snap.docs.filter((d) => !(d.data() || {}).spArquivadoEm).slice(0, maxDocs);
  r.candidatos = pendentes.length;

  for (const doc of pendentes) {
    const data = doc.data() || {};
    const cfg = porId.get(data.empresaId);
    if (!cfg) { r.semConfig++; continue; }
    if (!data.storagePath) { r.semStorage++; continue; }

    const folderPath = buildFolderPathArquivo(cfg.grupo, cfg.empresaPasta, data.competencia, data.direcao);
    if (!folderPath) { r.semCaminho++; continue; }

    try {
      const [buf] = await bucket.file(data.storagePath).download();
      const up = await fetchProxyUpload(folderPath, `${data.chave || doc.id}.xml`, buf.toString('base64'));
      await doc.ref.set({
        spArquivadoEm: admin.firestore.FieldValue.serverTimestamp(),
        spWebUrl: up.webUrl || null,
        spFolderPath: folderPath,
      }, { merge: true });
      r.arquivados++;
      const b = r.porEmpresa[cfg.nome] || (r.porEmpresa[cfg.nome] = { arquivados: 0 });
      b.arquivados++;
    } catch (e) {
      r.erros++;
      if (r.errosDetalhe.length < 15) r.errosDetalhe.push(`${data.chave || doc.id}: ${e.message}`);
      console.warn(`[cofre-sp] falha arquivando ${doc.id}: ${e.message}`);
    }
  }

  r.duracaoMs = Date.now() - t0;
  console.log(`[cofre-sharepoint] candidatos=${r.candidatos} arquivados=${r.arquivados} `
    + `semConfig=${r.semConfig} semCaminho=${r.semCaminho} erros=${r.erros} ${r.duracaoMs}ms`);
  return r;
}
