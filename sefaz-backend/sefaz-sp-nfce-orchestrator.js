// ============================================================================
// sefaz-backend/sefaz-sp-nfce-orchestrator.js  (ESM)
//
// Orquestra a captura de SAIDA de NFC-e (mod 65) via SAE-NFC-e da SEFAZ-SP,
// com o A1 do PROPRIO contribuinte (do cofre):
//   1. varre o periodo em janelas de <=100 dias (limite da NT);
//   2. lista as chaves (paginando via dhEmisUltNfce quando cStat=101);
//   3. para cada chave: dedup em documentos_fiscais; se nova/resumo, baixa o
//      XML completo e importa pelo xml-importer (que marca direcao='saida' —
//      emit==empresa — e faz upgrade resumo->completa).
//
// Throttle entre downloads (a SEFAZ-SP controla por IP). Somente NFC-e; NF-e
// mod 55 fica no trilho do portal.
// ============================================================================

import admin from 'firebase-admin';
import { loadCertEmpresa, loadCertEmpresaPorCnpjBase } from './cert-storage.js';
import { listarChavesNFCe, baixarXmlNFCe } from './sefaz-sp-nfce-client.js';
import { importarXmlSefaz } from './xml-importer.js';

function getDb() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin.firestore();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIA_MS = 86_400_000;
const MAX_JANELA_DIAS = 100;   // limite da NT SAE-NFC-e
const THROTTLE_MS = 400;       // entre downloads (controle por IP da SEFAZ)
const MAX_PAGINAS = 60;        // teto defensivo por janela

// Date -> "AAAA-MM-DDThh:mm" (formato exigido pelo SAE).
function fmt(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Divide [inicio, fim] em janelas de no maximo 100 dias.
function janelas(inicio, fim) {
  const out = [];
  let cur = new Date(inicio);
  while (cur < fim) {
    const prox = new Date(Math.min(cur.getTime() + MAX_JANELA_DIAS * DIA_MS, fim.getTime()));
    out.push([new Date(cur), prox]);
    cur = new Date(prox.getTime() + 60_000);
  }
  return out;
}

/**
 * Captura as NFC-e de saida de um contribuinte via SAE-NFC-e.
 * @param {object} p
 * @param {string} [p.empresaId]  id no cofre (ou informe cnpj)
 * @param {string} [p.cnpj]       CNPJ do contribuinte (raiz ou 14)
 * @param {string} [p.dataInicial] ISO/Date; padrao: fim - 100 dias
 * @param {string} [p.dataFinal]   ISO/Date; padrao: agora
 * @param {number} [p.tpAmb]       1=producao (padrao)
 * @param {object} [p.capturadoPor]
 * @param {number} [p.maxChaves]   teto de seguranca (padrao 5000)
 */
export async function capturarNFCeSaida({
  empresaId = null, cnpj = null, dataInicial = null, dataFinal = null,
  tpAmb = 1, capturadoPor = null, maxChaves = 5000,
}) {
  const cnpj14 = cnpj ? String(cnpj).replace(/\D/g, '') : null;
  const cert = empresaId ? await loadCertEmpresa(empresaId) : (cnpj14 ? await loadCertEmpresaPorCnpjBase(cnpj14) : null);
  if (!cert?.pfxBuffer) {
    return { ok: false, error: 'Certificado A1 do contribuinte nao encontrado no cofre.', empresaId, cnpj: cnpj14 };
  }
  const empCnpj = String(cert.cnpj || cnpj14 || '').replace(/\D/g, '');
  const empId = cert.empresaIdFonte || cert.empresaId || empresaId || null;

  const fim = dataFinal ? new Date(dataFinal) : new Date();
  const ini = dataInicial ? new Date(dataInicial) : new Date(fim.getTime() - MAX_JANELA_DIAS * DIA_MS);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fim.getTime()) || ini >= fim) {
    return { ok: false, error: 'Periodo invalido (dataInicial deve ser anterior a dataFinal).' };
  }

  const db = getDb();
  const r = {
    ok: true, empresaId: empId, cnpj: empCnpj, tpAmb,
    periodo: { de: fmt(ini), ate: fmt(fim) },
    chavesEncontradas: 0, baixadas: 0, importadas: 0, duplicadas: 0, jaCompletas: 0, erros: 0,
    errosDetalhe: [],
  };
  const addErro = (msg) => { r.erros++; if (r.errosDetalhe.length < 10) r.errosDetalhe.push(String(msg).slice(0, 200)); };
  const processadas = () => r.importadas + r.duplicadas + r.jaCompletas;

  for (const [wIni, wFim] of janelas(ini, fim)) {
    let cursor = fmt(wIni);
    const wFimStr = fmt(wFim);
    let cursorAnterior = null;

    for (let pag = 0; pag < MAX_PAGINAS; pag++) {
      let lista;
      try {
        lista = await listarChavesNFCe({ dataHoraInicial: cursor, dataHoraFinal: wFimStr, cert, tpAmb });
      } catch (e) { addErro(`listagem ${cursor}: ${e.message}`); break; }

      if (lista.vazio) break;
      r.chavesEncontradas += lista.chaves.length;

      for (const ch of lista.chaves) {
        if (processadas() >= maxChaves) { r.limiteAtingido = true; break; }
        try {
          const snap = await db.collection('documentos_fiscais').doc(ch).get();
          if (snap.exists && (snap.data() || {}).temItens !== false) { r.jaCompletas++; continue; }
          const dl = await baixarXmlNFCe({ chNFCe: ch, cert, tpAmb });
          await sleep(THROTTLE_MS);
          if (!dl.ok || !dl.nfeProcXml) { addErro(`download ${ch}: cStat ${dl.cStat} ${dl.xMotivo || ''}`); continue; }
          r.baixadas++;
          const imp = await importarXmlSefaz({ empresaId: empId, empresaCnpj: empCnpj, xml: dl.nfeProcXml, schema: null, nsu: null, capturadoPor });
          if (imp.status === 'duplicado') r.duplicadas++;
          else r.importadas++;
        } catch (e) { addErro(`${ch}: ${e.message}`); }
      }
      if (r.limiteAtingido) break;

      // Paginacao: cStat 101 => proximo inicio = dhEmisUltNfce. Guarda contra
      // loop (se o cursor nao avancar, para).
      if (lista.incompleta && lista.dhEmisUltNfce) {
        const prox = String(lista.dhEmisUltNfce).slice(0, 16);
        if (prox === cursorAnterior || prox === cursor) break;
        cursorAnterior = cursor;
        cursor = prox;
        continue;
      }
      break; // lista completa (cStat 100) => proxima janela
    }
    if (r.limiteAtingido) break;
  }

  r.veredito = `${r.importadas} importadas, ${r.jaCompletas} ja completas, ${r.duplicadas} duplicadas, ${r.erros} erros`;
  if (r.errosDetalhe.length === 0) delete r.errosDetalhe;
  return r;
}
