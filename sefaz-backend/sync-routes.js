// ============================================================================
// sefaz-backend/sync-routes.js  (ESM)
// Endpoints: /sync-one, /sync-cron, /state/:cnpj, /window
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { sincronizarEmpresa } from './sync-orchestrator.js';
import { statusJanelaOperacional } from './janela-operacional.js';
import { requireAuth } from './require-admin.js';

const router = express.Router();

function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

function requireCronAuth(req, res, next) {
    const secret = process.env.SEFAZ_CRON_SECRET;
    if (!secret) {
        console.error('[requireCronAuth] SEFAZ_CRON_SECRET not configured');
        return res.status(500).json({ error: 'Cron secret not configured' });
    }
    const headerSecret = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'];
    if (headerSecret === secret) {
        return next();
    }
    return res.status(403).json({ error: 'Cron auth failed' });
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

// ============================================================================
// /sync-targeted — disparo cirurgico pra lista especifica de CNPJs
// Ordena ASC por NSU pendente, sleep 90s entre empresas, para em cStat=656.
// Responde sincrono (cliente espera).
// ============================================================================
router.post('/sync-targeted', requireCronAuth, express.json(), async (req, res) => {
  const cnpjs = (req.body?.cnpjs || []).map(c => String(c).replace(/\D/g, ''));
  if (!cnpjs.length) return res.status(400).json({ error: 'cnpjs array vazio' });

  const SLEEP_MS = parseInt(req.body?.sleepMs || '90000', 10);
  const PARAR_EM_656 = req.body?.pararEm656 !== false; // default true

  console.log(`[sync-targeted] init — ${cnpjs.length} cnpjs, sleep=${SLEEP_MS}ms, pararEm656=${PARAR_EM_656}`);

  // Resolve empresaId pra cada cnpj
  const db = fa().firestore();
  const alvos = [];
  for (const cnpj of cnpjs) {
    let found = null;
    for (const col of ['simples_empresas', 'lucro_empresas']) {
      const snap = await db.collection(col)
        .where('cnpj', '==', cnpj).limit(1).get();
      if (!snap.empty) {
        const d = snap.docs[0];
        found = { id: d.id, cnpj, nome: d.data().nome || d.data().razaoSocial || '', fonte: col };
        break;
      }
    }
    if (found) alvos.push(found);
    else console.warn(`[sync-targeted] CNPJ ${cnpj} nao encontrado em simples/lucro_empresas`);
  }

  console.log(`[sync-targeted] ${alvos.length}/${cnpjs.length} CNPJs resolvidos`);

  const resultados = [];
  let totalNovos = 0;
  let parouEm656 = false;
  let idx = 0;

  for (const emp of alvos) {
    idx++;
    console.log(`[sync-targeted] (${idx}/${alvos.length}) ${emp.cnpj} ${emp.nome}`);
    try {
      const r = await sincronizarEmpresa({
        empresaId: emp.id, empresaCnpj: emp.cnpj,
        capturadoPor: { uid: 'sync-targeted', email: 'cron@spassessoriacontabil', fonte: 'manual' },
      });
      resultados.push({ cnpj: emp.cnpj, nome: emp.nome, ...r });
      if (r.ok) {
        totalNovos += (r.novosXmls || 0);
        console.log(`[sync-targeted]   OK novos=${r.novosXmls} dup=${r.duplicados} err=${r.erros}`);
      } else {
        console.warn(`[sync-targeted]   FALHA: ${r.motivo}`);
        if (PARAR_EM_656 && /656|Consumo Indevido/i.test(r.motivo || '')) {
          console.warn('[sync-targeted] ABORT — cStat=656 detectado, parando');
          parouEm656 = true;
          break;
        }
      }
    } catch (e) {
      console.error(`[sync-targeted]   EXCECAO: ${e.message}`);
      resultados.push({ cnpj: emp.cnpj, nome: emp.nome, ok: false, motivo: e.message });
    }

    if (idx < alvos.length && !parouEm656) {
      console.log(`[sync-targeted]   sleep ${SLEEP_MS}ms...`);
      await new Promise(r => setTimeout(r, SLEEP_MS));
    }
  }

  return res.json({
    ok: !parouEm656,
    parouEm656,
    processadas: resultados.length,
    totalSolicitadas: alvos.length,
    totalNovosXmls: totalNovos,
    resultados,
  });
});

async function listarEmpresasParaCron() {
  const db = fa().firestore();
  const limite = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const empresas = [];
  // Collections REAIS:
  //   simples_empresas (services/simplesNacionalService.ts)
  //   lucro_empresas   (services/lucroPresumidoService.ts)
  const colNames = [
    process.env.SIMPLES_COLLECTION || 'simples_empresas',
    process.env.LUCRO_COLLECTION || 'lucro_empresas',
  ];
  for (const colName of colNames) {
    try {
      // Default = ATIVO. Não filtramos por capturarSefaz no Firestore para incluir
      // docs antigos que não têm o campo (interpretado como ativo).
      const snap = await db.collection(colName).get();
      snap.forEach(doc => {
        const d = doc.data();
        if (d.capturarSefaz === false) return; // só pula se admin desativou explicitamente
        const cnpj = (d.cnpj || '').replace(/\D/g, '');
        if (cnpj.length !== 14) return;
        if (d.ultimoAcessoXml) {
          const ult = d.ultimoAcessoXml.toMillis ? d.ultimoAcessoXml.toMillis() : new Date(d.ultimoAcessoXml).getTime();
          if (ult < limite.getTime()) return;
        }
        empresas.push({ id: doc.id, cnpj, nome: d.nome || d.razaoSocial || '', fonte: colName });
      });
      console.log(`[sync-cron] collection ${colName}: ${snap.size} docs`);
    } catch (e) {
      console.warn(`[sync-cron] collection ${colName} indisponível:`, e.message);
    }
  }
  const map = new Map();
  empresas.forEach(e => { if (!map.has(e.cnpj)) map.set(e.cnpj, e); });
  // Filtra empresas com tipoCert='A3' — elas só são capturadas pelo agente local cfi-a3
  try {
    const a3Snap = await db.collection('empresas_certificados').where('tipoCert', '==', 'A3').get();
    const a3Ids = new Set(a3Snap.docs.map(d => d.id));
    if (a3Ids.size > 0) {
      console.log(`[sync-cron] pulando ${a3Ids.size} empresa(s) tipoCert=A3 (capturadas pelo agente local)`);
    }
    const filtradas = Array.from(map.values()).filter(e => !a3Ids.has(e.id));
    return filtradas;
  } catch (e) {
    console.warn('[sync-cron] erro filtrando A3:', e.message);
    return Array.from(map.values());
  }
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

// GET /cron-status — retorna o último log do cron SEFAZ (legacy, usado pelo banner antigo).
router.get('/cron-status', requireAuth, async (req, res) => {
  try {
    const db = fa().firestore();
    const snap = await db.collection('sefaz_cron_logs')
      .orderBy('executadoEm', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return res.json({ hasRun: false });
    const data = snap.docs[0].data();
    return res.json({ hasRun: true, ...data });
  } catch (e) {
    console.error('[GET /cron-status] erro:', e);
    return res.status(500).json({ error: e.message });
  }
});


// ── POST /sync-cron-now ──────────────────────────────────────────────────
// Dispara o cron de NFe sob demanda. Auth = Bearer admin (não precisa
// do x-cron-secret porque é interno). Reusa o mesmo orquestrador do cron.
router.post('/sync-cron-now', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores' });
    }
    res.json({ ok: true, motivo: 'Cron iniciado em background' });
    setImmediate(async () => {
      const inicio = Date.now();
      console.log('[sync-cron-now] início — admin:', req.user.email);
      let sucessos = 0, falhas = 0, totalNovos = 0, total = 0;
      try {
        const empresas = await listarEmpresasParaCron();
        total = empresas.length;
        for (const emp of empresas) {
          try {
            const result = await sincronizarEmpresa({
              empresaId: emp.id, empresaCnpj: emp.cnpj,
              capturadoPor: { uid: req.user.uid, email: req.user.email, fonte: 'cron-now-admin' },
            });
            if (result.ok) { sucessos++; totalNovos += result.novosXmls || 0; }
            else falhas++;
          } catch (e) {
            falhas++;
            console.error(`[sync-cron-now] exceção em ${emp.cnpj}:`, e.message);
          }
        }
        await fa().firestore().collection('sefaz_cron_logs').add({
          executadoEm: fa().firestore.FieldValue.serverTimestamp(),
          totalEmpresas: total, sucessos, falhas, totalNovosXmls: totalNovos,
          duracaoMs: Date.now() - inicio,
          fonte: 'admin-manual',
        });
        console.log(`[sync-cron-now] fim — ${sucessos}/${total} ok, ${totalNovos} novos, ${Date.now() - inicio}ms`);
      } catch (e) {
        console.error('[sync-cron-now] erro fatal:', e);
      }
    });
  } catch (e) {
    console.error('[sync-cron-now] erro:', e);
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /captura-diagnostico ─────────────────────────────────────────────
// Estado consolidado das 3 capturas (NFe DistDFe, NFSe SP, NFSe Nacional ADN).
// Retorna por fonte: último cron, total empresas elegíveis, empresas travadas,
// total docs capturados nos últimos 7d, janela atual.
router.get('/captura-diagnostico', requireAuth, async (req, res) => {
  try {
    const db = fa().firestore();
    const agora = Date.now();
    const seteDias = agora - 7 * 24 * 60 * 60 * 1000;

    async function ultimoLog(col) {
      try {
        const snap = await db.collection(col).orderBy('executadoEm', 'desc').limit(1).get();
        if (snap.empty) return null;
        const d = snap.docs[0].data();
        const ts = d.executadoEm?.toMillis?.() ?? null;
        return {
          executadoEmMs: ts,
          duracaoMs: d.duracaoMs ?? null,
          totalEmpresas: d.totalEmpresas ?? d.total ?? null,
          sucessos: d.sucessos ?? null,
          falhas: d.falhas ?? null,
          totalNovos: d.totalNovos ?? d.totalNovosXmls ?? d.totalNFes ?? d.criadas ?? null,
          erroFatal: d.erroFatal ?? d.erro ?? null,
          fonte: d.fonte ?? null,
        };
      } catch (e) {
        return { erro: e.message };
      }
    }

    async function travadas(col, campoTimestamp) {
      try {
        const snap = await db.collection(col).get();
        let travadas = 0, total = 0;
        snap.forEach(doc => {
          const x = doc.data();
          total++;
          const ts = x[campoTimestamp]?.toMillis?.() ?? null;
          if (!ts || ts < seteDias) travadas++;
        });
        return { total, travadas };
      } catch (e) {
        return { erro: e.message };
      }
    }

    // NFSe SP não tem state-por-CNPJ; conta empresas elegíveis (ccmSp + autorizadoEm).
    async function elegiveisNfseSp() {
      try {
        let total = 0;
        for (const col of ['simples_empresas', 'lucro_empresas']) {
          const snap = await db.collection(col).get();
          snap.forEach(doc => {
            const d = doc.data();
            if ((d.ccmSp || '').toString().trim() && d.nfseSpAutorizadoEm) total++;
          });
        }
        return { total, travadas: null };
      } catch (e) {
        return { erro: e.message };
      }
    }

    // NFe DistDFe: total = universo REAL elegível agora (mesmos filtros do cron
    // em listarEmpresasParaCron). travadas = subset desse universo que está
    // sem sync ou com ultimaSync < 7d em sefaz_state. Substitui o
    // travadas('sefaz_state',...) anterior, que misturava docs históricos
    // (empresas removidas, A3, etc) com elegibilidade atual.
    async function elegiveisNfeReais() {
      try {
        const limite30d = agora - 30 * 24 * 60 * 60 * 1000;
        const elegiveis = new Map(); // cnpj -> docId
        for (const col of ['simples_empresas', 'lucro_empresas']) {
          try {
            const snap = await db.collection(col).get();
            snap.forEach(doc => {
              const d = doc.data();
              if (d.capturarSefaz === false) return;
              const cnpj = (d.cnpj || '').replace(/\D/g, '');
              if (cnpj.length !== 14) return;
              if (d.ultimoAcessoXml) {
                const ult = d.ultimoAcessoXml.toMillis?.() ?? new Date(d.ultimoAcessoXml).getTime();
                if (ult < limite30d) return;
              }
              if (!elegiveis.has(cnpj)) elegiveis.set(cnpj, doc.id);
            });
          } catch (e) { /* collection indisponível, continua */ }
        }
        try {
          const a3Snap = await db.collection('empresas_certificados').where('tipoCert', '==', 'A3').get();
          const a3Ids = new Set(a3Snap.docs.map(d => d.id));
          for (const [cnpj, id] of elegiveis) {
            if (a3Ids.has(id)) elegiveis.delete(cnpj);
          }
        } catch (e) { /* sem certificados, sem filtro A3 */ }
        const total = elegiveis.size;
        let travadas = 0;
        try {
          const stateSnap = await db.collection('sefaz_state').get();
          const stateById = new Map();
          stateSnap.forEach(doc => {
            stateById.set(doc.id, doc.data().ultimaSync?.toMillis?.() ?? null);
          });
          for (const id of elegiveis.values()) {
            const ts = stateById.get(id);
            if (!ts || ts < seteDias) travadas++;
          }
        } catch (e) { /* sem state, deixa travadas=0 */ }
        return { total, travadas };
      } catch (e) {
        return { erro: e.message };
      }
    }

    async function docsRecentes(tipos) {
      try {
        let total = 0;
        for (const tipo of tipos) {
          const snap = await db.collection('documentos_fiscais')
            .where('tipo', '==', tipo)
            .where('createdAt', '>=', new Date(seteDias))
            .count().get().catch(async () => {
              const s = await db.collection('documentos_fiscais')
                .where('tipo', '==', tipo)
                .where('createdAt', '>=', new Date(seteDias))
                .limit(1000).get();
              return { data: () => ({ count: s.size }) };
            });
          total += snap.data().count;
        }
        return total;
      } catch (e) {
        return null;
      }
    }

    const [
      logSefaz, logNfseSp, logNfseNac,
      stateSefaz, stateNfseSp, stateNfseNac,
      docsNfe, docsNfseSp, docsNfseNac,
    ] = await Promise.all([
      ultimoLog('sefaz_cron_logs'),
      ultimoLog('nfsesp_cron_logs'),
      ultimoLog('nfse_nacional_dfe_cron_logs'),
      elegiveisNfeReais(),
      elegiveisNfseSp(),
      travadas('nfse_nacional_dfe_state', 'ultimaSync'),
      docsRecentes(['nfe', 'nfceCte']),
      docsRecentes(['nfsesp']),
      docsRecentes(['nfseNacional']),
    ]);

    return res.json({
      janela: statusJanelaOperacional(),
      capturas: {
        sefazNfe: {
          fonte: 'SEFAZ DistDFe (NFe entrada/saída)',
          endpointCron: '/api/admin/sefaz/sync-cron',
          schedulerEsperado: 'sefaz-cron-noturno (02:00 BRT seg-sex)',
          ultimoCron: logSefaz,
          state: stateSefaz,
          docsUltimos7d: docsNfe,
        },
        nfseSp: {
          fonte: 'NFSe SP (tomados + prestados)',
          endpointCron: '/api/admin/sefaz/nfsesp-cron',
          schedulerEsperado: 'nfsesp-cron-noturno (03:00 BRT seg-sex)',
          ultimoCron: logNfseSp,
          state: stateNfseSp,
          docsUltimos7d: docsNfseSp,
        },
        nfseNacional: {
          fonte: 'NFSe Nacional ADN (DFe)',
          endpointCron: '/api/admin/nfse-nacional-dfe/sync-cron',
          schedulerEsperado: 'nfse-nacional-dfe-cron-noturno (04:00 BRT seg-sex)',
          ultimoCron: logNfseNac,
          state: stateNfseNac,
          docsUltimos7d: docsNfseNac,
        },
      },
    });
  } catch (e) {
    console.error('[GET /captura-diagnostico] erro:', e);
    return res.status(500).json({ error: e.message });
  }
});

router.post('/toggle/:cnpj', requireAuth, express.json(), async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem alterar este status.' });
    }
    const cnpj = String(req.params.cnpj).replace(/\D/g, '');
    if (cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });
    const { ativo } = req.body || {};
    if (typeof ativo !== 'boolean') return res.status(400).json({ error: 'Campo "ativo" (boolean) obrigatório' });

    const db = fa().firestore();
    const colNames = ['simples_empresas', 'lucro_empresas'];
    let updated = 0;
    for (const colName of colNames) {
      const snap = await db.collection(colName).where('cnpj', '==', cnpj).limit(1).get();
      for (const doc of snap.docs) {
        await doc.ref.update({
          capturarSefaz: ativo,
          capturarSefazAlteradoEm: fa().firestore.FieldValue.serverTimestamp(),
          capturarSefazAlteradoPor: req.user.email,
        });
        updated++;
      }
    }
    if (updated === 0) return res.status(404).json({ error: 'Empresa não encontrada' });
    console.log(`[toggle] cnpj=${cnpj} ativo=${ativo} por=${req.user.email} (${updated} doc${updated > 1 ? 's' : ''})`);
    return res.json({ ok: true, cnpj, ativo, updated, alteradoPor: req.user.email });
  } catch (e) {
    console.error('[POST /toggle] erro:', e);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
