// ============================================================================
// sefaz-backend/sync-cte-routes.js  (ESM)
// Endpoint manual pra testar a captura de CT-e antes de entrar no cron
// noturno — mesmo desenho do /sync-one do NF-e (auth por carteira, janela
// operacional pra não-admin), rota PRÓPRIA pra não arriscar o arquivo do
// NF-e (grande, delicado, testado em produção há meses).
//
// Paulo, 18/08 (EDUARDO GUERRA, tomadora de frete, 0 CT-e capturado):
// "como automatizar as CTeS então". Primeiro passo é PROVAR em produção,
// numa empresa real — o cron noturno (todas as empresas, agendado) só entra
// depois que este caminho manual confirmar que o webservice responde.
// ============================================================================

import express from 'express';
import { sincronizarEmpresaCte } from './sync-orchestrator-cte.js';
import { statusJanelaOperacional } from './janela-operacional.js';
import { requireAuth } from './require-admin.js';
import { podeAcessarCnpj } from './carteira-auth.js';

const router = express.Router();

router.post('/sync-cte-one', requireAuth, express.json(), async (req, res) => {
  try {
    const { empresaId, empresaCnpj } = req.body || {};
    if (!empresaId || !empresaCnpj) {
      return res.status(400).json({ error: 'empresaId e empresaCnpj são obrigatórios' });
    }
    const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
    if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });

    if (req.user.role !== 'admin') {
      const janela = statusJanelaOperacional();
      if (!janela.dentro) {
        return res.status(403).json({ error: 'Fora da janela operacional', motivo: janela.motivo, agoraBRT: janela.agoraBRT });
      }
    }

    console.log(`[sync-cte-one] início — empresa=${empresaId} cnpj=${empresaCnpj} user=${req.user.email}`);
    const result = await sincronizarEmpresaCte({
      empresaId, empresaCnpj,
      capturadoPor: { uid: req.user.uid, email: req.user.email, fonte: 'manual-cte' },
    });
    if (!result.ok && result.locked) return res.status(409).json(result);
    if (!result.ok && result.rateLimited) return res.status(429).json(result);
    if (!result.ok) return res.status(500).json(result);
    console.log(`[sync-cte-one] fim — empresa=${empresaId} novos=${result.novosXmls} dup=${result.duplicados} err=${result.erros}`);
    return res.json(result);
  } catch (e) {
    console.error('[POST /sync-cte-one] erro:', e);
    return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
  }
});

export default router;
