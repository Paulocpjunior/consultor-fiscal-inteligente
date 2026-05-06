// ============================================================================
// sefaz-backend/sync-routes.js  (ESM)
// Endpoints: /sync-one, /sync-cron, /state/:cnpj, /window
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { sincronizarEmpresa } from './sync-orchestrator.js';
import { statusJanelaOperacional } from './janela-operacional.js';

const router = express.Router();

function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'Token ausente' });
    const decoded = await fa().auth().verifyIdToken(m[1]);
    const uid = decoded.uid;
    const userDoc = await fa().firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) return res.status(403).json({ error: 'Usuário não encontrado' });
    req.user = {
      uid,
      email: decoded.email || userDoc.data().email,
      role: userDoc.data().role || 'colaborador',
    };
    next();
  } catch (e) {
    console.error('[requireAuth] erro:', e.message);
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

async function requireCronAuth(req, res, next) {
  const cronSecret = req.headers['x-sefaz-cron-secret'];
  const expectedSecret = process.env.SEFAZ_CRON_SECRET;
  if (expectedSecret && cronSecret === expectedSecret) {
    req.cron = { source: 'secret' };
    return next();
  }
  const authHeader = req.headers.authorization || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (m) {
    req.cron = { source: 'oidc', token: m[1].slice(0, 20) + '...' };
    return next();
  }
  return res.status(401).json({ error: 'Cron não autorizado' });
}

router.post('/sync-one', requireAuth, express.json(), async (req, res) => {
  try {
    const { empresaId, empresaCnpj } = req.body || {};
    if (!empresaId || !empresaCnpj) {
      return res.status(400).json({ error: 'empresaId e empresaCnpj são obrigatórios' });
    }
    const janela = statusJanelaOperacional();
    if (!janela.dentro) {
      return res.status(403).json({
        error: 'Fora da janela operacional',
        motivo: janela.motivo,
        agoraBRT: janela.agoraBRT,
      });
    }
    console.log(`[sync-one] início — empresa=${empresaId} cnpj=${empresaCnpj} user=${req.user.email}`);
    const result = await sincronizarEmpresa({
      empresaId, empresaCnpj,
      capturadoPor: { uid: req.user.uid, email: req.user.email, fonte: 'manual' },
    });
    if (!result.ok && result.locked) return res.status(409).json(result);
    if (!result.ok && result.rateLimited) return res.status(429).json(result);
    if (!result.ok) return res.status(500).json(result);
    console.log(`[sync-one] fim — empresa=${empresaId} novos=${result.novosXmls} dup=${result.duplicados} err=${result.erros}`);
    return res.json(result);
  } catch (e) {
    console.error('[POST /sync-one] erro:', e);
    return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
  }
});

router.post('/sync-cron', requireCronAuth, async (req, res) => {
  res.json({ ok: true, motivo: 'Cron iniciado em background', startedAt: new Date().toISOString() });

  setImmediate(async () => {
    const inicio = Date.now();
    console.log('[sync-cron] início — fonte:', req.cron?.source);
    try {
      const empresas = await listarEmpresasParaCron();
      console.log(`[sync-cron] ${empresas.length} empresas elegíveis`);
      let sucessos = 0;
      let falhas = 0;
      let totalNovos = 0;
      for (const emp of empresas) {
        try {
          const result = await sincronizarEmpresa({
            empresaId: emp.id,
            empresaCnpj: emp.cnpj,
            capturadoPor: { uid: 'cron-system', email: 'cron@spassessoriacontabil', fonte: 'cron' },
          });
          if (result.ok) { sucessos++; totalNovos += (result.novosXmls || 0); }
          else { falhas++; console.warn(`[sync-cron] falha em ${emp.cnpj}: ${result.motivo}`); }
        } catch (e) {
          falhas++;
          console.error(`[sync-cron] exceção em ${emp.cnpj}:`, e.message);
        }
      }
      const duracaoMs = Date.now() - inicio;
      await fa().firestore().collection('sefaz_cron_logs').add({
        executadoEm: fa().firestore.FieldValue.serverTimestamp(),
        totalEmpresas: empresas.length,
        sucessos, falhas, totalNovosXmls: totalNovos, duracaoMs,
        fonte: req.cron?.source,
      });
      console.log(`[sync-cron] fim — ${sucessos}/${empresas.length} sucessos, ${totalNovos} novos, ${duracaoMs}ms`);
    } catch (e) {
      console.error('[sync-cron] erro fatal:', e);
      try {
        await fa().firestore().collection('sefaz_cron_logs').add({
          executadoEm: fa().firestore.FieldValue.serverTimestamp(),
          erro: e.message, fonte: req.cron?.source,
        });
      } catch (_) {}
    }
  });
});

async function listarEmpresasParaCron() {
  const db = fa().firestore();
  const limite = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const empresas = [];
  const colNames = [
    process.env.SIMPLES_COLLECTION || 'simples_nacional',
    process.env.LUCRO_COLLECTION || 'lucro_presumido_real',
    process.env.LUCRO_COLLECTION_ALT || 'lucro_empresas',
  ];
  for (const colName of colNames) {
    try {
      const snap = await db.collection(colName).where('capturarSefaz', '==', true).get();
      snap.forEach(doc => {
        const d = doc.data();
        const cnpj = (d.cnpj || '').replace(/\D/g, '');
        if (cnpj.length !== 14) return;
        if (d.ultimoAcessoXml) {
          const ult = d.ultimoAcessoXml.toMillis ? d.ultimoAcessoXml.toMillis() : new Date(d.ultimoAcessoXml).getTime();
          if (ult < limite.getTime()) return;
        }
        empresas.push({ id: doc.id, cnpj, nome: d.nome || d.razaoSocial || '', fonte: colName });
      });
    } catch (e) {
      console.warn(`[sync-cron] collection ${colName} indisponível:`, e.message);
    }
  }
  const map = new Map();
  empresas.forEach(e => { if (!map.has(e.cnpj)) map.set(e.cnpj, e); });
  return Array.from(map.values());
}

router.get('/state/:cnpj', requireAuth, async (req, res) => {
  try {
    const cnpj = String(req.params.cnpj).replace(/\D/g, '');
    if (cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });
    const stateRef = fa().firestore().collection('sefaz_state').doc(cnpj);
    const lockRef = fa().firestore().collection('sefaz_locks').doc(cnpj);
    const [stateSnap, lockSnap] = await Promise.all([stateRef.get(), lockRef.get()]);
    const state = stateSnap.exists ? stateSnap.data() : null;
    const lock = lockSnap.exists ? lockSnap.data() : null;
    const now = Date.now();
    const lockAtivo = lock?.expiresAt && (lock.expiresAt.toMillis ? lock.expiresAt.toMillis() : lock.expiresAt) > now;
    return res.json({ cnpj, state, lock: lock ? { ...lock, ativo: lockAtivo } : null });
  } catch (e) {
    console.error('[GET /state] erro:', e);
    return res.status(500).json({ error: e.message });
  }
});

router.get('/window', requireAuth, (req, res) => {
  return res.json(statusJanelaOperacional());
});

export default router;
