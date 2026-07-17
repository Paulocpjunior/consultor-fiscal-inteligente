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
import { requireAdmin } from './require-admin.js';
import { capturarNFCeSaida } from './sefaz-sp-nfce-orchestrator.js';
import { importarXmlSefaz } from './xml-importer.js';

const router = express.Router();

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

// Limites defensivos do lote vindo do Agente A3 local.
const MAX_XMLS_POR_LOTE = 100;
const MAX_XML_BYTES = 800_000; // nfeProc de NFC-e tipicamente < 100 KB

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

    const r = { ok: true, cnpj: cnpj14, recebidos: xmls.length, importadas: 0, duplicadas: 0, atualizadas: 0, erros: 0, errosDetalhe: [] };
    const capturadoPor = { uid: req.user?.uid || null, email: req.user?.email || 'agente-a3' };

    for (const xml of xmls) {
      try {
        const texto = String(xml || '');
        if (!texto.includes('<')) { r.erros++; continue; }
        if (Buffer.byteLength(texto, 'utf-8') > MAX_XML_BYTES) {
          r.erros++;
          if (r.errosDetalhe.length < 10) r.errosDetalhe.push('XML acima do limite de tamanho — ignorado');
          continue;
        }
        const imp = await importarXmlSefaz({
          empresaId: null, empresaCnpj: cnpj14, xml: texto,
          schema: null, nsu: null, capturadoPor,
        });
        if (imp.status === 'duplicado') r.duplicadas++;
        else if (imp.status === 'atualizado') r.atualizadas++;
        else if (imp.status === 'erro') { r.erros++; if (r.errosDetalhe.length < 10) r.errosDetalhe.push(imp.motivo || 'erro'); }
        else r.importadas++;
      } catch (e) {
        r.erros++;
        if (r.errosDetalhe.length < 10) r.errosDetalhe.push(String(e.message).slice(0, 200));
      }
    }

    if (r.errosDetalhe.length === 0) delete r.errosDetalhe;
    return res.json({ ...r, duracaoMs: Date.now() - inicio });
  } catch (e) {
    console.error('[sae-nfce] importar-xmls erro:', e.message);
    return res.status(500).json({ error: e.message, duracaoMs: Date.now() - inicio });
  }
});

export default router;
