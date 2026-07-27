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

// Extensões de anexo que interessam. ZIP entra desde 27/07 (emissor que manda
// os XMLs do dia zipados era ignorado em silêncio) — extraído no ingestor.
const EXT_XML = /\.xml$/i;
const EXT_ZIP = /\.zip$/i;

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
 * Pastas a varrer: Caixa de Entrada + subpastas dela + Lixo Eletrônico.
 * Regra do Outlook que move XML pra subpasta, ou spam que engoliu o e-mail do
 * cliente, deixavam a nota invisível pro cofre (27/07).
 */
async function listarPastasParaVarrer(box, token) {
  const pastas = [{ id: 'inbox', nome: 'Caixa de Entrada' }];
  try {
    const filhas = await graphGet(`/users/${box}/mailFolders/inbox/childFolders?$select=id,displayName&$top=20`, token);
    for (const f of filhas.value || []) pastas.push({ id: f.id, nome: f.displayName });
  } catch (e) {
    console.warn('[graph-mail] childFolders indisponivel:', e.message);
  }
  pastas.push({ id: 'junkemail', nome: 'Lixo Eletrônico' });
  return pastas;
}

/**
 * Lista mensagens COM ANEXO recebidas desde `desdeIso`, em todas as pastas
 * relevantes, trazendo os anexos de arquivo (.xml e .zip) com o conteúdo.
 *
 * MUDANÇA CRÍTICA (27/07): NÃO filtra mais por `isRead eq false`. A caixa é
 * compartilhada — bastava alguém da equipe abrir o e-mail no Outlook (ou o
 * painel de leitura marcar como lido ao passar) pra a nota sumir do radar do
 * cofre PARA SEMPRE. Agora a janela é por DATA e o controle de "já processei"
 * é do ingestor (registro por messageId no Firestore), não do estado de
 * leitura da caixa.
 *
 * @param {string} mailbox  UPN/e-mail da caixa (ex.: xml@spassessoriacontabil.com.br)
 * @param {object} [opts]
 * @param {number} [opts.maxMensagens=25]  teto por rodada
 * @param {string} [opts.desdeIso]         ISO da janela (default: 30 dias atrás)
 * @returns {Promise<Array<{id, subject, from, recebidoEm, pasta, anexosXml, anexosZip, anexosInfo}>>}
 */
export async function listarEmailsComXml(mailbox, { maxMensagens = 25, desdeIso = null } = {}) {
  const token = await getGraphToken();
  const box = encodeURIComponent(mailbox);
  const top = Math.min(Math.max(Number(maxMensagens) || 25, 1), 100);
  const desde = desdeIso || new Date(Date.now() - 30 * 86400000).toISOString();

  // Filtrar e ordenar pelo MESMO campo (receivedDateTime) é aceito pelo Graph
  // (o InefficientFilter acontecia ao combinar isRead/hasAttachments com
  // orderby de outro campo). hasAttachments vem no $select pra pular cedo.
  const filtro = `$filter=receivedDateTime ge ${desde}`;
  // `body` vem junto: cliente que manda LINK em vez de anexo (ISS.NET-DF, ERP
  // com pacote mensal) só é capturável se lermos o corpo pra achar a URL.
  const campos = '$select=id,subject,from,receivedDateTime,hasAttachments,isRead,body';
  const ordem = '$orderby=receivedDateTime desc';

  const pastas = await listarPastasParaVarrer(box, token);
  const mensagens = [];
  for (const pasta of pastas) {
    if (mensagens.length >= top) break;
    try {
      const lista = await graphGet(
        `/users/${box}/mailFolders/${pasta.id}/messages?${filtro}&${campos}&${ordem}&$top=${top}`,
        token,
      );
      for (const m of lista.value || []) mensagens.push({ ...m, _pasta: pasta.nome });
    } catch (e) {
      console.warn(`[graph-mail] pasta ${pasta.nome} indisponivel: ${e.message}`);
    }
  }

  const out = [];
  for (const msg of mensagens) {
    // ATENÇÃO: mensagem SEM anexo NÃO é mais descartada — o XML pode vir por
    // LINK no corpo (ISS.NET-DF manda o .aspx de download; ERP manda pacote
    // mensal que expira em 7 dias). O ingestor decide o que fazer com os links.
    let anexos = [];
    let erroAnexos = null;
    if (msg.hasAttachments) {
      // Puxa os anexos da mensagem. SEM $select: `@odata.type` não é uma
      // propriedade selecionável (o Graph rejeita `$select=...,@odata.type`), e
      // sem ele não dá pra distinguir fileAttachment. A lista já traz contentBytes
      // dos fileAttachment por padrão.
      try {
        const at = await graphGet(`/users/${box}/messages/${msg.id}/attachments`, token);
        anexos = at.value || [];
      } catch (e) {
        erroAnexos = e.message;
        console.warn(`[graph-mail] falha lendo anexos msg=${msg.id}: ${e.message}`);
      }
    }
    const arquivos = anexos.filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment' && a.contentBytes);
    const anexosXml = arquivos
      .filter((a) => EXT_XML.test(a.name || ''))
      .map((a) => ({ name: a.name, contentBytes: a.contentBytes }));
    // ZIP com os XMLs do dia — o ingestor extrai e importa cada um.
    const anexosZip = arquivos
      .filter((a) => EXT_ZIP.test(a.name || ''))
      .map((a) => ({ name: a.name, contentBytes: a.contentBytes }));

    // Diagnóstico: o que veio no e-mail que NÃO virou XML importável — pra
    // enxergar PDF/ZIP/e-mail-encaminhado (itemAttachment) em vez de adivinhar.
    const anexosInfo = anexos.map((a) => ({
      name: a.name || '(sem nome)',
      tipo: String(a['@odata.type'] || '').replace('#microsoft.graph.', '') || '?',
    }));
    // Se a leitura dos anexos falhou, não engole: expõe pro painel.
    if (erroAnexos) anexosInfo.push({ name: `ERRO lendo anexos: ${erroAnexos}`, tipo: 'erro' });

    const corpo = msg.body?.content || '';
    // Sem anexo E sem corpo: nada a fazer (evita ruído no painel).
    if (anexosXml.length === 0 && anexosZip.length === 0 && anexosInfo.length === 0 && !corpo) continue;

    out.push({
      id: msg.id,
      subject: msg.subject || '',
      from: msg.from?.emailAddress?.address || null,
      recebidoEm: msg.receivedDateTime || null,
      pasta: msg._pasta || null,
      jaLida: msg.isRead === true,
      anexosXml,
      anexosZip,
      anexosInfo,
      corpo,
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
