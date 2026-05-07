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
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.appspot.com`;
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

function extrairMetadados(xml, schema) {
  let chave = pickAttr(xml, 'infNFe', 'Id') ||
              pickAttr(xml, 'infEvento', 'Id') ||
              pickTag(xml, 'chNFe') ||
              null;
  if (chave) chave = chave.replace(/^NFe|^ID/i, '').replace(/\D/g, '');

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
  const vNF = pickTag(xml, 'vNF') || null;
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
    evento = {
      tpEvento, nSeqEvento, dhEvento: dhEventoTag,
      xCorrecao, xJust, nProt, cStat, xMotivo,
      chNFeRef: chNFeRef ? chNFeRef.replace(/\D/g, '') : null,
      tipo: classif.tipo, descricao: classif.descricao,
    };
  }

  return {
    chave, cnpjEmit, cnpjDest, xNome, dhEmi,
    vNF: vNF ? Number(vNF) : null,
    tpNF, tipoDoc, tipoNormalizado, schema, evento,
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

async function anexarEventoNaNFe({ db, chaveNFe, empresaId, evento, storagePath, xmlHash, schema, nsu, capturadoPor }) {
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
    importadoEm: fa().firestore.FieldValue.serverTimestamp(),
    importadoPor: capturadoPor?.email || 'system',
  };

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
    await docRef.update(updates);
    return { status: 'evento_anexado', chave: chaveNFe, tipo: evento.tipo };
  } else {
    // Stub: cria um doc parcial pra quando a NFe chegar, ela faz merge
    await docRef.set({
      id: chaveNFe,
      chave: chaveNFe,
      empresaId,
      empresaCnpj: capturadoPor?.empresaCnpj?.replace(/\D/g, '') || null,
      tipoDoc: 'NFe',
      status: evento.tipo === 'cancelamento' && evento.cStat === '135' ? 'cancelado' : 'pendente',
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
  if (!meta.chave) return { status: 'erro', motivo: 'Chave da NFe não encontrada no XML' };

  const db = fa().firestore();
  const xmlHash = sha256(xml);

  // ── EVENTOS: caminho separado (anexa à NFe original) ────────────────
  if ((meta.tipoDoc === 'eventoNFe' || meta.tipoDoc === 'resEvento') && meta.evento?.chNFeRef) {
    // Upload do XML do evento no Storage (path próprio sob "eventos/")
    const storagePathEvento = `xmls/${empresaId || 'sem-empresa'}/eventos/${meta.evento.chNFeRef}-${meta.evento.nProt || meta.evento.tpEvento || Date.now()}.xml`;
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

  // Se já existe E não é stub-de-evento, é duplicidade
  if (existing?.exists && !existing.data().eventosBeforeNFe) {
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
    tipoDoc: meta.tipoDoc,
    tipo: meta.tipoNormalizado,  // alinhado ao XmlTipoDocumento do frontend
    schema: meta.schema,
    nsu,
    storagePath,
    xmlHash,
    origem: 'sefaz',
    createdAt: fa().firestore.FieldValue.serverTimestamp(),
    createdBy: capturadoPor?.uid || null,
    capturadoPor: capturadoPor || null,
    // Reseta o flag eventosBeforeNFe se era stub
    eventosBeforeNFe: false,
  };
  // Se já existia stub com eventos, faz merge (preserva array)
  if (existing?.exists && existing.data().eventosBeforeNFe) {
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

  return { status: 'ok', chave: meta.chave };
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
