// ============================================================================
// sefaz-backend/xml-importer.js  (ESM) — v2 com suporte a eventos NFe
// Pipeline: parse XML, sha256, upload Storage, set/update Firestore.
// Diferencial v2: eventos (cancelamento, CC-e) são ANEXADOS à NFe original
// em vez de criados como docs órfãos.
// ============================================================================

import crypto from 'crypto';
import admin from 'firebase-admin';
import { Storage } from '@google-cloud/storage';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'consultorfiscalapp';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const storage = new Storage();

function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

function pickTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function pickAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}\\s+[^>]*${attr}="([^"]+)"`, 'i'));
  return m ? m[1] : null;
}

// Mapeamento de tpEvento (Manual NFe v2.0)
function classificarEvento(tpEvento) {
  const map = {
    '110110': { tipo: 'cce', descricao: 'Carta de Correção Eletrônica' },
    '110111': { tipo: 'cancelamento', descricao: 'Cancelamento de NF-e' },
    '210200': { tipo: 'manifestacao_confirmacao', descricao: 'Confirmação da Operação' },
    '210210': { tipo: 'manifestacao_ciencia', descricao: 'Ciência da Operação' },
    '210220': { tipo: 'manifestacao_desconhecimento', descricao: 'Desconhecimento da Operação' },
    '210240': { tipo: 'manifestacao_nao_realizada', descricao: 'Operação não Realizada' },
    '110140': { tipo: 'epec', descricao: 'EPEC (emergência)' },
  };
  return map[tpEvento] || { tipo: 'outro', descricao: `Evento ${tpEvento}` };
}

// ============================================================================
// 23/05 — Helpers de extracao detalhada (itens, totais, direcao, status)
// Espelham services/xmlParserService.ts (parser manual) em regex puro.
// ============================================================================

function pickAllBlocks(xml, openTag) {
  const re = new RegExp(`<${openTag}\\b[^>]*>([\\s\\S]*?)<\\/${openTag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push({ inner: m[1], attrs: m[0].slice(0, m[0].indexOf('>')) });
  }
  return out;
}

function pickFirstBlock(xml, openTag) {
  const all = pickAllBlocks(xml, openTag);
  return all.length ? all[0].inner : '';
}

function num(v) {
  if (v == null || v === '') return 0;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/**
 * Extrai todos os itens (<det>) de uma NFe completa.
 * Retorna [] se o XML for resumo (resNFe) ou nao tiver <det>.
 */
function extrairItens(xml) {
  const dets = pickAllBlocks(xml, 'det');
  const itens = [];

  for (let i = 0; i < dets.length; i++) {
    const det = dets[i];
    const nItem = (det.attrs.match(/nItem="([^"]+)"/) || [])[1] || String(i + 1);
    const prod = pickFirstBlock(det.inner, 'prod');
    const icms = pickFirstBlock(det.inner, 'ICMS');
    const ipi = pickFirstBlock(det.inner, 'IPI');
    const pis = pickFirstBlock(det.inner, 'PIS');
    const cofins = pickFirstBlock(det.inner, 'COFINS');

    // Bloco interno do ICMS (ICMS00, ICMS10, ..., ICMSSN102, etc.)
    const icmsInnerMatch = icms.match(/<(ICMS\w+)\b[^>]*>([\s\S]*?)<\/\1>/);
    const icmsInner = icmsInnerMatch ? icmsInnerMatch[2] : '';
    const cst = pickTag(icmsInner, 'CST') || pickTag(icmsInner, 'CSOSN');
    const orig = pickTag(icmsInner, 'orig');

    // IPI tem IPITrib aninhado
    const ipiTribInner = pickFirstBlock(ipi, 'IPITrib');

    // PIS: primeiro filho (PISAliq, PISNT, PISOutr, etc.)
    const pisInnerMatch = pis.match(/<(PIS\w+)\b[^>]*>([\s\S]*?)<\/\1>/);
    const pisInner = pisInnerMatch ? pisInnerMatch[2] : '';

    const cofinsInnerMatch = cofins.match(/<(COFINS\w+)\b[^>]*>([\s\S]*?)<\/\1>/);
    const cofinsInner = cofinsInnerMatch ? cofinsInnerMatch[2] : '';

    itens.push({
      nItem,
      cProd: pickTag(prod, 'cProd'),
      xProd: pickTag(prod, 'xProd'),
      ncm: pickTag(prod, 'NCM'),
      cest: pickTag(prod, 'CEST') || null,
      cfop: pickTag(prod, 'CFOP'),
      uCom: pickTag(prod, 'uCom'),
      qCom: num(pickTag(prod, 'qCom')),
      vUnCom: num(pickTag(prod, 'vUnCom')),
      vProd: num(pickTag(prod, 'vProd')),
      vDesc: num(pickTag(prod, 'vDesc')) || null,
      vBC: num(pickTag(icmsInner, 'vBC')),
      aliqIcms: num(pickTag(icmsInner, 'pICMS')),
      vICMS: num(pickTag(icmsInner, 'vICMS')),
      vBCST: num(pickTag(icmsInner, 'vBCST')),
      aliqST: num(pickTag(icmsInner, 'pICMSST')),
      vICMSST: num(pickTag(icmsInner, 'vICMSST')),
      modBC: pickTag(icmsInner, 'modBC'),
      pRedBC: num(pickTag(icmsInner, 'pRedBC')),
      vIPI: num(pickTag(ipiTribInner, 'vIPI')),
      aliqIPI: num(pickTag(ipiTribInner, 'pIPI')),
      vPIS: num(pickTag(pisInner, 'vPIS')),
      aliqPIS: num(pickTag(pisInner, 'pPIS')),
      vCOFINS: num(pickTag(cofinsInner, 'vCOFINS')),
      aliqCOFINS: num(pickTag(cofinsInner, 'pCOFINS')),
      cst,
      orig,
    });
  }
  return itens;
}

/**
 * Extrai totais do bloco <total>/<ICMSTot>. Retorna null se nao tiver.
 */
function extrairTotais(xml) {
  const icmsTot = pickFirstBlock(xml, 'ICMSTot');
  if (!icmsTot) return null;
  return {
    vBC: num(pickTag(icmsTot, 'vBC')),
    vICMS: num(pickTag(icmsTot, 'vICMS')),
    vICMSDeson: num(pickTag(icmsTot, 'vICMSDeson')),
    vFCP: num(pickTag(icmsTot, 'vFCP')),
    vBCST: num(pickTag(icmsTot, 'vBCST')),
    vST: num(pickTag(icmsTot, 'vST')),
    vFCPST: num(pickTag(icmsTot, 'vFCPST')),
    vProd: num(pickTag(icmsTot, 'vProd')),
    vFrete: num(pickTag(icmsTot, 'vFrete')),
    vSeg: num(pickTag(icmsTot, 'vSeg')),
    vDesc: num(pickTag(icmsTot, 'vDesc')),
    vII: num(pickTag(icmsTot, 'vII')),
    vIPI: num(pickTag(icmsTot, 'vIPI')),
    vIPIDevol: num(pickTag(icmsTot, 'vIPIDevol')),
    vPIS: num(pickTag(icmsTot, 'vPIS')),
    vCOFINS: num(pickTag(icmsTot, 'vCOFINS')),
    vOutro: num(pickTag(icmsTot, 'vOutro')),
    vNF: num(pickTag(icmsTot, 'vNF')),
  };
}

/**
 * Mapeia cStat do infProt para status do XmlStatusDocumento do frontend.
 */
function statusFromCStat(xml) {
  const infProt = pickFirstBlock(xml, 'infProt');
  const cStat = pickTag(infProt, 'cStat');
  if (cStat === '100') return 'autorizado';
  if (cStat === '101') return 'cancelado';
  if (cStat === '110') return 'denegado';
  if (cStat === '102') return 'inutilizado';
  if (!cStat) return 'desconhecido';
  return 'rejeitado';
}

/**
 * Decide direcao=entrada|saida comparando emit/dest com empresa-cliente.
 */
function decidirDirecao(cnpjEmit, cnpjDest, empresaCnpj) {
  const norm = c => String(c || '').replace(/\D/g, '');
  const emi = norm(cnpjEmit);
  const dest = norm(cnpjDest);
  const emp = norm(empresaCnpj);
  if (!emp) return 'desconhecida';
  if (emi === emp) return 'saida';
  if (dest === emp) return 'entrada';
  return 'desconhecida';
}

function extrairMetadados(xml, schema) {
  // Chave: cada modelo de DFe tem seu container raiz.
  //   NFe/NFCe -> <infNFe Id="NFe...">  ou <chNFe>
  //   CTe      -> <infCte Id="CTe...">  ou <chCTe>
  //   MDFe     -> <infMDFe Id="MDFe..."> ou <chMDFe>
  //   Eventos  -> <infEvento Id="ID...">
  // Antes so extraia infNFe/infEvento/chNFe — CTe e MDFe vinham com chave=null
  // e eram REJEITADOS no import ('Chave da NFe nao encontrada'), apesar de
  // serem baixados normalmente pelo DistDFe. Por isso CT-e nunca aparecia.
  let chave = pickAttr(xml, 'infNFe', 'Id') ||
              pickAttr(xml, 'infCte', 'Id') ||
              pickAttr(xml, 'infMDFe', 'Id') ||
              pickAttr(xml, 'infEvento', 'Id') ||
              pickTag(xml, 'chNFe') ||
              pickTag(xml, 'chCTe') ||
              pickTag(xml, 'chMDFe') ||
              null;
  // Remove prefixos de letra (NFe/CTe/MDFe/ID) e qualquer nao-digito.
  // O \D final ja tira as letras, mas o replace explicito documenta a intencao.
  if (chave) chave = chave.replace(/^(NFe|CTe|MDFe|ID)/i, '').replace(/\D/g, '');

  const cnpjEmit = pickTag(xml, 'CNPJ') || null;
  const cnpjDest = (() => {
    const destBlock = pickTag(xml, 'dest');
    if (destBlock) {
      const m = destBlock.match(/<CNPJ[^>]*>([^<]+)<\/CNPJ>/i);
      if (m) return m[1].trim();
    }
    return pickTag(xml, 'CNPJDest') || null;
  })();

  const xNome = pickTag(xml, 'xNome') || null;
  const dhEmi = pickTag(xml, 'dhEmi') || pickTag(xml, 'dEmi') || pickTag(xml, 'dhEvento') || null;
  // Valor: NFe usa <vNF>; CTe usa <vTPrest> (valor total da prestacao);
  // MDFe nao tem valor financeiro (so carga). Sem o fallback, CT-e capturado
  // aparecia com valor R$ 0,00.
  const vNF = pickTag(xml, 'vNF') || pickTag(xml, 'vTPrest') || pickTag(xml, 'vRec') || null;
  const tpNF = pickTag(xml, 'tpNF') || null;

  let tipoDoc = 'desconhecido';
  let tipoNormalizado = 'desconhecido';  // alinha com XmlTipoDocumento do frontend (NFe/NFCe/CTe/MDFe/...)
  if (schema?.startsWith('procNFe'))        { tipoDoc = 'NFe';        tipoNormalizado = 'NFe'; }
  else if (schema?.startsWith('resNFe'))    { tipoDoc = 'resNFe';     tipoNormalizado = 'NFe'; }
  else if (schema?.startsWith('procCTe'))   { tipoDoc = 'CTe';        tipoNormalizado = 'CTe'; }
  else if (schema?.startsWith('resCTe'))    { tipoDoc = 'resCTe';     tipoNormalizado = 'CTe'; }
  else if (schema?.startsWith('procMDFe'))  { tipoDoc = 'MDFe';       tipoNormalizado = 'MDFe'; }
  else if (schema?.startsWith('resMDFe'))   { tipoDoc = 'resMDFe';    tipoNormalizado = 'MDFe'; }
  else if (schema?.startsWith('procEPEC'))  { tipoDoc = 'EPEC';       tipoNormalizado = 'NFe'; }
  else if (schema?.startsWith('procEventoNFe'))   { tipoDoc = 'eventoNFe';   tipoNormalizado = 'NFe'; }
  else if (schema?.startsWith('procEventoCTe'))   { tipoDoc = 'eventoCTe';   tipoNormalizado = 'CTe'; }
  else if (schema?.startsWith('procEventoMDFe'))  { tipoDoc = 'eventoMDFe';  tipoNormalizado = 'MDFe'; }
  else if (schema?.startsWith('resEvento'))       { tipoDoc = 'resEvento';   tipoNormalizado = 'NFe'; }

  // Para eventos, extrai metadados específicos
  let evento = null;
  if (tipoDoc === 'eventoNFe' || tipoDoc === 'eventoCTe' || tipoDoc === 'eventoMDFe' || tipoDoc === 'resEvento') {
    const tpEvento = pickTag(xml, 'tpEvento');
    const nSeqEvento = pickTag(xml, 'nSeqEvento');
    const dhEventoTag = pickTag(xml, 'dhEvento');
    const xCorrecao = pickTag(xml, 'xCorrecao');
    const xJust = pickTag(xml, 'xJust');
    const nProt = pickTag(xml, 'nProt');
    const cStat = pickTag(xml, 'cStat');
    const xMotivo = pickTag(xml, 'xMotivo');
    // chNFe pode estar em <chNFe> ou no Id do infEvento (formato ID + tpEvento + chave + nSeq)
    let chNFeRef = pickTag(xml, 'chNFe');
    if (!chNFeRef) {
      const idEvento = pickAttr(xml, 'infEvento', 'Id');
      // Formato: ID110111<44 dígitos><2 dígitos seq>
      if (idEvento && idEvento.length >= 50) {
        const limpo = idEvento.replace(/^ID/i, '');
        if (limpo.length >= 50) chNFeRef = limpo.substring(6, 50);
      }
    }
    const classif = tpEvento ? classificarEvento(tpEvento) : { tipo: 'desconhecido', descricao: 'Evento sem tpEvento' };
    // chNFeRef é SEMPRE 44 dígitos. Se pickTag retornou lixo grande
    // (XML com múltiplos eventos, envelope mal formado, etc), extrai apenas
    // a primeira sequência de 44 dígitos.
    let chNFeLimpa = null;
    if (chNFeRef) {
      const onlyDigits = chNFeRef.replace(/\D/g, '');
      const match = onlyDigits.match(/(\d{44})/);
      chNFeLimpa = match ? match[1] : null;
    }
    evento = {
      tpEvento, nSeqEvento, dhEvento: dhEventoTag,
      xCorrecao, xJust, nProt, cStat, xMotivo,
      chNFeRef: chNFeLimpa,
      tipo: classif.tipo, descricao: classif.descricao,
    };
  }

  // 23/05 — extracao expandida pra Frente 1 (NCM/CFOP/CST)
  const ide = pickFirstBlock(xml, 'ide');
  const numero = pickTag(ide, 'nNF') || null;
  const serie = pickTag(ide, 'serie') || null;
  const natOp = pickTag(ide, 'natOp') || null;
  const infProt = pickFirstBlock(xml, 'infProt');
  const cStat = pickTag(infProt, 'cStat') || null;

  return {
    chave, cnpjEmit, cnpjDest, xNome, dhEmi,
    vNF: vNF ? Number(vNF) : null,
    tpNF, tipoDoc, tipoNormalizado, schema, evento,
    numero, serie, natOp, cStat,
  };
}

function buildStoragePath(empresaId, chave, fallbackName) {
  const safeChave = (chave || '').replace(/\D+/g, '') || `manual-${Date.now()}`;
  const safeEmpresa = empresaId || 'sem-empresa';
  const fileBase = safeChave.length === 44
    ? safeChave
    : `${safeChave}-${(fallbackName || 'doc').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  return `xmls/${safeEmpresa}/${fileBase}.xml`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function anexarEventoNaNFe({ db, chaveNFe, empresaId, evento, storagePath, xmlHash, schema, nsu, capturadoPor, tipoDocNormalizado }) {
  // Persiste evento como subdoc/array dentro da NFe original.
  // Se a NFe original não existir ainda, cria um "stub" com status pendente.
  const docRef = db.collection('documentos_fiscais').doc(chaveNFe);
  const eventoData = {
    tpEvento: evento.tpEvento,
    tipo: evento.tipo,
    descricao: evento.descricao,
    nSeqEvento: evento.nSeqEvento,
    dhEvento: evento.dhEvento,
    nProt: evento.nProt,
    cStat: evento.cStat,
    xMotivo: evento.xMotivo,
    xCorrecao: evento.xCorrecao,
    xJust: evento.xJust,
    storagePath,
    xmlHash,
    schema,
    nsu,
    importadoEm: new Date().toISOString(),
    importadoPor: capturadoPor?.email || 'system',
  };
  // 23/05 FIX: serverTimestamp() nao funciona dentro de array do Firestore.
  // eventoData eh empurrado pro array 'eventos' abaixo, entao usamos ISO string.
  // Bug original causou 3630 NSUs perdidos em xml_erros.

  const snap = await docRef.get();
  if (snap.exists) {
    // Anexa ao array de eventos (sem duplicar pelo nProt)
    const data = snap.data();
    const eventosExistentes = data.eventos || [];
    if (eventoData.nProt && eventosExistentes.some(e => e.nProt === eventoData.nProt)) {
      return { status: 'duplicado_evento', chave: chaveNFe, tipo: evento.tipo };
    }
    const updates = {
      eventos: [...eventosExistentes, eventoData],
    };
    // Se cancelamento, atualiza status da NFe
    if (evento.tipo === 'cancelamento' && evento.cStat === '135') {
      updates.status = 'cancelado';
      updates.canceladoEm = evento.dhEvento;
      updates.canceladoProtocolo = evento.nProt;
    }
    // 23/05 — defesa contra Update() requires...:
    // garante que todos os valores do updates sao definidos antes de chamar.
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) {
        console.warn(`[xml-importer] anexarEventoNaNFe: campo ${k} undefined em updates, removendo`);
        delete updates[k];
      }
    }
    if (Object.keys(updates).length === 0) {
      console.warn('[xml-importer] anexarEventoNaNFe: updates vazio, pulando .update()');
      return { status: 'evento_skip_vazio', chave: chaveNFe };
    }
    await docRef.update(updates);
    return { status: 'evento_anexado', chave: chaveNFe, tipo: evento.tipo };
  } else {
    // Stub: cria um doc parcial pra quando o documento-pai chegar, ela faz merge.
    // 23/05 — adicionado defaults pra campos undefined (numero, serie, etc)
    // 02/06 — tipoDoc/tipo derivam do evento real (NFe/CTe/MDFe), nao hardcoded.
    const tipoFinal = tipoDocNormalizado || 'NFe';
    await docRef.set({
      id: chaveNFe,
      chave: chaveNFe,
      empresaId,
      empresaCnpj: capturadoPor?.empresaCnpj?.replace(/\D/g, '') || null,
      tipoDoc: tipoFinal,
      tipo: tipoFinal,
      status: evento.tipo === 'cancelamento' && evento.cStat === '135' ? 'cancelado' : 'pendente',
      direcao: 'desconhecida', // sera atualizado quando NFe original chegar
      numero: null,
      serie: null,
      natOp: null,
      itens: [],
      totais: null,
      temItens: false,
      cStat: evento.cStat || null,
      schema: schema || null,
      eventos: [eventoData],
      origem: 'sefaz',
      eventosBeforeNFe: true,
      createdAt: fa().firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { status: 'evento_stub_criado', chave: chaveNFe, tipo: evento.tipo };
  }
}

export async function importarXmlSefaz({ empresaId, empresaCnpj, xml, schema, nsu, capturadoPor }) {
  if (!xml) return { status: 'erro', motivo: 'XML vazio' };

  const meta = extrairMetadados(xml, schema);
  if (!meta.chave) return { status: 'erro', motivo: `Chave do documento fiscal nao encontrada no XML (schema: ${schema || 'desconhecido'})` };

  const db = fa().firestore();
  const xmlHash = sha256(xml);

  // ── EVENTOS: caminho separado (anexa ao documento original) ─────────
  // Inclui eventos de CTe e MDFe (cancelamento, CCe, etc), nao so NFe.
  // chNFeRef e a chave do doc referenciado (44 digitos), seja NFe/CTe/MDFe.
  if ((meta.tipoDoc === 'eventoNFe' || meta.tipoDoc === 'eventoCTe' ||
       meta.tipoDoc === 'eventoMDFe' || meta.tipoDoc === 'resEvento') && meta.evento?.chNFeRef) {
    // Sanitiza componentes do path pra não estourar limite de 1024 chars
    // do Firebase Storage. Chave NFe = 44 dígitos exatos; nProt/tpEvento ~15 chars.
    const chRefSafe = String(meta.evento.chNFeRef || '').replace(/\D/g, '').slice(0, 44);
    const idEventoSafe = String(meta.evento.nProt || meta.evento.tpEvento || Date.now())
      .replace(/[^a-zA-Z0-9]/g, '').slice(0, 30);
    const storagePathEvento = `xmls/${empresaId || 'sem-empresa'}/eventos/${chRefSafe || 'sem-chave'}-${idEventoSafe || 'sem-id'}.xml`;
    const bucket = storage.bucket(STORAGE_BUCKET);
    await bucket.file(storagePathEvento).save(xml, {
      contentType: 'application/xml',
      metadata: {
        cacheControl: 'private, max-age=3600',
        metadata: {
          chaveNFe: meta.evento.chNFeRef,
          tpEvento: meta.evento.tpEvento || '',
          empresaId,
          schema: schema || 'unknown',
          nsu: nsu || '',
          capturadoPor: capturadoPor?.email || 'system',
        },
      },
      resumable: false,
    });

    const result = await anexarEventoNaNFe({
      db,
      chaveNFe: meta.evento.chNFeRef,
      empresaId,
      evento: meta.evento,
      storagePath: storagePathEvento,
      xmlHash,
      schema,
      nsu,
      capturadoPor: { ...capturadoPor, empresaCnpj },
      tipoDocNormalizado: meta.tipoNormalizado,
    });

    // Auditoria
    try {
      await db.collection('xml_capturas').add({
        chave: meta.evento.chNFeRef,
        empresaId,
        empresaCnpj: empresaCnpj?.replace(/\D/g, '') || null,
        origem: 'sefaz',
        schema: meta.schema,
        nsu,
        tipoDoc: meta.tipoDoc,
        eventoTipo: meta.evento.tipo,
        eventoTpEvento: meta.evento.tpEvento,
        capturadoPor: capturadoPor || null,
        createdAt: fa().firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.warn('[xml-importer] falha auditoria evento:', e.message);
    }
    return result;
  }

  // ── NFE / RESNFE: caminho original ──────────────────────────────────
  const docId = meta.chave;
  const storagePath = buildStoragePath(empresaId, meta.chave, meta.tipoDoc);
  const docRef = db.collection('documentos_fiscais').doc(docId);

  let existing = null;
  try {
    existing = await docRef.get();
  } catch (e) {
    console.warn('[xml-importer] erro lendo doc existente:', e.message);
  }

  const existingData = existing?.exists ? existing.data() : null;

  // resNFe (resumo, ~531 bytes, SEM itens/valor) x procNFe (NFe COMPLETA).
  // O DistDFe entrega PRIMEIRO o resumo pro destinatario; a NFe completa so e
  // liberada pela SEFAZ APOS a Manifestacao (Ciencia 210210) e chega numa
  // DistDFe/consChNFe posterior. Nesse momento a chave JA EXISTE na base
  // (gravada como resumo). ANTES o import rejeitava como 'duplicado' e
  // DESCARTAVA a nota completa — por isso o valor/itens (ex: BRASLIMPO
  // R$ 547,70) nunca apareciam, mesmo com a Ciencia disparada.
  // Agora: se o que esta na base e RESUMO e o que chega e COMPLETA, faz UPGRADE
  // (sobrescreve com itens/totais/valor, preservando eventos ja anexados).
  const incomingResumo = meta.tipoDoc === 'resNFe' || String(schema || '').startsWith('resNFe');
  const existingResumo = existingData
    ? (String(existingData.schema || '').startsWith('resNFe') || existingData.temItens === false)
    : false;
  const ehUpgradeResumoParaCompleta = !!existingData && existingResumo && !incomingResumo;

  // Duplicidade só quando NÃO é stub-de-evento E NÃO é upgrade resumo→completa.
  if (existing?.exists && !existingData.eventosBeforeNFe && !ehUpgradeResumoParaCompleta) {
    return { status: 'duplicado', chave: meta.chave };
  }

  const bucket = storage.bucket(STORAGE_BUCKET);
  const file = bucket.file(storagePath);
  await file.save(xml, {
    contentType: 'application/xml',
    metadata: {
      cacheControl: 'private, max-age=3600',
      metadata: {
        chave: meta.chave,
        empresaId,
        schema: schema || 'unknown',
        nsu: nsu || '',
        capturadoPor: capturadoPor?.email || 'system',
      },
    },
    resumable: false,
  });

  // 23/05 — extrai itens/totais/direcao/status para docData completo
  const itens = extrairItens(xml);
  const totais = extrairTotais(xml);
  let direcao = decidirDirecao(meta.cnpjEmit, meta.cnpjDest, empresaCnpj);
  const status = statusFromCStat(xml);
  const temItens = itens.length > 0;

  // 23/05 — resNFe (resumo) nao tem <dest> separado, so <CNPJ> do emit.
  // Resumo sempre chega pra DESTINATARIO (manifestacao ou recebimento). Logo:
  // se eh resumo e a empresa-cliente nao eh emit, entao eh entrada.
  const norm = c => String(c || '').replace(/\D/g, '');
  if (direcao === 'desconhecida' && meta.tipoDoc === 'resNFe' && meta.cnpjEmit) {
    if (norm(meta.cnpjEmit) !== norm(empresaCnpj)) {
      direcao = 'entrada';
    }
  }

  // Para o frontend e manifestacao, tipoDoc='NFe' tanto para procNFe quanto resNFe
  // (a distincao fica em temItens/schema). Resumos viram 'NFe' tambem para o
  // manifesto-orchestrator encontra-los (filtra tipoDoc==='NFe').
  let tipoDocFinal = meta.tipoDoc;
  if (meta.tipoDoc === 'resNFe' || meta.tipoDoc === 'NFe') tipoDocFinal = 'NFe';

  const docData = {
    id: docId,
    chave: meta.chave,
    empresaId,
    empresaCnpj: empresaCnpj?.replace(/\D/g, '') || null,
    cnpjEmit: meta.cnpjEmit?.replace(/\D/g, '') || null,
    cnpjDest: meta.cnpjDest?.replace(/\D/g, '') || null,
    xNomeEmit: meta.xNome,
    dhEmi: meta.dhEmi,
    valorTotal: meta.vNF,
    tpNF: meta.tpNF,
    tipoDoc: tipoDocFinal,
    tipo: meta.tipoNormalizado,
    schema: meta.schema,
    nsu,
    storagePath,
    xmlHash,
    origem: 'sefaz',
    // 23/05 campos novos:
    numero: meta.numero,
    serie: meta.serie,
    natOp: meta.natOp,
    status,
    direcao,
    itens,
    totais,
    temItens,
    cStat: meta.cStat,
    createdAt: fa().firestore.FieldValue.serverTimestamp(),
    createdBy: capturadoPor?.uid || null,
    capturadoPor: capturadoPor || null,
    eventosBeforeNFe: false,
  };
  // Merge (preserva array de eventos) quando:
  //  - ja existia stub de evento (eventosBeforeNFe), OU
  //  - e upgrade resumo→completa (preserva eventos/manifestacoes ja anexados
  //    ao resumo, ex: a propria Ciencia que liberou a NFe completa).
  if (existing?.exists && (existingData.eventosBeforeNFe || ehUpgradeResumoParaCompleta)) {
    await docRef.set(docData, { merge: true });
  } else {
    await docRef.set(docData);
  }

  try {
    await db.collection('xml_capturas').add({
      chave: meta.chave,
      empresaId,
      empresaCnpj: empresaCnpj?.replace(/\D/g, '') || null,
      origem: 'sefaz',
      schema: meta.schema,
      nsu,
      tipoDoc: meta.tipoDoc,
      capturadoPor: capturadoPor || null,
      createdAt: fa().firestore.FieldValue.serverTimestamp(),
      createdBy: capturadoPor?.uid || null,
    });
  } catch (e) {
    console.warn('[xml-importer] falha auditoria xml_capturas:', e.message);
  }

  return {
    status: ehUpgradeResumoParaCompleta ? 'atualizado' : 'ok',
    chave: meta.chave,
    tipoDoc: meta.tipoDoc,
    upgrade: ehUpgradeResumoParaCompleta || undefined,
  };
}

export async function registrarErroSefaz({ empresaId, empresaCnpj, motivo, contexto, capturadoPor }) {
  try {
    const db = fa().firestore();
    await db.collection('xml_erros').add({
      empresaId,
      empresaCnpj: empresaCnpj?.replace(/\D/g, '') || null,
      origem: 'sefaz',
      motivo,
      contexto: contexto || null,
      capturadoPor: capturadoPor || null,
      createdAt: fa().firestore.FieldValue.serverTimestamp(),
      createdBy: capturadoPor?.uid || null,
    });
  } catch (e) {
    console.error('[xml-importer] falha ao registrar erro:', e.message);
  }
}
