// ============================================================================
// sefaz-backend/xml-email-ingestor.js  (ESM)
// ----------------------------------------------------------------------------
// INGESTÃO DE XML POR E-MAIL — o "cofre" do CFI, que substitui o cofre da SIEG.
//
// Fluxo (igual ao que a SIEG faz de SAÍDA): o sistema emissor de cada cliente
// manda o XML de cada nota emitida pra uma caixa nossa. Este ingestor lê os
// anexos .xml não-lidos dessa caixa, descobre de qual empresa-cliente é a nota
// (emit => saída, dest => entrada) e importa pelo MESMO importador da captura
// (dedup por chave, upgrade resumo→completa). Depois marca a mensagem como lida
// pra não reprocessar.
//
// Config:
//   XML_INGEST_MAILBOX   caixa a ler (ex.: xml@spassessoriacontabil.com.br)
//   XML_INGEST_MOVE_FOLDER_ID  (opcional) pasta destino p/ mover processados
//
// Não depende da SEFAZ — portanto não sofre o bloqueio 641 da saída mod 55.
// ============================================================================

import admin from 'firebase-admin';
import { importarXmlSefaz } from './xml-importer.js';
import { carregarEmpresas, atribuirXml } from './xml-empresa-matcher.js';
import { listarEmailsComXml, marcarProcessada } from './graph-mail-reader.js';
import { extrairXmlsDoZip } from './zip-reader.js';

const STATE_DOC = 'sefaz_xml_email_state/estado';
// Registro de mensagens JÁ PROCESSADAS — o controle passou a ser NOSSO
// (27/07). Antes o cofre só lia e-mail não-lido: bastava alguém da equipe abrir
// a caixa no Outlook pra a nota do cliente sumir do radar pra sempre.
const COL_MSGS = 'cofre_email_mensagens';

// Caixa do "cofre" do CFI. Default = a caixa do escritório (mesmo padrão do
// CNPJ_ESCRITORIO ter default no código); env var sobrescreve se precisar.
const CAIXA_PADRAO = process.env.XML_INGEST_MAILBOX || 'xml@spassessoriacontabil.com.br';

function getDb() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin.firestore();
}

/** Decodifica o anexo (base64 do Graph) em string XML utf-8. */
export function decodeAnexoXml(contentBytesBase64) {
  return Buffer.from(String(contentBytesBase64 || ''), 'base64').toString('utf-8');
}

/**
 * Id de documento estável a partir do messageId do Graph (que é longo e tem
 * caracteres inválidos pra path do Firestore, incl. '/'). PURO.
 */
export function hashMsgId(messageId) {
  const s = String(messageId || '');
  // djb2 + tamanho: colisão praticamente impossível no volume de uma caixa e
  // não exige dependência de hash.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `m${h.toString(36)}_${s.length}`;
}

/**
 * Roda uma passada de ingestão: lê a caixa, importa os XMLs, marca processadas.
 *
 * @param {object} [p]
 * @param {string} [p.mailbox]      sobrescreve XML_INGEST_MAILBOX
 * @param {number} [p.maxMensagens] teto de mensagens por rodada
 * @param {object} [p.capturadoPor]
 */
export async function ingerirXmlPorEmail({
  mailbox = null, maxMensagens = 25, capturadoPor = null, janelaDias = null,
} = {}) {
  const t0 = Date.now();
  const caixa = mailbox || CAIXA_PADRAO;
  const moverParaId = process.env.XML_INGEST_MOVE_FOLDER_ID || null;
  const dias = Number(janelaDias || process.env.XML_INGEST_JANELA_DIAS || 30);
  const desdeIso = new Date(Date.now() - dias * 86400000).toISOString();

  const r = {
    ok: true, caixa, janelaDias: dias,
    mensagens: 0, anexos: 0,
    jaProcessadas: 0,   // pulos por registro nosso (não por estado de leitura)
    zips: 0, xmlsDeZip: 0,
    importadasSaida: 0, importadasEntrada: 0, atualizadas: 0, duplicadas: 0,
    eventos: 0, semDono: 0, erros: 0,
    detalhePorEmpresa: {},
    anexosNaoXml: [],  // diagnóstico: anexos que não são .xml direto
    errosDetalhe: [],  // diagnóstico: motivo dos erros de importação
    pendencias: [],    // e-mails com anexo mas sem .xml (p/ painel + alerta)
  };

  if (!caixa) {
    return { ok: false, error: 'Caixa não configurada (defina XML_INGEST_MAILBOX ou passe mailbox).' };
  }

  const db = getDb();
  const { porCnpj, porRaiz } = await carregarEmpresas(db);
  r.empresasMonitoradas = porCnpj.size;

  let mensagens;
  try {
    mensagens = await listarEmailsComXml(caixa, { maxMensagens, desdeIso });
  } catch (e) {
    return { ok: false, caixa, error: `Falha lendo a caixa: ${e.message}` };
  }

  // Quais dessas mensagens já processamos ANTES? Leitura em lote (1 getAll).
  // Este é o novo controle de idempotência — no lugar do "e-mail não lido".
  const jaProcessadasSet = new Set();
  if (mensagens.length > 0) {
    try {
      const refs = mensagens.map((m) => db.collection(COL_MSGS).doc(hashMsgId(m.id)));
      const snaps = await db.getAll(...refs);
      snaps.forEach((s) => { if (s.exists && s.data()?.status === 'processada') jaProcessadasSet.add(s.id); });
    } catch (e) {
      console.warn('[xml-email] erro lendo registro de mensagens processadas:', e.message);
    }
  }

  for (const msg of mensagens) {
    const msgKey = hashMsgId(msg.id);
    if (jaProcessadasSet.has(msgKey)) { r.jaProcessadas++; continue; }
    r.mensagens++;
    let algumErroNaMsg = false;

    // ZIP: extrai os .xml de dentro e trata como se fossem anexos soltos.
    const anexosDeZip = [];
    for (const zip of (msg.anexosZip || [])) {
      r.zips++;
      try {
        const buf = Buffer.from(String(zip.contentBytes || ''), 'base64');
        const { xmls, ignorados } = extrairXmlsDoZip(buf);
        for (const x of xmls) {
          anexosDeZip.push({ name: `${zip.name}:${x.nome}`, xmlPronto: x.xml });
        }
        r.xmlsDeZip += xmls.length;
        if (xmls.length === 0) {
          algumErroNaMsg = true; // não marca como processada: dá pra investigar
          if (r.errosDetalhe.length < 20) {
            r.errosDetalhe.push(`${zip.name}: ZIP sem .xml dentro${ignorados.length ? ` (${ignorados.slice(0, 3).join(', ')})` : ''}`);
          }
        }
      } catch (e) {
        r.erros++; algumErroNaMsg = true;
        if (r.errosDetalhe.length < 20) r.errosDetalhe.push(`${zip.name}: ${e.message}`);
      }
    }

    // Diagnóstico: e-mail com anexo mas sem nenhum .xml direto — registra o que
    // veio (PDF, ZIP, e-mail encaminhado=itemAttachment) pra aparecer no painel
    // e virar pendência/alerta (fica não-lido, então continua visível).
    if (msg.anexosXml.length === 0 && anexosDeZip.length === 0 && (msg.anexosInfo || []).length > 0) {
      const anexosStr = msg.anexosInfo.map((a) => `${a.name} [${a.tipo}]`);
      for (const s of anexosStr) {
        if (r.anexosNaoXml.length < 20) r.anexosNaoXml.push(s);
      }
      if (r.pendencias.length < 50) {
        r.pendencias.push({ assunto: msg.subject || '(sem assunto)', from: msg.from || null, anexos: anexosStr });
      }
    }

    for (const anexo of [...msg.anexosXml, ...anexosDeZip]) {
      r.anexos++;
      let xml;
      try {
        // xmlPronto = veio de dentro de um ZIP (já descomprimido).
        xml = anexo.xmlPronto != null ? anexo.xmlPronto : decodeAnexoXml(anexo.contentBytes);
      } catch {
        r.erros++; algumErroNaMsg = true; continue;
      }

      const atrib = atribuirXml(xml, porCnpj, porRaiz);
      if (!atrib) { r.semDono++; continue; }  // nota de terceiro não monitorado

      const bucket = r.detalhePorEmpresa[atrib.emp.cnpj]
        || (r.detalhePorEmpresa[atrib.emp.cnpj] = { empresaId: atrib.emp.empresaId, nome: atrib.emp.nome, saida: 0, entrada: 0, atualizadas: 0, duplicadas: 0 });
      try {
        const imp = await importarXmlSefaz({
          empresaId: atrib.emp.empresaId,
          empresaCnpj: atrib.cnpjNota,
          xml,
          // null explícito: o Firestore rejeita `undefined`. Diferente do autXML,
          // o e-mail não tem nsu/schema da SEFAZ — mas os campos precisam existir.
          schema: null,
          nsu: null,
          capturadoPor,
          origem: 'email',
        });
        if (imp.status === 'ok') {
          if (atrib.tipo === 'saida') { r.importadasSaida++; bucket.saida++; }
          else { r.importadasEntrada++; bucket.entrada++; }
        } else if (imp.status === 'atualizado') {
          r.atualizadas++; bucket.atualizadas++;
        } else if (imp.status === 'duplicado') {
          r.duplicadas++; bucket.duplicadas++;
        } else if (imp.status === 'evento_anexado' || imp.status === 'evento_stub_criado'
          || imp.status === 'duplicado_evento' || imp.status === 'evento_skip_vazio') {
          r.eventos++;
        } else {
          r.erros++; algumErroNaMsg = true;
          if (r.errosDetalhe.length < 20) r.errosDetalhe.push(`${anexo.name}: ${imp.motivo || imp.status || 'erro desconhecido'}`);
        }
      } catch (e) {
        r.erros++; algumErroNaMsg = true;
        if (r.errosDetalhe.length < 20) r.errosDetalhe.push(`${anexo.name}: ${e.message}`);
        console.warn(`[xml-email] import falhou (${anexo.name}): ${e.message}`);
      }
    }

    // Registro NOSSO de processamento (fonte da idempotência) + marcação de
    // lida na caixa (higiene visual pra equipe). E-mail com anexo mas SEM
    // .xml/.zip válido NÃO é registrado — continua aparecendo como pendência
    // no painel e é reavaliado na próxima rodada.
    const teveXml = (msg.anexosXml.length + anexosDeZip.length) > 0;
    if (teveXml && !algumErroNaMsg) {
      try {
        await db.collection(COL_MSGS).doc(msgKey).set({
          messageId: msg.id,
          caixa,
          assunto: (msg.subject || '').slice(0, 300),
          from: msg.from || null,
          pasta: msg.pasta || null,
          recebidoEm: msg.recebidoEm || null,
          anexos: msg.anexosXml.length + anexosDeZip.length,
          status: 'processada',
          processadaEm: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.warn(`[xml-email] falha registrando msg processada ${msg.id}: ${e.message}`);
      }
      try {
        await marcarProcessada(caixa, msg.id, { moverParaId });
      } catch (e) {
        console.warn(`[xml-email] falha marcando processada msg=${msg.id}: ${e.message}`);
      }
    }
  }

  const ranAtMs = Date.now();

  // Mapa "última saída ingerida por empresa" — alimenta a detecção de
  // inatividade (cliente que sempre enviava e parou). Só empresas com saída
  // nesta run entram no merge; as demais mantêm o valor anterior.
  const ultimaSaidaPorEmpresa = {};
  for (const e of Object.values(r.detalhePorEmpresa)) {
    if (e.saida > 0 && e.empresaId) ultimaSaidaPorEmpresa[e.empresaId] = { nome: e.nome, ms: ranAtMs };
  }

  // Persiste um resumo pro painel + o mapa de última saída (merge não clobbera
  // as empresas que não enviaram desta vez).
  try {
    await db.doc(STATE_DOC).set({
      caixa,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      ...(Object.keys(ultimaSaidaPorEmpresa).length ? { ultimaSaidaPorEmpresa } : {}),
      ultimoResumo: {
        mensagens: r.mensagens, anexos: r.anexos,
        jaProcessadas: r.jaProcessadas, janelaDias: r.janelaDias,
        zips: r.zips, xmlsDeZip: r.xmlsDeZip,
        saida: r.importadasSaida, entrada: r.importadasEntrada,
        atualizadas: r.atualizadas, duplicadas: r.duplicadas,
        semDono: r.semDono, erros: r.erros,
        clientesComSaida: Object.values(r.detalhePorEmpresa).filter((e) => e.saida > 0).length,
      },
    }, { merge: true });
  } catch (e) {
    console.warn('[xml-email] erro persistindo estado:', e.message);
  }

  // Histórico da execução (Fase 1: painel de controle / KPIs).
  try {
    await db.collection('cofre_email_runs').add({
      ranAtMs,
      ranAt: admin.firestore.FieldValue.serverTimestamp(),
      mensagens: r.mensagens, anexos: r.anexos,
      jaProcessadas: r.jaProcessadas, janelaDias: r.janelaDias,
      zips: r.zips, xmlsDeZip: r.xmlsDeZip,
      saida: r.importadasSaida, entrada: r.importadasEntrada,
      atualizadas: r.atualizadas, duplicadas: r.duplicadas,
      eventos: r.eventos, semDono: r.semDono, erros: r.erros,
      pendencias: r.pendencias.slice(0, 50),
      errosDetalhe: r.errosDetalhe.slice(0, 20),
      origem: capturadoPor?.email || 'manual',
    });
  } catch (e) {
    console.warn('[xml-email] erro gravando histórico:', e.message);
  }

  r.duracaoMs = Date.now() - t0;
  console.log(`[xml-email-ingest] msgs=${r.mensagens} anexos=${r.anexos} saida=${r.importadasSaida} `
    + `entrada=${r.importadasEntrada} atualizadas=${r.atualizadas} semDono=${r.semDono} erros=${r.erros} ${r.duracaoMs}ms`);
  return r;
}
