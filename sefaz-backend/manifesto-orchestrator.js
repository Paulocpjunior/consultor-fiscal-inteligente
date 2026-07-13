// ============================================================================
// sefaz-backend/manifesto-orchestrator.js  (ESM)
// Orquestrador de manifestação automática.
// ============================================================================

import admin from 'firebase-admin';
import { manifestarNFe, TIPOS_MANIFESTACAO } from './manifesto-client.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { loadCertEmpresa, loadCertEmpresaPorCnpjBase } from './cert-storage.js';
import { loadCertificate, extrairPem } from './secret-loader.js';
import { consultaNFePorChave } from './sefaz-client.js';
import { carregarFlagsEmpresa, CNPJ_ESCRITORIO } from './empresa-flags.js';

const TIPOS_QUE_BLOQUEIAM_NOVA_MANIFESTACAO = new Set([
  'manifestacao_ciencia',
  'manifestacao_confirmacao',
  'manifestacao_desconhecimento',
  'manifestacao_nao_realizada',
]);

const STATUS_QUE_BLOQUEIAM = new Set(['cancelado', 'denegado', 'inutilizado']);

// Prazo SEFAZ (Ajuste SINIEF 9/2007 Cláusula 21 + Manual ENT 6.0):
//   Ciência/Confirmação:        ate 180 dias da emissao (cienca automatica apos)
//   Desconhecimento:            ate 10 dias da ciencia (automatica ou manual)
//   Operacao Nao Realizada:     ate 10 dias da ciencia
//
// Como o app nem sempre tem registro da ciencia automatica, usamos a
// emissao como referencia. Como buffer conservador: 180 dias pra
// Ciencia/Confirmacao (regra geral) e 30 dias pra Desconhecimento/Nao
// Realizada (com aviso pro contador conferir manualmente o prazo).
const IDADE_MAX_DIAS_POR_TIPO = {
  ciencia: 180,
  confirmacao: 180,
  desconhecimento: 30,
  nao_realizada: 30,
};
const IDADE_MAX_PADRAO = 180;

function fa() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin;
}

function temManifestacao(doc) {
  const eventos = doc.eventos || [];
  return eventos.some(e => TIPOS_QUE_BLOQUEIAM_NOVA_MANIFESTACAO.has(e.tipo));
}

function ehElegivel(doc, tipoPretendido = 'ciencia') {
  if (doc.direcao !== 'entrada') return { ok: false, motivo: 'Não é entrada' };
  if (STATUS_QUE_BLOQUEIAM.has(doc.status)) return { ok: false, motivo: `status=${doc.status}` };
  if (temManifestacao(doc)) return { ok: false, motivo: 'Já manifestada' };
  if (doc.dhEmi) {
    const idadeDias = (Date.now() - new Date(doc.dhEmi).getTime()) / (1000 * 3600 * 24);
    const idadeMax = IDADE_MAX_DIAS_POR_TIPO[tipoPretendido] ?? IDADE_MAX_PADRAO;
    if (idadeDias > idadeMax) return { ok: false, motivo: `Emitida há ${Math.round(idadeDias)} dias (>${idadeMax} pra '${tipoPretendido}')` };
    if (idadeDias < 0) return { ok: false, motivo: 'dhEmi futuro?' };
  }
  if (!doc.empresaCnpj && !doc.cnpjDest) return { ok: false, motivo: 'Sem CNPJ destinatário' };
  return { ok: true };
}

export async function listarElegiveis({ empresaId = null, limit = 50, tipo = 'ciencia' } = {}) {
  const db = fa().firestore();
  // 'in' inclui os RESUMOS (resNFe): sao exatamente eles que precisam de
  // Ciencia pra SEFAZ liberar a procNFe completa. O filtro antigo
  // tipoDoc=='NFe' manifestava so notas ja completas e deixava os resumos
  // presos como "Resumo/R$ sem itens" pra sempre.
  let baseQuery = db.collection('documentos_fiscais')
    .where('direcao', '==', 'entrada')
    .where('tipoDoc', 'in', ['resNFe', 'NFe']);
  if (empresaId) baseQuery = baseQuery.where('empresaId', '==', empresaId);

  // Pagina sem limite arbitrario; corta pela quantidade de elegiveis,
  // nao pela query bruta (antes truncava em 500 e podia faltar candidatos).
  const snapDocs = await fetchAllDocs(baseQuery, { label: 'documentos_fiscais/manifest-elegiveis' });
  const elegiveis = [];
  for (const d of snapDocs) {
    const doc = { id: d.id, ...d.data() };
    const check = ehElegivel(doc, tipo);
    if (check.ok) elegiveis.push(doc);
  }
  // Resumos primeiro: quando o limit corta, prioriza quem destrava XML completo.
  elegiveis.sort((a, b) => (a.tipoDoc === 'resNFe' ? 0 : 1) - (b.tipoDoc === 'resNFe' ? 0 : 1));
  return elegiveis.slice(0, limit);
}

// Resolve o certificado A1 que ASSINA o evento. A SEFAZ exige que o autor do
// evento (CNPJ destinatário) tenha a mesma raiz CNPJ do certificado — o cert
// do escritório era usado pra todos e a manifestação de clientes voltava
// rejeitada (autor ≠ cert), deixando os resumos sem upgrade pra completa.
async function resolverCertDestinatario(cnpjDestinatario, empresaId = null) {
  const cnpjNum = String(cnpjDestinatario || '').replace(/\D/g, '');
  let cert = null;
  if (empresaId) {
    try {
      cert = await loadCertEmpresa(empresaId);
      const notAfterMs = cert?.notAfter ? Date.parse(cert.notAfter) : null;
      if (notAfterMs && notAfterMs <= Date.now()) {
        console.warn(`[manifesto] cert da empresa ${empresaId} vencido em ${cert.notAfter}; buscando A1 da mesma raiz`);
        cert = null;
      }
    } catch (e) {
      console.warn(`[manifesto] erro carregando cert empresa ${empresaId}:`, e.message);
    }
  }
  if (!cert && cnpjNum !== CNPJ_ESCRITORIO) {
    try {
      cert = await loadCertEmpresaPorCnpjBase(cnpjNum, empresaId);
    } catch (e) {
      console.warn(`[manifesto] erro buscando cert por raiz CNPJ ${cnpjNum}:`, e.message);
    }
  }
  if (cert) {
    const certBase = String(cert.cnpj || '').replace(/\D/g, '').slice(0, 8);
    if (certBase && certBase !== cnpjNum.slice(0, 8)) {
      console.warn(`[manifesto] cert encontrado tem raiz ${certBase}, esperado ${cnpjNum.slice(0, 8)} — ignorando`);
      cert = null;
    }
  }
  if (cert) {
    const pem = extrairPem(cert.pfxBuffer, cert.password);
    // pkcs12 + pfxBuffer: manifesto-client usa pkcs12 no mTLS; sefaz-client
    // (consChNFe do re-download) usa pfxBuffer. Mantém os dois preenchidos.
    return {
      pemKey: pem.pemKey, pemCert: pem.pemCert,
      pkcs12: cert.pfxBuffer, pfxBuffer: cert.pfxBuffer,
      password: cert.password, cnpj: cert.cnpj,
    };
  }
  // Escritório manifestando as próprias notas: cert global do Secret Manager.
  if (cnpjNum.slice(0, 8) === CNPJ_ESCRITORIO.slice(0, 8)) {
    return loadCertificate();
  }
  throw new Error(
    `Manifestação exige A1 da raiz CNPJ do destinatário (${cnpjNum}) e nenhum certificado válido foi encontrado. ` +
    `Envie o A1 da empresa — o certificado do escritório não pode assinar evento de cliente (SEFAZ rejeita autor de raiz diferente).`
  );
}

// Depois da Ciência/Confirmação aceita, a SEFAZ libera a procNFe completa.
// Antes o app esperava a completa "aparecer" num próximo DistDFe (que podia
// nunca reprocessá-la); agora busca na hora via consulta por chave e importa
// (o xml-importer faz o upgrade resumo→completa).
async function baixarCompletaAposManifestacao({ chNFe, cnpjDestinatario, empresaId, uf, certOverride, capturadoPor }) {
  try {
    if (!empresaId) return { ok: false, motivo: 'sem empresaId — completa virá no próximo DistDFe' };
    const ufFinal = uf || (await carregarFlagsEmpresa(empresaId, cnpjDestinatario)).uf;
    if (!ufFinal) return { ok: false, motivo: 'UF não cadastrada — completa virá no próximo DistDFe' };
    // SEFAZ leva alguns segundos pra propagar o evento antes de liberar o XML.
    await new Promise(r => setTimeout(r, 3000));
    const r = await consultaNFePorChave({ chave: chNFe, cnpjInteressado: cnpjDestinatario, uf: ufFinal, certOverride });
    if (r.rateLimited) return { ok: false, motivo: 'SEFAZ cStat 656 (rate limit)' };
    const { importarXmlSefaz } = await import('./xml-importer.js');
    let importados = 0;
    for (const doc of r.xmls || []) {
      if (!doc.xml) continue;
      const imp = await importarXmlSefaz({
        empresaId, empresaCnpj: cnpjDestinatario,
        xml: doc.xml, schema: doc.schema, nsu: doc.nsu,
        capturadoPor: { ...(capturadoPor || {}), motivo: 'redownload-pos-manifestacao' },
      });
      if (imp.status === 'ok' || imp.status === 'atualizado') importados++;
    }
    return { ok: true, cStat: r.cStat, docsRetornados: (r.xmls || []).length, importados };
  } catch (e) {
    console.warn(`[manifesto] re-download pós-manifestação ${chNFe} falhou:`, e.message);
    return { ok: false, motivo: e.message };
  }
}

export async function manifestarUma({ chNFe, cnpjDestinatario, tipo = 'ciencia', xJustificativa = null, dryRun = false, capturadoPor = null, empresaId = null, uf = null }) {
  if (!TIPOS_MANIFESTACAO.includes(tipo)) {
    throw new Error(`Tipo inválido: ${tipo}. Use: ${TIPOS_MANIFESTACAO.join(', ')}`);
  }

  // Validacao fiscal — operacao IRREVERSIVEL na SEFAZ.
  // Manual ENT 6.0: operacao_nao_realizada exige justificativa 15-255 chars.
  // Desconhecimento aceita justificativa opcional. Ciencia/Confirmacao nao usam.
  if (tipo === 'operacao_nao_realizada' || tipo === 'nao_realizada') {
    const just = String(xJustificativa || '').trim();
    if (just.length < 15) {
      throw new Error(`Manifestacao 'operacao_nao_realizada' EXIGE xJustificativa com 15-255 caracteres (Manual SEFAZ ENT 6.0). Recebido: ${just.length} chars.`);
    }
    if (just.length > 255) {
      throw new Error(`xJustificativa deve ter no maximo 255 caracteres (Manual SEFAZ ENT 6.0). Recebido: ${just.length} chars.`);
    }
  }

  // Assina com o A1 da EMPRESA destinatária (nunca o do escritório pra cliente).
  const certOverride = await resolverCertDestinatario(cnpjDestinatario, empresaId);
  const result = await manifestarNFe({ chNFe, cnpjDestinatario, tipo, xJustificativa, dryRun, certOverride });

  const db = fa().firestore();
  const auditoria = {
    chNFe,
    cnpjDestinatario,
    tipo,
    dryRun,
    idAttr: result.idAttr,
    capturadoPor: capturadoPor || null,
    createdAt: fa().firestore.FieldValue.serverTimestamp(),
  };

  if (!dryRun && result.retorno) {
    auditoria.cStatLote = result.retorno.cStatLote;
    auditoria.xMotivoLote = result.retorno.xMotivoLote;
    auditoria.eventosRetornados = result.retorno.eventos;

    const evtAceito = result.retorno.eventos.find(e => ['135', '136'].includes(e.cStat));
    if (evtAceito) {
      const docRef = db.collection('documentos_fiscais').doc(chNFe);
      const snap = await docRef.get();
      if (snap.exists && !empresaId) empresaId = snap.data().empresaId || null;
      if (snap.exists) {
        const eventosExistentes = snap.data().eventos || [];
        const novoEvento = {
          tpEvento: evtAceito.tpEvento,
          tipo: `manifestacao_${tipo}`,
          descricao: tipo === 'ciencia' ? 'Ciência da Operação' :
                     tipo === 'confirmacao' ? 'Confirmação da Operação' :
                     tipo === 'desconhecimento' ? 'Desconhecimento da Operação' :
                     'Operação não Realizada',
          nSeqEvento: '1',
          dhEvento: evtAceito.dhRegEvento,
          nProt: evtAceito.nProt,
          cStat: evtAceito.cStat,
          xMotivo: evtAceito.xMotivo,
          importadoPor: capturadoPor?.email || 'manifesto-auto',
        };
        await docRef.update({ eventos: [...eventosExistentes, novoEvento] });
      }
      // Ciência/Confirmação aceita → busca a procNFe completa na hora.
      if (tipo === 'ciencia' || tipo === 'confirmacao') {
        auditoria.baixaCompleta = await baixarCompletaAposManifestacao({
          chNFe,
          cnpjDestinatario: String(cnpjDestinatario).replace(/\D/g, ''),
          empresaId, uf, certOverride, capturadoPor,
        });
      }
    }
  }

  await db.collection('manifestacoes_log').add(auditoria);
  return result;
}

export async function manifestarPendentes({ empresaId = null, limit = 50, dryRun = false, tipo = 'ciencia', capturadoPor = null } = {}) {
  const elegiveis = await listarElegiveis({ empresaId, limit, tipo });
  const resultado = { total: elegiveis.length, sucessos: 0, falhas: 0, detalhes: [] };

  for (const doc of elegiveis) {
    try {
      const r = await manifestarUma({
        chNFe: doc.chave,
        cnpjDestinatario: doc.empresaCnpj || doc.cnpjDest,
        tipo,
        dryRun,
        capturadoPor,
        empresaId: doc.empresaId || null,
      });
      const cStat = r.retorno?.eventos?.[0]?.cStat;
      const aceito = ['135', '136'].includes(cStat);
      if (aceito || dryRun) {
        resultado.sucessos++;
      } else {
        resultado.falhas++;
      }
      resultado.detalhes.push({
        chNFe: doc.chave, empresaId: doc.empresaId, tipo, dryRun,
        cStat, xMotivo: r.retorno?.eventos?.[0]?.xMotivo,
      });
    } catch (err) {
      resultado.falhas++;
      resultado.detalhes.push({
        chNFe: doc.chave, empresaId: doc.empresaId, tipo, dryRun,
        erro: err.message,
      });
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  return resultado;
}
