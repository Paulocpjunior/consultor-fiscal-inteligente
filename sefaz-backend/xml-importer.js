// ============================================================================
// sefaz-backend/xml-importer.js  (ESM)
// Pipeline server-side: parse XML, sha256, upload Storage, set Firestore.
// Path determinístico = `xmls/{empresaId}/{chave}.xml` (mesmo do frontend).
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
  if (schema?.startsWith('procNFe')) tipoDoc = 'NFe';
  else if (schema?.startsWith('resNFe')) tipoDoc = 'resNFe';
  else if (schema?.startsWith('procEventoNFe')) tipoDoc = 'eventoNFe';
  else if (schema?.startsWith('resEvento')) tipoDoc = 'resEvento';

  return {
    chave, cnpjEmit, cnpjDest, xNome, dhEmi,
    vNF: vNF ? Number(vNF) : null,
    tpNF, tipoDoc, schema,
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

export async function importarXmlSefaz({ empresaId, empresaCnpj, xml, schema, nsu, capturadoPor }) {
  if (!xml) return { status: 'erro', motivo: 'XML vazio' };

  const meta = extrairMetadados(xml, schema);
  if (!meta.chave) return { status: 'erro', motivo: 'Chave da NFe não encontrada no XML' };

  const docId = meta.chave;
  const xmlHash = sha256(xml);
  const storagePath = buildStoragePath(empresaId, meta.chave, meta.tipoDoc);
  const db = fa().firestore();
  const docRef = db.collection('documentos_fiscais').doc(docId);

  try {
    const existing = await docRef.get();
    if (existing.exists) return { status: 'duplicado', chave: meta.chave };
  } catch (e) {
    console.warn('[xml-importer] erro lendo doc existente:', e.message);
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
    schema: meta.schema,
    nsu,
    storagePath,
    xmlHash,
    origem: 'sefaz',
    createdAt: fa().firestore.FieldValue.serverTimestamp(),
    createdBy: capturadoPor?.uid || null,
    capturadoPor: capturadoPor || null,
  };
  await docRef.set(docData);

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
