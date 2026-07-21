// ============================================================================
// sefaz-backend/manifesto-routes.js  (ESM)
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import {
  manifestarUma, manifestarPendentes, listarElegiveis,
} from './manifesto-orchestrator.js';
import { requireAuth as authUser, requireAdmin } from './require-admin.js';
import { getEmpresaIdsDaCarteira, podeAcessarEmpresaId } from './carteira-auth.js';
import { secretsMatch } from './cron-secret.js';

const CRON_SECRET = process.env.SEFAZ_CRON_SECRET;
const router = Router();

function fa() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin;
}

function authCron(req, res, next) {
  // Aceita os dois headers: x-sefaz-cron-secret (histórico) e x-cron-secret
  // (padrão dos demais crons) — assim o mesmo setup-cloud-schedulers serve.
  const segredo = req.headers['x-sefaz-cron-secret'] || req.headers['x-cron-secret'];
  if (!secretsMatch(segredo, CRON_SECRET)) {
    return res.status(403).json({ erro: 'Cron secret inválido' });
  }
  next();
}

router.get('/manifest-elegiveis', authUser, async (req, res) => {
  try {
    const empresaId = req.query.empresaId || null;
    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin && empresaId) {
      const check = await podeAcessarEmpresaId(req.user, empresaId);
      if (!check.ok) return res.status(check.status).json({ erro: check.error });
    }
    let lista = await listarElegiveis({ empresaId, limit });
    if (!isAdmin && !empresaId) {
      const idsCarteira = await getEmpresaIdsDaCarteira(req.user);
      const setOk = new Set(idsCarteira || []);
      lista = lista.filter(d => setOk.has(d.empresaId));
    }
    res.json({
      total: lista.length,
      itens: lista.map(d => ({
        chave: d.chave,
        empresaId: d.empresaId,
        empresaNome: d.empresaNome,
        empresaCnpj: d.empresaCnpj,
        dhEmi: d.dhEmi,
        valorTotal: d.valorTotal,
        emitente: d.cnpjEmit,
      })),
    });
  } catch (e) {
    console.error('[manifest-elegiveis] erro:', e);
    res.status(500).json({ erro: e.message });
  }
});

router.post('/manifest-one', requireAdmin, async (req, res) => {
  try {
    const { chNFe, cnpjDestinatario, tipo = 'ciencia', xJustificativa, dryRun = false } = req.body || {};
    if (!chNFe || !cnpjDestinatario) {
      return res.status(400).json({ erro: 'chNFe e cnpjDestinatario são obrigatórios' });
    }
    const r = await manifestarUma({
      chNFe, cnpjDestinatario, tipo, xJustificativa, dryRun,
      capturadoPor: req.user,
    });
    res.json(r);
  } catch (e) {
    console.error('[manifest-one] erro:', e);
    res.status(500).json({ erro: e.message });
  }
});

router.post('/manifest-pending', requireAdmin, async (req, res) => {
  try {
    const { empresaId = null, tipo = 'ciencia', limit = 20, dryRun = false } = req.body || {};
    const r = await manifestarPendentes({
      empresaId, tipo, limit, dryRun,
      capturadoPor: req.user,
    });
    res.json(r);
  } catch (e) {
    console.error('[manifest-pending] erro:', e);
    res.status(500).json({ erro: e.message });
  }
});

router.post('/manifest-cron', authCron, async (req, res) => {
  try {
    const dryRun = req.body?.dryRun !== false;
    const tipo = req.body?.tipo || 'ciencia';
    const limit = Math.min(parseInt(req.body?.limit || '100'), 500);
    const inicio = Date.now();
    console.log(`[manifest-cron] iniciando — dryRun=${dryRun}, tipo=${tipo}, limit=${limit}`);
    const r = await manifestarPendentes({
      tipo, limit, dryRun,
      capturadoPor: { uid: 'system', email: 'manifest-cron@spassessoriacontabil' },
    });
    const ms = Date.now() - inicio;
    console.log(`[manifest-cron] fim — ${r.sucessos}/${r.total} sucessos, ${r.falhas} falhas, ${ms}ms`);

    await fa().firestore().collection('manifestacoes_cron_logs').add({
      ...r,
      dryRun, tipo, durationMs: ms,
      iniciadoEm: fa().firestore.FieldValue.serverTimestamp(),
    });

    res.json({ ...r, durationMs: ms });
  } catch (e) {
    console.error('[manifest-cron] erro fatal:', e);
    res.status(500).json({ erro: e.message });
  }
});

export default router;
