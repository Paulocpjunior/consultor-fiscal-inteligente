// ============================================================================
// sefaz-backend/distdfe-autxml-orchestrator.js  (ESM)
// ----------------------------------------------------------------------------
// Colheita de SAIDA (e entrada) via <autXML> — a "frente 1" (atuar como
// contador) feita do jeito certo, SEM portal e SEM scraper.
//
// Mecanismo (NT 2014.002 + tag autXML):
//   Quando o CLIENTE emite a NF-e incluindo o CNPJ do ESCRITORIO na tag
//   <autXML>, a SEFAZ passa a distribuir o XML COMPLETO daquela nota para o
//   escritorio, como terceiro autorizado. O escritorio consulta a
//   DistribuicaoDFe com o PROPRIO CNPJ+cert (que casam, entao sem cStat 280/
//   593) e recebe, num unico fluxo distNSU, TODAS as notas em que e autorizado
//   — saidas dos clientes inclusive.
//
// Este orquestrador:
//   1. consulta DistDFe como o escritorio (cnpj+cert do escritorio);
//   2. para cada doc, descobre a empresa-cliente DONA (emit => saida,
//      dest => entrada) casando o CNPJ contra as empresas monitoradas;
//   3. importa pelo MESMO xml-importer (dedup por chave, direcao correta,
//      upgrade resumo->completa).
//
// Cursor proprio em sefaz_autxml_state/{cnpjEscritorio} (nao mexe no
// sefaz_state por-empresa). Dedup por chave torna a sobreposicao inofensiva.
//
// Limite SEFAZ: documentos ficam disponiveis por ~90 dias apos a emissao —
// autXML nao recupera historico anterior a autorizacao (isso e o ZIP).
// ============================================================================

import admin from 'firebase-admin';
import { consultaDistDFe } from './sefaz-client.js';
import { importarXmlSefaz } from './xml-importer.js';

const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');
const UF_ESCRITORIO = process.env.UF_ESCRITORIO || 'SP';
const STATE_COLLECTION = 'sefaz_autxml_state';
const MAX_PAGINAS = 40;

function getDb() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin.firestore();
}

// Mapa cnpj14 -> { empresaId, cnpj, nome } das empresas monitoradas (Simples +
// Lucro). Usado para atribuir cada doc colhido ao cliente correto.
async function mapaEmpresasPorCnpj(db) {
  const mapa = new Map();
  for (const col of ['simples_empresas', 'lucro_empresas']) {
    const snap = await db.collection(col).get();
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const cnpj = String(d.cnpj || '').replace(/\D/g, '');
      if (cnpj.length === 14 && !mapa.has(cnpj)) {
        mapa.set(cnpj, { empresaId: doc.id, cnpj, nome: d.razaoSocial || d.nome || d.fantasia || '—' });
      }
    });
  }
  return mapa;
}

// Extrai CNPJ do emitente e do destinatario, cobrindo procNFe/NFe (blocos
// <emit>/<dest>) e resNFe/resumo (so <CNPJ> do emitente no topo).
function extrairCnpjs(xml) {
  const emitBloco = (xml.match(/<emit\b[\s\S]*?<\/emit>/i) || [''])[0];
  const destBloco = (xml.match(/<dest\b[\s\S]*?<\/dest>/i) || [''])[0];
  const cnpjEmit = (emitBloco.match(/<CNPJ>(\d{14})<\/CNPJ>/) || [])[1]
    || (xml.match(/<resNFe\b[\s\S]*?<CNPJ>(\d{14})<\/CNPJ>/i) || [])[1]
    || null;
  const cnpjDest = (destBloco.match(/<CNPJ>(\d{14})<\/CNPJ>/) || [])[1] || null;
  return { cnpjEmit, cnpjDest };
}

/**
 * Colhe as NF-e (e eventos) em que o ESCRITORIO e autorizado (autXML) e
 * atribui cada uma a empresa-cliente dona.
 *
 * @param {object} [p]
 * @param {object} [p.capturadoPor]
 * @param {number} [p.maxPaginas]  teto de paginas distNSU por chamada
 * @param {boolean} [p.resetNSU]   recomeca do NSU 0 (backfill dos ~90 dias)
 */
export async function colherSaidaAutXML({ capturadoPor = null, maxPaginas = MAX_PAGINAS, resetNSU = false } = {}) {
  const t0 = Date.now();
  const db = getDb();
  const stateRef = db.collection(STATE_COLLECTION).doc(CNPJ_ESCRITORIO);

  let ultNSU = '0';
  if (!resetNSU) {
    const s = await stateRef.get();
    if (s.exists) ultNSU = String((s.data() || {}).ultNSU || '0');
  }

  const empresas = await mapaEmpresasPorCnpj(db);
  const r = {
    ok: true, escritorio: CNPJ_ESCRITORIO, empresasMonitoradas: empresas.size,
    paginas: 0, docs: 0,
    importadasSaida: 0, importadasEntrada: 0, atualizadas: 0, duplicadas: 0,
    eventos: 0, semDono: 0, erros: 0,
    ultNSU, maxNSU: null, detalhePorEmpresa: {},
  };

  let pagina = 0;
  while (pagina < maxPaginas) {
    pagina++;
    let res;
    try {
      res = await consultaDistDFe({ cnpj: CNPJ_ESCRITORIO, ultNSU, uf: UF_ESCRITORIO });
    } catch (e) {
      r.erros++; r.erroFatal = e.message; break;
    }
    r.paginas = pagina;
    r.maxNSU = res.maxNSU || r.maxNSU;

    if (res.rateLimited) { r.rateLimited = true; break; }
    if (res.cStat === '137') { r.ultNSU = res.ultNSU || ultNSU; break; }   // nada novo
    if (res.cStat !== '138') { r.cStatFim = res.cStat; r.xMotivoFim = res.xMotivo; break; }

    for (const doc of res.xmls) {
      r.docs++;
      if (!doc.xml) { r.erros++; continue; }
      const { cnpjEmit, cnpjDest } = extrairCnpjs(doc.xml);

      // Dono = empresa monitorada que aparece como emit (=> saida do cliente)
      // ou dest (=> entrada). Prioriza emit (o autXML e sobre a saida deles).
      let dono = null, tipo = null;
      if (cnpjEmit && empresas.has(cnpjEmit)) { dono = empresas.get(cnpjEmit); tipo = 'saida'; }
      else if (cnpjDest && empresas.has(cnpjDest)) { dono = empresas.get(cnpjDest); tipo = 'entrada'; }
      if (!dono) { r.semDono++; continue; }  // nota do escritorio ou de terceiro nao monitorado

      const bucket = r.detalhePorEmpresa[dono.cnpj]
        || (r.detalhePorEmpresa[dono.cnpj] = { nome: dono.nome, saida: 0, entrada: 0, atualizadas: 0, duplicadas: 0 });
      try {
        const imp = await importarXmlSefaz({
          empresaId: dono.empresaId, empresaCnpj: dono.cnpj,
          xml: doc.xml, schema: doc.schema, nsu: doc.nsu, capturadoPor,
        });
        if (imp.status === 'ok') {
          if (tipo === 'saida') { r.importadasSaida++; bucket.saida++; }
          else { r.importadasEntrada++; bucket.entrada++; }
        } else if (imp.status === 'atualizado') {
          r.atualizadas++; bucket.atualizadas++;   // upgrade resumo->completa
        } else if (imp.status === 'duplicado') {
          r.duplicadas++; bucket.duplicadas++;
        } else if (imp.status === 'evento_anexado' || imp.status === 'evento_stub_criado'
          || imp.status === 'duplicado_evento' || imp.status === 'evento_skip_vazio') {
          r.eventos++;
        } else {
          r.erros++;
        }
      } catch (e) {
        r.erros++;
        console.warn(`[autxml] import falhou nsu=${doc.nsu}:`, e.message);
      }
    }

    // Avanca o cursor distNSU.
    const prox = res.ultNSU || ultNSU;
    if (prox === ultNSU) break;         // seguranca anti-loop
    ultNSU = prox;
    r.ultNSU = ultNSU;
    if (res.maxNSU && Number(ultNSU) >= Number(res.maxNSU)) break;  // chegou ao fim da fila
  }

  // Persiste o cursor + resumo (alimenta painel/relatorio).
  try {
    await stateRef.set({
      cnpj: CNPJ_ESCRITORIO, ultNSU: r.ultNSU, maxNSU: r.maxNSU,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      ultimoResumo: {
        docs: r.docs, saida: r.importadasSaida, entrada: r.importadasEntrada,
        atualizadas: r.atualizadas, duplicadas: r.duplicadas, semDono: r.semDono, erros: r.erros,
        clientesComSaida: Object.values(r.detalhePorEmpresa).filter((e) => e.saida > 0).length,
      },
    }, { merge: true });
  } catch (e) {
    console.warn('[autxml] erro persistindo estado:', e.message);
  }

  r.duracaoMs = Date.now() - t0;
  console.log(`[autxml-harvest] ${r.docs} docs, saida=${r.importadasSaida} entrada=${r.importadasEntrada} `
    + `atualizadas=${r.atualizadas} semDono=${r.semDono} erros=${r.erros} ultNSU=${r.ultNSU}/${r.maxNSU} ${r.duracaoMs}ms`);
  return r;
}
