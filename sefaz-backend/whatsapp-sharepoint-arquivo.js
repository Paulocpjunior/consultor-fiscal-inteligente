// ============================================================================
// sefaz-backend/whatsapp-sharepoint-arquivo.js  (ESM)
// ----------------------------------------------------------------------------
// Arquiva no SharePoint a MÍDIA das conversas do SP Connect (foto, áudio,
// vídeo, documento — tudo que não é texto), na regra do manual da casa
// (Paulo, 21/08: *"no nosso manual tudo que nao for msg de texto deve ser
// salvo no sharepoint"*). O binário já mora no NOSSO Storage desde a chegada
// (F1 do webhook baixa da Meta na hora); aqui ele ganha a cópia no
// SharePoint, que é onde a equipe trabalha.
//
// A ÁRVORE É GENÉRICA DE PROPÓSITO (decisão do Paulo, 21/08: *"pasta generica
// dentro do Sharepoint, recebemos muitos curriculos de pessoas que nao sao
// nossos clientes"*): muito contato do WhatsApp não é cliente (currículo,
// lead), então a pasta não pode depender de vínculo com empresa —
//
//   SP Connect/{ano}/{mes}-{ano}/{nome ou empresa} - {numero}/
//
// Quando o contato TEM vínculo, o nome da empresa vira o rótulo da pasta;
// sem vínculo, o nome do perfil do WhatsApp; sem nada, o número. O vínculo
// melhora o rótulo, nunca é pré-requisito — pré-requisito seria repetir o
// `semConfig` do arquivo fiscal, e aqui o caso SEM cadastro é justamente o
// que motivou a pasta.
//
// Mesmo desenho do cofre-sharepoint-arquivo (o arquivador dos XMLs): cursor
// progressivo retomável, marca `spArquivadoEm` no doc, falha de upload conta
// e segue (o doc volta na próxima rodada). Upload pelo MESMO proxy.
// ============================================================================

import admin from 'firebase-admin';

const PROXY_URL = process.env.SHAREPOINT_PROXY_URL
  || 'https://consultor-fiscal-proxy-631239634290.us-west1.run.app';
const PROXY_TOKEN = process.env.SHAREPOINT_PROXY_TOKEN || process.env.PROXY_SHARED_TOKEN || '';
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'consultor-fiscal-inteligente';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;

/** Raiz da árvore no SharePoint — irmã de "Empresas", nunca dentro dela. */
export const RAIZ_SP_CONNECT = 'SP Connect';

function getDb() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin.firestore();
}

/**
 * Um pedaço de caminho aceitável pro SharePoint: sem os caracteres que ele
 * recusa (" * : < > ? / \ |), sem ponto/espaço nas bordas. Vazio vira null —
 * quem chama decide o fallback (aqui, o número, que sempre existe).
 */
export function sanitizarComponenteSp(texto) {
  const limpo = String(texto ?? '')
    .replace(/["*:<>?/\\|#%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80);
  return limpo || null;
}

/** Ano/mês (fuso de SP) do timestamp da MENSAGEM — não do momento do upload. */
export function competenciaDaMensagem(timestampIso) {
  const t = Date.parse(timestampIso || '');
  if (!Number.isFinite(t)) return null;
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date(t)).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  return { ano: p.year, mes: p.month };
}

/**
 * Pasta da mídia no SharePoint. Rótulo por prioridade: EMPRESA vinculada >
 * nome do perfil > só o número — o número vai SEMPRE no fim, porque nome de
 * perfil do WhatsApp repete (dois "Maria") e a pasta precisa ser reencontrável
 * pela conversa.
 */
export function pastaArquivoWhatsapp({ numero, nomePerfil, empresaNome, timestamp } = {}) {
  const num = String(numero || '').replace(/\D/g, '');
  const comp = competenciaDaMensagem(timestamp);
  if (!num || !comp) return null;
  const rotuloBase = sanitizarComponenteSp(empresaNome) || sanitizarComponenteSp(nomePerfil);
  const rotulo = rotuloBase ? `${rotuloBase} - ${num}` : num;
  return `${RAIZ_SP_CONNECT}/${comp.ano}/${comp.mes}-${comp.ano}/${rotulo}`;
}

/**
 * Mensagem precisa de arquivo no SharePoint? Regra PURA (testável).
 * - `midia.storagePath` é o pré-requisito: sem o binário no Storage não há o
 *   que subir (mensagem de texto, banner por link, download que falhou —
 *   este último volta a ser elegível quando o download completar).
 * - `spArquivadoEm` é a marca de idempotência (mesmo desenho do fiscal).
 * - Nota interna nunca sai da casa — mesmo com anexo, ela é conversa da
 *   equipe, não documento do contato.
 */
export function elegivelParaArquivoWhatsapp(doc) {
  if (!doc) return { ok: false, motivo: 'doc-vazio' };
  if (doc.spArquivadoEm) return { ok: false, motivo: 'ja-arquivado' };
  if (doc.direcao === 'interna') return { ok: false, motivo: 'nota-interna' };
  if (!doc.midia || !doc.midia.storagePath) return { ok: false, motivo: 'sem-midia-no-storage' };
  if (!doc.conversaId) return { ok: false, motivo: 'sem-conversa' };
  if (!competenciaDaMensagem(doc.timestamp)) return { ok: false, motivo: 'sem-timestamp' };
  return { ok: true };
}

/** Nome do arquivo no SharePoint = o basename que o Storage já usa (único pelo wamid). */
export function nomeArquivoSp(storagePath) {
  const base = String(storagePath || '').split('/').pop() || '';
  return sanitizarComponenteSp(base) || null;
}

async function fetchProxyUpload(folderPath, filename, contentBase64, mimeType) {
  const resp = await fetch(`${PROXY_URL}/api/sharepoint/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(PROXY_TOKEN ? { Authorization: `Bearer ${PROXY_TOKEN}` } : {}) },
    body: JSON.stringify({ folderPath, filename, contentBase64, mimeType: mimeType || 'application/octet-stream' }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Proxy upload ${resp.status}`);
  }
  return resp.json();
}

const STATE_ARQUIVO = 'whatsapp_sp_arquivo_state/estado';

/**
 * Arquiva no SharePoint as mídias ainda não arquivadas — backfill progressivo
 * por cursor de id (retomável), como o arquivador fiscal. Roda no MESMO cron
 * do arquivo fiscal (sem scheduler novo) e no botão da ⚙️ do Connect.
 *
 * @param {object} [p]
 * @param {number} [p.maxDocs=100]      teto de UPLOADS por rodada
 * @param {number} [p.maxLeituras=2000] teto de docs varridos por rodada
 */
export async function arquivarMidiasWhatsappNoSharePoint({ maxDocs = 100, maxLeituras = 2000 } = {}) {
  const t0 = Date.now();
  const db = getDb();
  const bucket = admin.storage().bucket(STORAGE_BUCKET);

  const r = {
    ok: true, escopo: 'midias-sp-connect',
    lidos: 0, candidatos: 0, arquivados: 0,
    semMidia: 0, notasInternas: 0, outrosSkip: 0,
    erros: 0, errosDetalhe: [],
    cicloCompleto: false, pausadoPorTeto: false,
  };

  const stateRef = db.doc(STATE_ARQUIVO);
  let cursor = null;
  try {
    const st = await stateRef.get();
    cursor = st.exists ? (st.data().cursor || null) : null;
  } catch { /* sem estado ainda — começa do início */ }

  // Contatos consultados uma vez por rodada (o rótulo da pasta vem deles).
  const contatos = new Map();
  const contatoDe = async (numero) => {
    if (contatos.has(numero)) return contatos.get(numero);
    let c = {};
    try {
      const snap = await db.collection('whatsapp_contatos').doc(numero).get();
      c = snap.exists ? (snap.data() || {}) : {};
    } catch { /* contato ilegível não impede o arquivo — cai no número */ }
    const info = { nomePerfil: c.nomeExibicao || c.nomePerfil || null, empresaNome: c.empresaNome || null };
    contatos.set(numero, info);
    return info;
  };

  const PAGINA = 500;
  varredura:
  while (r.lidos < maxLeituras) {
    let q = db.collection('whatsapp_mensagens')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(Math.min(PAGINA, maxLeituras - r.lidos));
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) {
      cursor = null;
      r.cicloCompleto = true;
      break;
    }
    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      const elig = elegivelParaArquivoWhatsapp(data);

      // Orçamento de upload esgotado: para SEM avançar o cursor por cima
      // deste doc — ele abre a próxima rodada (nada fica pra trás).
      if (elig.ok && r.arquivados >= maxDocs) {
        r.pausadoPorTeto = true;
        break varredura;
      }

      r.lidos++;
      cursor = docSnap.id;

      if (!elig.ok) {
        if (elig.motivo === 'sem-midia-no-storage') r.semMidia++;
        else if (elig.motivo === 'nota-interna') r.notasInternas++;
        else if (elig.motivo !== 'ja-arquivado') r.outrosSkip++;
        continue;
      }

      const contato = await contatoDe(data.conversaId);
      const folderPath = pastaArquivoWhatsapp({
        numero: data.conversaId,
        nomePerfil: contato.nomePerfil,
        empresaNome: contato.empresaNome,
        timestamp: data.timestamp,
      });
      const filename = nomeArquivoSp(data.midia.storagePath);
      if (!folderPath || !filename) { r.outrosSkip++; continue; }

      r.candidatos++;
      try {
        const [buf] = await bucket.file(data.midia.storagePath).download();
        const up = await fetchProxyUpload(folderPath, filename, buf.toString('base64'), data.midia.mime);
        await docSnap.ref.set({
          spArquivadoEm: admin.firestore.FieldValue.serverTimestamp(),
          spFolderPath: folderPath,
          spWebUrl: up.webUrl || null,
        }, { merge: true });
        r.arquivados++;
      } catch (e) {
        r.erros++;
        if (r.errosDetalhe.length < 15) r.errosDetalhe.push(`${docSnap.id}: ${e.message}`);
        console.warn(`[whatsapp-arquivo-sp] falha arquivando ${docSnap.id}: ${e.message}`);
      }
    }
  }

  try {
    await stateRef.set({
      cursor,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      ...(r.cicloCompleto ? { ciclosCompletos: admin.firestore.FieldValue.increment(1) } : {}),
      ultimaRodada: {
        lidos: r.lidos, arquivados: r.arquivados, erros: r.erros, cicloCompleto: r.cicloCompleto,
        em: new Date().toISOString(),
      },
    }, { merge: true });
  } catch (e) {
    console.warn('[whatsapp-arquivo-sp] erro persistindo cursor:', e.message);
  }

  r.duracaoMs = Date.now() - t0;
  console.log(`[whatsapp-arquivo-sp] lidos=${r.lidos} arquivados=${r.arquivados} erros=${r.erros} ciclo=${r.cicloCompleto} ${r.duracaoMs}ms`);
  return r;
}
