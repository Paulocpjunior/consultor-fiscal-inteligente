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
import { withCronHeartbeat } from './cron-heartbeat.js';

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

// 23/07: rota era SÍNCRONA — o lote de 500 leva 10-20+ min, o Scheduler tem
// deadline de 900s, matava a conexão no meio, RETENTAVA (tentativas fora do
// :15) e o log nunca era gravado. Resultado: 40h de cron "rodando" com o
// backlog de resumos PARADO em ~3.9k. Agora usa o mesmo padrão do sync-cron:
// withCronHeartbeat responde 200 IMEDIATO, roda em background e grava o log
// 'iniciado' → 'sucesso'/'falha' no mesmo doc (morte no meio fica visível).
router.post('/manifest-cron', authCron, async (req, res) => {
  const dryRun = req.body?.dryRun !== false;
  const tipo = req.body?.tipo || 'ciencia';
  const limit = Math.min(parseInt(req.body?.limit || '100'), 500);
  const fonte = req.headers?.['x-cloudscheduler-jobname'] || 'manifesto-ciencia-cron';
  await withCronHeartbeat({ collection: 'manifestacoes_cron_logs', fonte, res }, async () => {
    const inicio = Date.now();
    console.log(`[manifest-cron] iniciando — dryRun=${dryRun}, tipo=${tipo}, limit=${limit}`);
    const r = await manifestarPendentes({
      tipo, limit, dryRun,
      capturadoPor: { uid: 'system', email: 'manifest-cron@spassessoriacontabil' },
    });
    const ms = Date.now() - inicio;
    console.log(`[manifest-cron] fim — ${r.sucessos}/${r.total} sucessos, ${r.falhas} falhas, ${r.puladas656 || 0} puladas656, ${ms}ms`);

    // Agrega os MOTIVOS das falhas (cStat/erro) — sem isto o log dizia só
    // "N falhas" e ninguém sabia se era cert, rejeição SEFAZ ou 656.
    const motivos = new Map();
    for (const d of r.detalhes || []) {
      const ok = ['135', '136'].includes(String(d.cStat));
      if (ok || d.dryRun) continue;
      const chave = d.erro
        ? `ERRO: ${String(d.erro).slice(0, 120)}`
        : `cStat ${d.cStat || '?'}: ${String(d.xMotivo || '').slice(0, 120)}`;
      motivos.set(chave, (motivos.get(chave) || 0) + 1);
    }
    const motivosResumo = [...motivos.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([motivo, quantidade]) => ({ motivo, quantidade }));

    return {
      dryRun, tipo, limit,
      total: r.total, sucessos: r.sucessos, falhas: r.falhas,
      puladas656: r.puladas656 || 0,
      durationMs: ms,
      motivosResumo,
      // detalhes truncados (500 itens estourariam o doc)
      detalhes: (r.detalhes || []).slice(0, 50),
    };
  });
});

export default router;
