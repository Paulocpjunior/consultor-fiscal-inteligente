// ============================================================================
// sefaz-backend/sefaz-sp-nfce-routes.js  (ESM)
//
// Rotas admin da captura de saida de NFC-e via SAE-NFC-e.
//
//   POST /api/admin/sae-nfce/capturar
//   body: { empresaId?|cnpj, dataInicial?, dataFinal?, tpAmb? }
//     Disparo manual da captura server-side (A1 do cofre).
//
//   POST /api/admin/sae-nfce/importar-xmls
//   body: { cnpj, xmls: [string, ...] }
//     Recebe XMLs (nfeProc) capturados FORA do servidor — trilho do Agente A3
//     local, que roda onde o cartao esta inserido, faz o mesmo trajeto SAE e
//     entrega aqui. Passa pelo MESMO xml-importer (dedup por chave, upgrade
//     resumo->completa, direcao=saida quando emit==empresa).
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { capturarNFCeSaida } from './sefaz-sp-nfce-orchestrator.js';
import { importarXmlSefaz } from './xml-importer.js';
import { carregarEmpresas, acharDono } from './xml-empresa-matcher.js';
import { repararDocsSemDono } from './docs-sem-dono.js';
import { direcaoEfetivaDoc } from './xml-metadata-helper.js';

const router = express.Router();

function getDbNfce() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin.firestore();
}

router.post('/capturar', requireAdmin, async (req, res) => {
  const inicio = Date.now();
  try {
    const { empresaId, cnpj, dataInicial, dataFinal, tpAmb } = req.body || {};
    if (!empresaId && !cnpj) {
      return res.status(400).json({ error: 'Informe empresaId ou cnpj do contribuinte.' });
    }
    const r = await capturarNFCeSaida({
      empresaId: empresaId || null,
      cnpj: cnpj || null,
      dataInicial: dataInicial || null,
      dataFinal: dataFinal || null,
      tpAmb: Number(tpAmb) || 1,
      capturadoPor: { uid: req.user?.uid || null, email: req.user?.email || null },
    });
    const status = r.ok ? 200 : (r.error?.includes('nao encontrado') ? 404 : 400);
    return res.status(status).json({ ...r, duracaoMs: Date.now() - inicio });
  } catch (e) {
    console.error('[sae-nfce] erro:', e.message);
    return res.status(500).json({ error: e.message, duracaoMs: Date.now() - inicio });
  }
});

// Limites defensivos do lote (Agente A3 e Importacao em Massa ZIP).
const MAX_XMLS_POR_LOTE = 100;
const MAX_XML_BYTES = 5_000_000; // NF-e mod 55 industrial (centenas de itens) passa de 1 MB

// O XML precisa pertencer a empresa informada: mesma RAIZ de CNPJ (8 digitos)
// no emitente ou no destinatario. Raiz (e nao os 14) para cobrir filiais.
function xmlPertenceAEmpresa(xml, cnpj14) {
  const raiz = cnpj14.slice(0, 8);
  const cnpjs = String(xml).match(/<CNPJ>\s*(\d{14})\s*<\/CNPJ>/gi) || [];
  return cnpjs.some((t) => t.replace(/\D/g, '').startsWith(raiz));
}

/**
 * Lê os documentos das chaves do lote e diz ONDE cada nota está: competência
 * (que vem da EMISSÃO, não do mês da pasta), se ainda é resumo sem valor e se
 * ficou em outra empresa. É o que responde "importei 36 e não acho as notas".
 */
async function conferirDestinoDasChaves(chaves, empresaIdEsperada) {
  const unicas = [...new Set((chaves || []).filter(Boolean))].slice(0, 200);
  if (unicas.length === 0) return null;
  const db = getDbNfce();
  const porCompetencia = {};
  let resumosSemValor = 0;
  let emOutraEmpresa = 0;
  let naoEncontradas = 0;
  try {
    // getAll aceita ate 300 refs por chamada — o lote maximo aqui e 100.
    const refs = unicas.map((c) => db.collection('documentos_fiscais').doc(c));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) { naoEncontradas++; continue; }
      const d = snap.data() || {};
      const comp = d.competencia || 'sem-competencia';
      porCompetencia[comp] = (porCompetencia[comp] || 0) + 1;
      if (d.temItens === false || !d.valorTotal) resumosSemValor++;
      if (empresaIdEsperada && d.empresaId && d.empresaId !== empresaIdEsperada) emOutraEmpresa++;
    }
  } catch (e) {
    console.warn('[sae-nfce] conferencia do lote falhou:', e.message);
    return null;
  }
  return {
    conferidas: unicas.length,
    porCompetencia,
    resumosSemValor,
    emOutraEmpresa,
    naoEncontradas,
  };
}

// O parser JSON global (server.js) ja aceita ate 20mb — um lote de 100 NFC-e
// (~100 KB cada) fica bem abaixo disso.
router.post('/importar-xmls', requireAdmin, async (req, res) => {
  const inicio = Date.now();
  try {
    const { cnpj, xmls } = req.body || {};
    const cnpj14 = String(cnpj || '').replace(/\D/g, '');
    if (cnpj14.length !== 14) return res.status(400).json({ error: 'Informe o cnpj (14 digitos) do contribuinte.' });
    if (!Array.isArray(xmls) || xmls.length === 0) return res.status(400).json({ error: 'Informe xmls: [string, ...].' });
    if (xmls.length > MAX_XMLS_POR_LOTE) {
      return res.status(400).json({ error: `Maximo de ${MAX_XMLS_POR_LOTE} XMLs por lote — divida o envio.` });
    }

    const r = {
      ok: true, cnpj: cnpj14, recebidos: xmls.length,
      importadas: 0, duplicadas: 0, atualizadas: 0, reatribuidas: 0, erros: 0, errosDetalhe: [],
    };
    const capturadoPor = { uid: req.user?.uid || null, email: req.user?.email || 'agente-a3' };

    // Descobre a empresa-cliente dona do CNPJ informado (casa por CNPJ e, se
    // preciso, pela raiz — filial). Sem isto o doc fica sem empresaId e some
    // dos filtros por empresa.
    const chavesDoLote = [];
    let empresaId = null;
    let empresaNome = null;
    try {
      const { porCnpj, porRaiz } = await carregarEmpresas(getDbNfce());
      const dono = acharDono(cnpj14, porCnpj, porRaiz);
      if (dono) { empresaId = dono.emp.empresaId; empresaNome = dono.emp.nome; }
    } catch (e) {
      console.warn('[sae-nfce] falha resolvendo empresa do CNPJ:', e.message);
    }
    if (!empresaId) {
      return res.status(404).json({
        error: `CNPJ ${cnpj14} não está cadastrado como empresa monitorada (nem por CNPJ nem pela raiz). `
          + 'Cadastre a empresa antes de importar — sem isso a nota entra sem dono e não aparece nos filtros.',
        code: 'EMPRESA_NAO_ENCONTRADA',
      });
    }
    r.empresaId = empresaId;
    r.empresaNome = empresaNome;

    for (const xml of xmls) {
      try {
        const texto = String(xml || '');
        if (!texto.includes('<')) { r.erros++; continue; }
        if (Buffer.byteLength(texto, 'utf-8') > MAX_XML_BYTES) {
          r.erros++;
          if (r.errosDetalhe.length < 10) r.errosDetalhe.push('XML acima do limite de tamanho — ignorado');
          continue;
        }
        if (!xmlPertenceAEmpresa(texto, cnpj14)) {
          r.erros++;
          if (r.errosDetalhe.length < 10) r.errosDetalhe.push('XML nao pertence a empresa informada (CNPJ nao aparece como emit/dest) — ignorado');
          continue;
        }
        const imp = await importarXmlSefaz({
          // empresaId RESOLVIDO pelo CNPJ. Ficava null e o documento entrava
          // órfão: a aba XMLs filtra por empresaId, então a nota importada
          // simplesmente NÃO aparecia ao filtrar o cliente (27/07, caso
          // GUARANI: 36 XMLs importados, 2 visíveis).
          empresaId, empresaCnpj: cnpj14, xml: texto,
          schema: null, nsu: null, capturadoPor,
        });
        if (imp.status === 'duplicado') r.duplicadas++;
        else if (imp.status === 'reatribuido') r.reatribuidas++;
        else if (imp.status === 'atualizado') r.atualizadas++;
        else if (imp.status === 'erro') { r.erros++; if (r.errosDetalhe.length < 10) r.errosDetalhe.push(imp.motivo || 'erro'); }
        else r.importadas++;
        if (imp.chave) chavesDoLote.push(imp.chave);
      } catch (e) {
        r.erros++;
        if (r.errosDetalhe.length < 10) r.errosDetalhe.push(String(e.message).slice(0, 200));
      }
    }

    if (r.errosDetalhe.length === 0) delete r.errosDetalhe;
    // CONFERÊNCIA do lote (27/07): "36 duplicadas" não diz NADA sobre onde as
    // notas foram parar — e o operador ia procurá-las na competência do NOME
    // DA PASTA ("entradas 06.2026") quando o app arquiva pela competência da
    // EMISSÃO (dhEmi). Devolvemos o destino real de cada chave do lote.
    r.conferencia = await conferirDestinoDasChaves(chavesDoLote, empresaId);
    return res.json({ ...r, duracaoMs: Date.now() - inicio });
  } catch (e) {
    console.error('[sae-nfce] importar-xmls erro:', e.message);
    return res.status(500).json({ error: e.message, duracaoMs: Date.now() - inicio });
  }
});

/**
 * "Onde está esta nota?" — busca em TODA a base, sem filtro de empresa.
 *
 * É a pergunta que o painel não respondia: a aba XMLs sempre busca DENTRO da
 * empresa filtrada, então nota que caiu no cliente errado (ou sem dono) some
 * da tela e ninguém acha. Aceita a chave de 44 dígitos ou o número da NF.
 */
router.get('/localizar-doc', requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const digitos = q.replace(/\D/g, '');
    if (digitos.length < 3) {
      return res.status(400).json({ ok: false, error: 'Informe a chave (44 dígitos) ou o número da nota.' });
    }
    const db = getDbNfce();
    const achados = [];

    if (digitos.length === 44) {
      const snap = await db.collection('documentos_fiscais').doc(digitos).get();
      if (snap.exists) achados.push({ id: snap.id, ...snap.data() });
    } else {
      // numero e gravado como STRING (nNF do XML); tentamos numero tambem por
      // seguranca em bases antigas.
      for (const valor of [digitos, Number(digitos)]) {
        if (achados.length >= 20) break;
        try {
          const snap = await db.collection('documentos_fiscais').where('numero', '==', valor).limit(20).get();
          snap.forEach((d) => { if (!achados.some((a) => a.id === d.id)) achados.push({ id: d.id, ...d.data() }); });
        } catch { /* tipo incompativel — ignora */ }
      }
    }

    // Nome da empresa dona (o id sozinho nao diz nada pro operador).
    let nomePorId = new Map();
    if (achados.length) {
      try {
        const { porCnpj } = await carregarEmpresas(db);
        for (const emp of porCnpj.values()) nomePorId.set(emp.empresaId, emp.nome);
      } catch { /* segue sem nome */ }
    }

    return res.json({
      ok: true,
      consulta: q,
      total: achados.length,
      docs: achados.slice(0, 20).map((d) => ({
        chave: d.id,
        numero: d.numero ?? null,
        serie: d.serie ?? null,
        dhEmi: d.dhEmi ?? null,
        competencia: d.competencia ?? null,
        empresaId: d.empresaId ?? null,
        empresaNome: d.empresaId ? (nomePorId.get(d.empresaId) || '(empresa não identificada)') : 'SEM DONO',
        empresaCnpj: d.empresaCnpj ?? null,
        cnpjEmit: d.cnpjEmit ?? null,
        cnpjDest: d.cnpjDest ?? null,
        xNomeEmit: d.xNomeEmit ?? null,
        // 🚨 A DIREÇÃO SAI PELA RÉGUA — este é o "onde está a nota?", a tela
        // que o colaborador abre justamente quando o filtro não achou o
        // documento. Devolvendo o campo CRU, a compra de produtor rural
        // (art. 136, gravada como 'saida' até o backfill passar) aparecia
        // aqui como SAÍDA e mandava procurar do lado errado — contradizendo
        // o filtro da própria lista, que desde hoje lê pelo dono.
        direcao: direcaoEfetivaDoc(d) ?? null,
        // E o `tpNF` viaja junto: é ele que sustenta a resposta, e campo fora
        // da resposta some da leitura de quem quiser conferi-la depois.
        tpNF: d.tpNF ?? null,
        valorTotal: d.valorTotal ?? null,
        tipoDoc: d.tipoDoc ?? null,
        temItens: d.temItens ?? null,
        origem: d.origem ?? null,
      })),
    });
  } catch (e) {
    console.error('[localizar-doc] erro:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Notas ÓRFÃS (empresaId nulo) — passado das importações em lote que gravavam
 * sem dono. `aplicar=false` (padrão) só relata; `aplicar=true` devolve a posse.
 * Devolve cursor pra UI repetir até acabar (acervo grande).
 */
router.post('/reparar-sem-dono', requireAdmin, async (req, res) => {
  const inicio = Date.now();
  try {
    const aplicar = req.body?.aplicar === true;
    const maxDocs = Math.min(Math.max(Number(req.body?.maxDocs) || 2000, 100), 5000);
    const cursor = req.body?.cursor || null;
    const db = getDbNfce();
    const { porCnpj, porRaiz } = await carregarEmpresas(db);
    const r = await repararDocsSemDono({
      db, porCnpj, porRaiz, aplicar, maxDocs, cursor,
      FieldValue: admin.firestore.FieldValue,
    });
    console.log(`[reparar-sem-dono] aplicar=${aplicar} analisados=${r.analisados} reparados=${r.reparados} por=${req.user?.email}`);
    return res.json({ ok: true, ...r, duracaoMs: Date.now() - inicio });
  } catch (e) {
    console.error('[reparar-sem-dono] erro:', e.message);
    return res.status(500).json({ ok: false, error: e.message, duracaoMs: Date.now() - inicio });
  }
});

export default router;
