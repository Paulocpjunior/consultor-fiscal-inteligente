// ============================================================================
// sefaz-backend/graph-mail-reader.js  (ESM)
// ----------------------------------------------------------------------------
// Leitura de uma caixa de e-mail do Microsoft 365 via Graph (app-only) para a
// INGESTÃO DE XML por e-mail — o "cofre" do CFI. Substitui o cofre da SIEG
// (spassessoriacontabil@cofresieg.com.br): os emissores dos clientes mandam os
// XMLs emitidos pra uma caixa nossa e o CFI lê os anexos e importa.
//
// Requer a permissão de aplicativo **Mail.ReadWrite** no app Graph que o
// escritório já usa pra enviar e-mail (mesmo GRAPH_CLIENT_ID/TENANT/SECRET).
// ReadWrite é necessário pra marcar como lida / mover a mensagem processada.
//
// SÓ LEITURA de anexos + marcação de processado — nunca apaga, nunca responde.
// ============================================================================

import { getGraphToken } from './graph-provider.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Extensões de anexo que interessam (XML de DFe; .gz descomprime via zlib no
// ingestor). .zip NÃO é tratado aqui — vai pela Importação por ZIP da tela.
const EXT_XML = /\.xml$/i;

async function graphGet(path, token) {
  const resp = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Graph GET ${path} → ${resp.status}: ${txt.slice(0, 300)}`);
  }
  return resp.json();
}

/**
 * Lista mensagens NÃO LIDAS da caixa que tenham anexo, trazendo os anexos de
 * arquivo (fileAttachment) já com o conteúdo (contentBytes base64).
 *
 * @param {string} mailbox  UPN/e-mail da caixa (ex.: xml@spassessoriacontabil.com.br)
 * @param {object} [opts]
 * @param {number} [opts.maxMensagens=25]  teto por rodada (paginação simples)
 * @returns {Promise<Array<{id, subject, from, recebidoEm, anexosXml: Array<{name, contentBytes}>}>>}
 */
export async function listarEmailsComXml(mailbox, { maxMensagens = 25 } = {}) {
  const token = await getGraphToken();
  const box = encodeURIComponent(mailbox);
  const top = Math.min(Math.max(Number(maxMensagens) || 25, 1), 100);

  // Graph rejeita ($filter em isRead+hasAttachments) COMBINADO com $orderby
  // (erro InefficientFilter). Então filtramos só por isRead (filtro simples,
  // sem orderby) e checamos hasAttachments no código. `hasAttachments` vem no
  // $select pra pular cedo as mensagens sem anexo.
  const filtro = '$filter=isRead eq false';
  const campos = '$select=id,subject,from,receivedDateTime,hasAttachments';
  const lista = await graphGet(
    `/users/${box}/mailFolders/inbox/messages?${filtro}&${campos}&$top=${top}`,
    token,
  );

  const out = [];
  for (const msg of lista.value || []) {
    if (!msg.hasAttachments) continue;
    // Puxa os anexos da mensagem. SEM $select: `@odata.type` não é uma
    // propriedade selecionável (o Graph rejeita `$select=...,@odata.type`), e
    // sem ele não dá pra distinguir fileAttachment. A lista já traz contentBytes
    // dos fileAttachment por padrão.
    let anexos = [];
    let erroAnexos = null;
    try {
      const at = await graphGet(`/users/${box}/messages/${msg.id}/attachments`, token);
      anexos = at.value || [];
    } catch (e) {
      erroAnexos = e.message;
      console.warn(`[graph-mail] falha lendo anexos msg=${msg.id}: ${e.message}`);
    }
    const anexosXml = anexos
      .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment')
      .filter((a) => EXT_XML.test(a.name || '') && a.contentBytes)
      .map((a) => ({ name: a.name, contentBytes: a.contentBytes }));

    // Diagnóstico: o que veio no e-mail que NÃO virou XML importável — pra
    // enxergar PDF/ZIP/e-mail-encaminhado (itemAttachment) em vez de adivinhar.
    const anexosInfo = anexos.map((a) => ({
      name: a.name || '(sem nome)',
      tipo: String(a['@odata.type'] || '').replace('#microsoft.graph.', '') || '?',
    }));
    // Se a leitura dos anexos falhou, não engole: expõe pro painel.
    if (erroAnexos) anexosInfo.push({ name: `ERRO lendo anexos: ${erroAnexos}`, tipo: 'erro' });

    out.push({
      id: msg.id,
      subject: msg.subject || '',
      from: msg.from?.emailAddress?.address || null,
      recebidoEm: msg.receivedDateTime || null,
      anexosXml,
      anexosInfo,
    });
  }
  return out;
}

/**
 * Marca a mensagem como LIDA (pra não reprocessar) e, se `moverParaId` for
 * dado, move-a para essa pasta (ex.: "Processados"). Idempotente o suficiente:
 * se falhar o move, ao menos a marcação de lida evita reprocesso.
 */
export async function marcarProcessada(mailbox, messageId, { moverParaId = null } = {}) {
  const token = await getGraphToken();
  const box = encodeURIComponent(mailbox);

  // isRead = true
  const patch = await fetch(`${GRAPH}/users/${box}/messages/${messageId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ isRead: true }),
  });
  if (!patch.ok) {
    const txt = await patch.text();
    throw new Error(`Graph PATCH isRead → ${patch.status}: ${txt.slice(0, 200)}`);
  }

  if (moverParaId) {
    const mv = await fetch(`${GRAPH}/users/${box}/messages/${messageId}/move`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationId: moverParaId }),
    });
    if (!mv.ok) {
      const txt = await mv.text();
      console.warn(`[graph-mail] move msg=${messageId} → ${mv.status}: ${txt.slice(0, 200)}`);
    }
  }
}
