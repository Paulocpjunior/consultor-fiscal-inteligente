// ============================================================================
// sefaz-backend/poc-saida-download-routes.js  (ESM) — Fase F0.5
//
// TESTE DECISIVO: baixar UMA NF-e de SAIDA (nota emitida pela propria empresa)
// via consChNFe usando o A1 DA EMPRESA como interessado.
//
// Contexto: o sistema ja tem ~1772 resumos (resNFe) de saida na base, cada um
// com a chave — mas sem o XML completo (valor/data/itens), status "pendente".
// A pergunta que decide o projeto: o consChNFe devolve a nota COMPLETA quando
// a consulta usa o certificado do PROPRIO emitente? Se sim, dispensamos o
// portal SEFAZ-SP e a captura de saida vira so baixar as chaves que ja temos.
//
// SOMENTE LEITURA: consultaNFePorChave e uma consulta (nao grava nada em
// Firestore/Storage). Este endpoint NAO importa/persiste — so relata o que a
// SEFAZ devolveu. Protegido por requireAdmin.
//
//   GET /api/admin/sefaz/poc-saida-completa?chave=<44 digitos>
//
// Deriva emitente e UF da propria chave (mesmo padrao do sync-routes) e carrega
// o A1 da empresa pela raiz do CNPJ emitente (cert-storage).
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { resolverCertEmpresa } from './poc-cert-diagnostico.js';
import { consultaNFePorChave } from './sefaz-client.js';

const router = express.Router();

function getDb() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin.firestore();
}

// Auto-seleciona UMA chave de saida PENDENTE (resumo) para o CNPJ informado.
// ESCOPA por empresa (senao o scan global pega saidas de outras empresas e
// nunca acha a pedida). Com CNPJ de 14 digitos usa where('cnpjEmit') — que ja
// significa "empresa e emitente" = saida, single-field, sem indice composto.
// Com raiz de 8, cai no scan global por direcao='saida' + filtro de base.
async function autoSelecionarSaidaPendente(cnpjRaw) {
  const cnpj = String(cnpjRaw || '').replace(/\D/g, '');
  const base = cnpj.slice(0, 8);
  if (base.length !== 8) return null;

  const db = getDb();
  let docs = [];
  if (cnpj.length === 14) {
    const snap = await db.collection('documentos_fiscais')
      .where('cnpjEmit', '==', cnpj).limit(300).get();
    docs = snap.docs;
  } else {
    const snap = await db.collection('documentos_fiscais')
      .where('direcao', '==', 'saida').limit(400).get();
    docs = snap.docs;
  }

  let fallback = null; // qualquer saida do CNPJ, se nao achar "pendente"
  for (const d of docs) {
    const chave = String(d.id || '').replace(/\D/g, '');
    if (chave.length !== 44) continue;
    if (chave.slice(6, 14) !== base) continue;           // emitente = CNPJ pedido
    const doc = d.data() || {};
    if (doc.direcao && doc.direcao !== 'saida') continue; // ignora entrada
    const pendente = doc.temItens === false || doc.status === 'pendente'
      || /^res(NFe|NFCe)/.test(String(doc.schema || ''));
    if (pendente) return chave;
    if (!fallback) fallback = chave;
  }
  return fallback;
}

const UF_POR_COD = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

// Uma nota COMPLETA (procNFe) tem infNFe + itens (<det>). Resumo (resNFe) nao.
function classificarXml(xml) {
  const s = String(xml || '');
  const temInfNFe = /<infNFe\b/.test(s);
  const temDet = /<det\b/.test(s);
  const ehResumo = /<resNFe\b/.test(s);
  const ehEvento = /<procEventoNFe\b|<infEvento\b/.test(s);
  const ehCompleta = temInfNFe && temDet;
  return { ehCompleta, ehResumo, ehEvento, temInfNFe };
}

router.get('/poc-saida-completa', requireAdmin, async (req, res) => {
  const inicio = Date.now();
  try {
    let chave = String(req.query.chave || '').replace(/\D/g, '');
    const cnpjParam = String(req.query.cnpj || '').replace(/\D/g, '');
    let chaveAutoSelecionada = false;

    // Sem chave mas com CNPJ: auto-seleciona uma saida pendente (1 clique).
    if (chave.length !== 44 && cnpjParam) {
      const auto = await autoSelecionarSaidaPendente(cnpjParam);
      if (!auto) {
        return res.status(404).json({
          error: 'Nenhuma saida pendente encontrada para auto-selecionar.',
          dica: 'Cole uma chave manualmente (aba XMLs NFe, saida, status Pendente).',
          cnpj: cnpjParam,
        });
      }
      chave = auto;
      chaveAutoSelecionada = true;
    }

    if (chave.length !== 44) {
      return res.status(400).json({ error: `Chave invalida: esperado 44 digitos, recebido ${chave.length}. Informe chave= ou cnpj= para auto-selecionar.` });
    }
    const cnpjEmitente = chave.slice(6, 20);
    const ufCod = chave.slice(0, 2);
    const ufSigla = UF_POR_COD[ufCod] || 'SP';

    // A1 da PROPRIA empresa emitente (nao o do escritorio). Resolvedor com
    // diagnostico: aceita a raiz do CNPJ e explica o motivo se nao achar.
    const rCert = await resolverCertEmpresa(cnpjEmitente);
    if (!rCert.ok || !rCert.cert?.pfxBuffer) {
      return res.status(404).json({
        error: 'Certificado A1 da empresa emitente nao encontrado no cofre.',
        dica: 'Cadastre o A1 (tipo A1, valido) da empresa (raiz do CNPJ emitente) em Certificados.',
        cnpjEmitente,
        diagnostico: rCert.ok ? null : rCert,
      });
    }
    const cert = rCert.cert;

    let resp;
    try {
      resp = await consultaNFePorChave({ chave, cnpjInteressado: cnpjEmitente, uf: ufSigla, certOverride: cert });
    } catch (e) {
      return res.status(502).json({ error: `Falha na consulta SEFAZ: ${e.message}`, cnpjEmitente, uf: ufSigla });
    }

    const xmls = (resp.xmls || []).map(x => {
      const cls = classificarXml(x.xml);
      return {
        schema: x.schema || null,
        nsu: x.nsu || null,
        tamanho: x.xml?.length || 0,
        ...cls,
        // Snippet do cabecalho — sem despejar a nota inteira.
        snippet: x.xml ? String(x.xml).replace(/\s+/g, ' ').slice(0, 400) : null,
      };
    });
    const temCompleta = xmls.some(x => x.ehCompleta);

    let veredito;
    if (resp.rateLimited || resp.cStat === '656') veredito = 'rate_limited_656';
    else if (temCompleta) veredito = 'completa_disponivel';
    else if (resp.cStat === '137') veredito = 'nada_encontrado_137';
    else if (xmls.some(x => x.ehResumo)) veredito = 'so_resumo';
    else veredito = 'inconclusivo';

    return res.json({
      ok: true,
      fase: 'F0.5-teste-consChNFe',
      geradoEm: new Date().toISOString(),
      duracaoMs: Date.now() - inicio,
      chave,
      chaveAutoSelecionada,
      cnpjEmitente,
      uf: ufSigla,
      certFonte: { empresaId: cert.empresaIdFonte || cert.empresaId || null, cnpj: cert.cnpjFonte || cert.cnpj || null },
      cStat: resp.cStat,
      xMotivo: resp.xMotivo,
      totalXmls: xmls.length,
      temCompleta,
      veredito,
      xmls,
      // Guia de leitura pra decisao:
      interpretacao:
        veredito === 'completa_disponivel'
          ? 'consChNFe com o A1 da empresa DEVOLVEU a nota completa — dispensa o portal SP; F1 vira batch sobre as chaves existentes.'
          : veredito === 'nada_encontrado_137'
            ? 'SEFAZ nao localizou a nota pra este interessado (137) — emitente nao consegue puxar a propria saida via DFe; portal SP continua necessario.'
            : veredito === 'so_resumo'
              ? 'Voltou so o resumo (sem itens/valor) — a nota completa nao foi liberada por este canal.'
              : veredito === 'rate_limited_656'
                ? 'SEFAZ limitou a consulta (656) — tentar de novo mais tarde; nao conclui nada ainda.'
                : 'Resposta inconclusiva — ver cStat/xMotivo e os xmls retornados.',
    });
  } catch (e) {
    console.error('[poc-saida-completa] erro:', e.message);
    return res.status(500).json({ error: e.message, duracaoMs: Date.now() - inicio });
  }
});

export default router;
