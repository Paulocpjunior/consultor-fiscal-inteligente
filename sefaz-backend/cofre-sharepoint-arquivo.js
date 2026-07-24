// ============================================================================
// sefaz-backend/cofre-sharepoint-arquivo.js  (ESM)
// ----------------------------------------------------------------------------
// Arquiva no SharePoint os XMLs de TODAS AS CAPTURAS (DistDFe entrada/saída,
// autXML, portal, cofre de e-mail, importação manual/ZIP…), na MESMA estrutura
// de pastas que o sync já usa:
//
//   Empresas/{grupo}/DEPARTAMENTO FISCAL/{ano}/{mês}-{ano}/{empresaPasta}/XML {SAÍDA|ENTRADA}
//
// Até 24/07/2026 só arquivava docs do cofre (origem='email') — as 15k+ notas
// da captura DistDFe ficavam SÓ no app e as pastas SharePoint (local de
// trabalho da equipe) vazias de captura nova. Aprovado pelo Paulo estender a
// todas as capturas, com BACKFILL PROGRESSIVO: caminhada por cursor de id
// (estado em sefaz_sp_arquivo_state/estado) — cada rodada varre um trecho da
// coleção, sobe o que falta e retoma do ponto; ao terminar o ciclo, recomeça
// (idempotente via marca spArquivadoEm; skip não é persistido, então empresa
// que ganhar sharePointConfig depois entra no ciclo seguinte).
//
// Lê o XML do Firebase Storage (onde o importer gravou), sobe via a rota
// /api/sharepoint/upload do proxy (que tem as credenciais Graph), e marca o
// doc com spArquivadoEm pra não subir duplicado.
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

// Doc precisa de arquivo no SharePoint? Regra PURA (testável). Só nota
// COMPLETA vai pro SharePoint: resumo (resNFe) não tem itens/valores — sobe
// depois que a Ciência liberar a procNFe (aí o mesmo doc volta elegível).
export function elegivelParaArquivoSp(doc) {
  if (!doc) return { ok: false, motivo: 'doc-vazio' };
  if (doc.spArquivadoEm) return { ok: false, motivo: 'ja-arquivado' };
  if (!doc.storagePath) return { ok: false, motivo: 'sem-storage' };
  if (String(doc.tipoDoc || '') === 'resNFe') return { ok: false, motivo: 'resumo' };
  if (!rotuloDirecao(doc.direcao)) return { ok: false, motivo: 'sem-direcao' };
  if (!/^\d{4}-\d{2}$/.test(String(doc.competencia || ''))) return { ok: false, motivo: 'sem-competencia' };
  return { ok: true };
}

const STATE_ARQUIVO = 'sefaz_sp_arquivo_state/estado';

/**
 * Arquiva no SharePoint as capturas ainda não arquivadas — TODAS as origens.
 * Backfill progressivo: caminhada por cursor de id (retomável); ao terminar o
 * ciclo, recomeça do zero no próximo run (re-varredura barata: docs já
 * marcados com spArquivadoEm são pulados sem upload).
 *
 * @param {object} [p]
 * @param {number} [p.maxDocs=200]      teto de UPLOADS por rodada (carga no proxy)
 * @param {number} [p.maxLeituras=2000] teto de docs varridos por rodada
 */
export async function arquivarNoSharePoint({ maxDocs = 200, maxLeituras = 2000 } = {}) {
  const t0 = Date.now();
  const db = getDb();
  const bucket = admin.storage().bucket(STORAGE_BUCKET);

  const r = {
    ok: true, escopo: 'todas-as-capturas',
    lidos: 0, candidatos: 0, arquivados: 0,
    semConfig: 0, semStorage: 0, semCaminho: 0, resumos: 0, outrosSkip: 0,
    erros: 0, errosDetalhe: [], porEmpresa: {},
    cicloCompleto: false, pausadoPorTeto: false,
  };

  const porId = await carregarConfigsSharePoint(db);
  r.empresasComConfig = porId.size;

  const stateRef = db.doc(STATE_ARQUIVO);
  let cursor = null;
  try {
    const st = await stateRef.get();
    cursor = st.exists ? (st.data().cursor || null) : null;
  } catch { /* sem estado ainda — começa do início */ }

  const PAGINA = 500;
  varredura:
  while (r.lidos < maxLeituras) {
    let q = db.collection('documentos_fiscais')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(Math.min(PAGINA, maxLeituras - r.lidos));
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) {
      // Fim da coleção: ciclo completo — próximo run recomeça do zero.
      cursor = null;
      r.cicloCompleto = true;
      break;
    }
    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      const elig = elegivelParaArquivoSp(data);
      const cfg = elig.ok ? porId.get(data.empresaId) : null;
      const folderPath = (elig.ok && cfg)
        ? buildFolderPathArquivo(cfg.grupo, cfg.empresaPasta, data.competencia, data.direcao)
        : null;
      const precisaUpload = !!(elig.ok && cfg && folderPath);

      // Orçamento de upload esgotado: PARA SEM avançar o cursor por cima
      // deste doc — ele é o primeiro da próxima rodada (nada fica pra trás).
      if (precisaUpload && r.arquivados >= maxDocs) {
        r.pausadoPorTeto = true;
        break varredura;
      }

      r.lidos++;
      cursor = docSnap.id;

      if (!elig.ok) {
        if (elig.motivo === 'sem-storage') r.semStorage++;
        else if (elig.motivo === 'resumo') r.resumos++;
        else if (elig.motivo !== 'ja-arquivado') r.outrosSkip++;
        continue;
      }
      if (!cfg) { r.semConfig++; continue; }
      if (!folderPath) { r.semCaminho++; continue; }

      r.candidatos++;
      try {
        const [buf] = await bucket.file(data.storagePath).download();
        const up = await fetchProxyUpload(folderPath, `${data.chave || docSnap.id}.xml`, buf.toString('base64'));
        await docSnap.ref.set({
          spArquivadoEm: admin.firestore.FieldValue.serverTimestamp(),
          spWebUrl: up.webUrl || null,
          spFolderPath: folderPath,
        }, { merge: true });
        r.arquivados++;
        const b = r.porEmpresa[cfg.nome] || (r.porEmpresa[cfg.nome] = { arquivados: 0 });
        b.arquivados++;
      } catch (e) {
        // Falha de upload NÃO trava o ciclo: conta, segue, e o doc volta na
        // próxima re-varredura (sem spArquivadoEm ele continua elegível).
        r.erros++;
        if (r.errosDetalhe.length < 15) r.errosDetalhe.push(`${data.chave || docSnap.id}: ${e.message}`);
        console.warn(`[arquivo-sp] falha arquivando ${docSnap.id}: ${e.message}`);
      }
    }
  }

  // Persiste o cursor pra próxima rodada retomar (ou recomeçar, se completou).
  try {
    await stateRef.set({
      cursor,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      ...(r.cicloCompleto ? { ciclosCompletos: admin.firestore.FieldValue.increment(1) } : {}),
      ultimaRodada: {
        lidos: r.lidos, arquivados: r.arquivados, erros: r.erros,
        semConfig: r.semConfig, cicloCompleto: r.cicloCompleto,
      },
    }, { merge: true });
  } catch (e) {
    console.warn('[arquivo-sp] erro persistindo cursor:', e.message);
  }

  r.duracaoMs = Date.now() - t0;
  console.log(`[arquivo-sp] lidos=${r.lidos} arquivados=${r.arquivados} semConfig=${r.semConfig} `
    + `resumos=${r.resumos} erros=${r.erros} ciclo=${r.cicloCompleto} ${r.duracaoMs}ms`);
  return r;
}
