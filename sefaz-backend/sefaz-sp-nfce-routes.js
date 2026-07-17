// ============================================================================
// sefaz-backend/sefaz-sp-nfce-routes.js  (ESM)
//
// Rota admin de disparo MANUAL da captura de saida de NFC-e via SAE-NFC-e.
// (Cron/agendamento por empresa vem depois.)
//
//   POST /api/admin/sae-nfce/capturar
//   body: { empresaId?|cnpj, dataInicial?, dataFinal?, tpAmb? }
// ============================================================================

import express from 'express';
import { requireAdmin } from './require-admin.js';
import { capturarNFCeSaida } from './sefaz-sp-nfce-orchestrator.js';

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

export default router;
