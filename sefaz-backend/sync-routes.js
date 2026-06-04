// ============================================================================
// sefaz-backend/sync-routes.js  (ESM)
// Endpoints: /sync-one, /sync-cron, /state/:cnpj, /window
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import forge from 'node-forge';
import { sincronizarEmpresa } from './sync-orchestrator.js';
import { statusJanelaOperacional } from './janela-operacional.js';
import { requireAuth } from './require-admin.js';
import { consultaNFePorChave } from './sefaz-client.js';
import { loadCertificate } from './secret-loader.js';
import { podeAcessarCnpj } from './carteira-auth.js';

const router = express.Router();

function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

// CNPJ do escritorio (S&P). Cert dele vive no Secret Manager (loadCertificate)
// e nao em empresas_certificados — entao a checagem de elegibilidade da S&P
// falha pelo caminho normal (sem cert proprio E sem procuracao a si mesmo).
// Usado em listarEmpresasParaCron pra incluir o escritorio mesmo assim.
const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');

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
    // Drift de secret entre Scheduler e Cloud Run e causa conhecida de cron
    // silenciosamente parado (vide commit 71d4c3a + incidente 01/06/2026).
    // Loga prefixos pra diagnosticar sem vazar secret completo.
    const headerPrefix = headerSecret ? String(headerSecret).slice(0, 4) + '...' : '(ausente)';
    const envPrefix = secret.slice(0, 4) + '...';
    const jobName = req.headers['x-cloudscheduler-jobname'] || '(no header)';
    console.warn(`[requireCronAuth] 403 mismatch — header=${headerPrefix} env=${envPrefix} job=${jobName} ip=${req.ip}`);
    return res.status(403).json({ error: 'Cron auth failed' });
}

router.post('/sync-one', requireAuth, express.json(), async (req, res) => {
  try {
    const { empresaId, empresaCnpj } = req.body || {};
    if (!empresaId || !empresaCnpj) {
      return res.status(400).json({ error: 'empresaId e empresaCnpj são obrigatórios' });
    }
    const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
    if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
    const janela = statusJanelaOperacional();
    if (!janela.dentro) {
      return res.status(403).json({
        error: 'Fora da janela operacional',
        motivo: janela.motivo,
        agoraBRT: janela.agoraBRT,
      });
    }
<<<<<<< ours
    console.log(`[sync-one] início — empresa=${empresaId} cnpj=${empresaCnpj} user=${req.user.email}`);
=======
    console.log(`[sync-one] início — empresa=${empresaId} cnpj=${empresaCnpj} user=${req.user.email} role=${req.user.role}`);
    // Admin bypassa o lock 1h tambem — diagnostico de bug exige varios
    // disparos seguidos sem esperar TTL. Deleta o lock antes; o orquestrador
    // vai recriar normalmente. Race-condition de 2 admins disparando o mesmo
    // CNPJ ao mesmo tempo eh suficientemente improvavel (admin sao poucos).
    if (req.user.role === 'admin') {
      try {
        const cnpjNum = String(empresaCnpj).replace(/\D/g, '');
        await fa().firestore().collection('sefaz_locks').doc(cnpjNum).delete();
      } catch (e) { /* lock pode nao existir — segue */ }
    }
>>>>>>> theirs
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
        // Bloqueadas por cadastro (sem cert A1/A3 e sem procuracao e-CAC) e A3
        // sao puladas em listarEmpresasParaCron, mas persistidas aqui pra que
        // o painel mostre o estado real (em vez de fingir que sao "falhas").
        bloqueadasSemAcesso: empresas._bloqueadasSemAcesso || 0,
        totalA3: empresas._totalA3 || 0,
        // req.cron?.source nunca era setado (codigo morto). Usa o header
        // oficial do Cloud Scheduler como fonte. Fallback 'unknown' garante
        // que NUNCA persistimos `undefined` (Firestore rejeita o write inteiro).
        fonte: req.headers?.['x-cloudscheduler-jobname'] || 'sefaz-cron-noturno',
      });
      console.log(`[sync-cron] fim — ${sucessos}/${empresas.length} sucessos, ${totalNovos} novos, ${duracaoMs}ms (${empresas._bloqueadasSemAcesso || 0} bloqueadas por cadastro, ${empresas._totalA3 || 0} A3 puladas)`);
    } catch (e) {
      console.error('[sync-cron] erro fatal:', e);
      try {
        await fa().firestore().collection('sefaz_cron_logs').add({
          executadoEm: fa().firestore.FieldValue.serverTimestamp(),
          erro: e.message,
          fonte: req.headers?.['x-cloudscheduler-jobname'] || 'sefaz-cron-noturno',
        });
      } catch (errLog) {
        // Duplo silenciamento aqui apaga rastro do erro fatal — logamos.
        console.error('[sync-cron] FALHA registrando erro fatal em sefaz_cron_logs:', errLog.message);
      }
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
        empresas.push({
          id: doc.id,
          cnpj,
          nome: d.nome || d.razaoSocial || '',
          fonte: colName,
          procuracaoEcacAtiva: d.procuracaoEcacAtiva === true,
        });
      });
      console.log(`[sync-cron] collection ${colName}: ${snap.size} docs`);
    } catch (e) {
      console.warn(`[sync-cron] collection ${colName} indisponível:`, e.message);
    }
  }
  const map = new Map();
  empresas.forEach(e => { if (!map.has(e.cnpj)) map.set(e.cnpj, e); });

  // Carrega certs uma vez (A1/A3) — fonte unica pra classificar acesso a SEFAZ.
  // Antes so filtrava A3; agora cruza tambem com procuracaoEcacAtiva pra evitar
  // tentar capturar empresas SEM cert proprio E SEM procuracao (bloqueadas
  // por cadastro). Sem o filtro: 215+ empresas falhavam todo cron com
  // "aguardando cert A1", poluindo o painel com 262 falhas todo dia.
  const certsPorId = new Map();
  const a3Ids = new Set();
  try {
    const certsSnap = await db.collection('empresas_certificados').get();
    certsSnap.forEach(d => {
      const c = d.data();
      const tipoCert = c.tipoCert || 'A1';
      certsPorId.set(d.id, tipoCert);
      if (tipoCert === 'A3') a3Ids.add(d.id);
    });
    if (a3Ids.size > 0) {
      console.log(`[sync-cron] pulando ${a3Ids.size} empresa(s) tipoCert=A3 (capturadas pelo agente local cfi-a3)`);
    }
  } catch (e) {
    console.warn('[sync-cron] erro carregando empresas_certificados:', e.message);
  }

  let bloqueadasSemAcesso = 0;
  const filtradas = Array.from(map.values()).filter(e => {
    if (a3Ids.has(e.id)) return false;
    const tipoCert = certsPorId.get(e.id);
    const temCertProprio = tipoCert === 'A1' || tipoCert === 'A3';
    // A propria S&P (escritorio) entra mesmo sem cert em empresas_certificados:
    // o cert dela vive em Secret Manager e o orquestrador (sync-orchestrator.js)
    // sabe fazer fallback via loadCertificate() quando o CNPJ bate. Sem essa
    // excecao aqui, nem chegava a tentar — caia em "sem acesso" e era pulada.
    const ehEscritorio = e.cnpj === CNPJ_ESCRITORIO;
    const temAcesso = temCertProprio || e.procuracaoEcacAtiva || ehEscritorio;
    if (!temAcesso) {
      bloqueadasSemAcesso++;
      return false;
    }
    return true;
  });

  if (bloqueadasSemAcesso > 0) {
    console.log(`[sync-cron] pulando ${bloqueadasSemAcesso} empresa(s) sem cert A1/A3 nem procuracao e-CAC (bloqueadas por cadastro — admin precisa configurar)`);
  }
  // Anexa contadores na lista pra orchestrator persistir no log + painel
  filtradas._bloqueadasSemAcesso = bloqueadasSemAcesso;
  filtradas._totalA3 = a3Ids.size;
  return filtradas;
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

// ── POST /consulta-nfe-por-chave ─────────────────────────────────────────
// Consulta UMA NFe pela chave (44 dig) e devolve emit/dest parseados do XML.
// Usado pra diagnosticar quando uma NFe nao aparece via cron — descobre se
// o destinatario tem o CNPJ esperado ou nao.
//
// Estrategia: tenta primeiro com CNPJ do ESCRITORIO como interessado (cert
// global). Se SEFAZ retornar cStat=137 (nao localizado), tenta com o CNPJ
// EMITENTE (primeiros 7-20 digitos da chave) — assim cobrimos os dois lados
// da NFe (emitente sempre tem acesso a propria NFe via DistDFe).
router.post('/consulta-nfe-por-chave', requireAuth, express.json(), async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores' });
    }
    const chave = String(req.body?.chave || '').replace(/\D/g, '');
    if (chave.length !== 44) {
      return res.status(400).json({ error: `Chave invalida — esperado 44 digitos, recebido ${chave.length}` });
    }
    const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');
    const cnpjEmitente = chave.slice(6, 20);
    const ufCod = chave.slice(0, 2);
    // Mapa codigo IBGE -> sigla UF (so cobre os principais; SEFAZ recebe
    // qualquer UF valida no cUFAutor — usamos a UF do emitente da chave).
    const ufPorCod = {
      '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
      '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
      '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
      '41': 'PR', '42': 'SC', '43': 'RS',
      '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
    };
    const ufSigla = ufPorCod[ufCod] || 'SP';

    // Helper: extrai emit/dest de um XML de NFe
    const parseEmitDest = (xml) => {
      const pickIn = (tag, scope) => {
        const m = scope.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
        return m ? m[1].trim() : null;
      };
      const pickSection = (tag) => {
        const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
        return m ? m[1] : '';
      };
      const emit = pickSection('emit');
      const dest = pickSection('dest');
      const ide = pickSection('ide');
      const total = pickSection('ICMSTot');
      return {
        emitente: { cnpj: pickIn('CNPJ', emit), nome: pickIn('xNome', emit), uf: pickIn('UF', emit) },
        destinatario: { cnpj: pickIn('CNPJ', dest) || pickIn('CPF', dest), nome: pickIn('xNome', dest), uf: pickIn('UF', dest) },
        numero: pickIn('nNF', ide),
        dataEmissao: pickIn('dhEmi', ide) || pickIn('dEmi', ide),
        valorTotal: pickIn('vNF', total),
        modelo: pickIn('mod', ide),
        natureza: pickIn('natOp', ide),
      };
    };

    // 1ª tentativa: como escritorio (cert global)
    let resp = await consultaNFePorChave({ chave, cnpjInteressado: CNPJ_ESCRITORIO, uf: ufSigla });
    let tentou = ['escritorio'];

    // 2ª tentativa: como emitente — se ainda nao achou
    if (resp.cStat === '137' && cnpjEmitente !== CNPJ_ESCRITORIO) {
      try {
        resp = await consultaNFePorChave({ chave, cnpjInteressado: cnpjEmitente, uf: ufSigla });
        tentou.push('emitente');
      } catch (e) {
        // se falhar (provavel: cert do escritorio nao autoriza pra outro CNPJ),
        // mantem a 1a resposta
        console.warn('[consulta-nfe-por-chave] retry como emitente falhou:', e.message);
      }
    }

    const nfeXml = resp.xmls?.find(x => x.xml && (x.xml.includes('<infNFe') || x.xml.includes('<NFe')));
    let detalhes = null;
    if (nfeXml) {
      try { detalhes = parseEmitDest(nfeXml.xml); } catch (e) { console.warn('[parse] falhou:', e.message); }
    }

    return res.json({
      ok: resp.ok,
      cStat: resp.cStat,
      xMotivo: resp.xMotivo,
      chave,
      cnpjConsultadoComo: tentou.join(' → '),
      ufEmitente: ufSigla,
      cnpjEmitenteChave: cnpjEmitente,
      cnpjEscritorio: CNPJ_ESCRITORIO,
      escritorioEhDestinatario: detalhes?.destinatario?.cnpj
        ? detalhes.destinatario.cnpj.replace(/\D/g, '') === CNPJ_ESCRITORIO
        : null,
      detalhes,
    });
  } catch (e) {
    console.error('[POST /consulta-nfe-por-chave] erro:', e);
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /cert-escritorio-info ────────────────────────────────────────────
// Carrega o cert do escritorio (Secret Manager) e mostra QUAL CNPJ ele tem
// no subject. Usado pra diagnosticar cStat=593 — quando o CNPJ do cert nao
// bate com o CNPJ esperado, NFe nao chega pelo DistDFe pra esse escritorio.
//
// Caso real do dia: o cert estava configurado pra outro CNPJ (nao a S&P),
// entao DistDFe sempre rejeitava com 593. So foi diagnosticado porque
// o usuario tentou consultar uma NFe especifica e viu o cStat literal.
router.get('/cert-escritorio-info', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores' });
    }
    const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');
    const cert = await loadCertificate();
    if (!cert?.pemCert) {
      return res.json({
        ok: false,
        erro: 'Cert carregado mas PEM nao foi extraido (provavel falha de decifragem PFX no boot)',
        cnpjEsperado: CNPJ_ESCRITORIO,
        cnpjNoCert: null,
        mismatch: null,
      });
    }
    // Parseia o cert pra extrair subject e validade
    const cert509 = forge.pki.certificateFromPem(cert.pemCert);
    const subjectAttrs = (cert509.subject?.attributes || []).map(a => ({
      shortName: a.shortName || a.name || a.type,
      value: a.value,
    }));
    const subjectStr = subjectAttrs.map(a => `${a.shortName}=${a.value}`).join(', ');

    // CNPJ pode estar:
    //   a) No CN (padrão ICP-Brasil: "NOME EMPRESA:CNPJ")
    //   b) No serialNumber (OID 2.5.4.5)
    //   c) Em otherName (SAN — mais raro)
    const cn = subjectAttrs.find(a => a.shortName === 'CN' || a.shortName === 'commonName')?.value || '';
    const matchCN = cn.match(/:(\d{14})$/);
    const cnpjDoCN = matchCN ? matchCN[1] : null;
    const serial = subjectAttrs.find(a => a.shortName === 'serialNumber')?.value || '';
    const matchSerial = serial.match(/\d{14}/);
    const cnpjDoSerial = matchSerial ? matchSerial[0] : null;
    const cnpjNoCert = cnpjDoCN || cnpjDoSerial;

    const notBefore = cert509.validity?.notBefore?.toISOString?.() || null;
    const notAfter = cert509.validity?.notAfter?.toISOString?.() || null;
    const valido = notBefore && notAfter && new Date() >= new Date(notBefore) && new Date() < new Date(notAfter);
    const mismatch = cnpjNoCert ? cnpjNoCert !== CNPJ_ESCRITORIO : null;
    const cnpjBaseDoCert = cnpjNoCert ? cnpjNoCert.slice(0, 8) : null;
    const cnpjBaseEsperado = CNPJ_ESCRITORIO.slice(0, 8);
    const mismatchBase = cnpjBaseDoCert ? cnpjBaseDoCert !== cnpjBaseEsperado : null;

    return res.json({
      ok: true,
      cnpjEsperado: CNPJ_ESCRITORIO,        // o que o codigo espera (env var CNPJ_ESCRITORIO)
      cnpjNoCert,                            // o que o cert no Secret Manager tem
      cnpjBaseDoCert,
      cnpjBaseEsperado,
      mismatch,                              // true se diferentes (filial pode bater base)
      mismatchBase,                          // true se nem a base bate — sintoma DEFINITIVO de cStat=593
      subject: subjectStr,
      cn,
      notBefore,
      notAfter,
      valido,
      pfxVersion: cert.version || null,
    });
  } catch (e) {
    console.error('[GET /cert-escritorio-info] erro:', e);
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
            // Cadastro unico dadosFiscais.ccmSp (fallback top-level legado)
            if ((d.dadosFiscais?.ccmSp || d.ccmSp || '').toString().trim() && d.nfseSpAutorizadoEm) total++;
          });
        }
        return { total, travadas: null };
      } catch (e) {
        return { erro: e.message };
      }
    }

    // NFSe Nacional ADN: conta empresas com nfseNacionalDfeAtivo === true. Antes
    // contava docs em nfse_nacional_dfe_state, que so populam APOS primeira sync —
    // mostrava 0 mesmo com admin tendo habilitado empresas.
    async function elegiveisNfseNacional() {
      try {
        let total = 0;
        for (const col of ['simples_empresas', 'lucro_empresas']) {
          const snap = await db.collection(col).get();
          snap.forEach(doc => {
            if (doc.data().nfseNacionalDfeAtivo === true) total++;
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
        const candidatos = new Map(); // cnpj -> { id, procuracaoEcacAtiva }
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
              if (!candidatos.has(cnpj)) {
                candidatos.set(cnpj, { id: doc.id, procuracaoEcacAtiva: d.procuracaoEcacAtiva === true });
              }
            });
          } catch (e) { /* collection indisponível, continua */ }
        }

        // Cruza com empresas_certificados pra classificar acesso a SEFAZ.
        // Critério (mesmo do listarEmpresasParaCron):
        //   elegivel = cert A1 proprio OU procuracao e-CAC ativa
        //   bloqueada = sem cert E sem procuracao (admin precisa configurar)
        //   A3 = capturada por agente local cfi-a3, fora deste cron
        const certsPorId = new Map();
        const a3Ids = new Set();
        try {
          const certsSnap = await db.collection('empresas_certificados').get();
          certsSnap.forEach(d => {
            const tipoCert = d.data().tipoCert || 'A1';
            certsPorId.set(d.id, tipoCert);
            if (tipoCert === 'A3') a3Ids.add(d.id);
          });
        } catch (e) { /* sem certificados, segue sem filtrar */ }

        const elegiveis = new Map(); // cnpj -> id (de quem vai mesmo ser capturado)
        let bloqueadas = 0;
        for (const [cnpj, info] of candidatos) {
          if (a3Ids.has(info.id)) continue; // A3 fora deste cron
          const tipoCert = certsPorId.get(info.id);
          const temCertProprio = tipoCert === 'A1' || tipoCert === 'A3';
          if (temCertProprio || info.procuracaoEcacAtiva) {
            elegiveis.set(cnpj, info.id);
          } else {
            bloqueadas++;
          }
        }

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
        return { total, travadas, bloqueadas };
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
      elegiveisNfseNacional(),
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

// Histórico de execuções de qualquer cron de captura (whitelist por nome de
// coleção). Usado pelas abas "Erros & Logs" e "Captura Portal SP" pra mostrar
// quando o cron realmente rodou, sucesso/falha e quantos docs novos vieram.
//
// Antes só dava pra ver o ÚLTIMO log via /captura-diagnostico. Sem histórico
// ficava impossível diferenciar "cron parou em 31/05" de "cron rodou todo dia
// mas trouxe 0 NFs novas" — ambos aparecem como "Última captura 31/05" no
// painel (que na verdade lê MAX(dhEmi), não executadoEm).
const CRON_LOG_COLLECTIONS = new Set([
  'sefaz_cron_logs',
  'nfsesp_cron_logs',
  'nfse_nacional_dfe_cron_logs',
  'das_cron_logs',
  'caixa_postal_cron_logs',
  'dctfweb_cron_logs',
  'manifestacoes_cron_logs',
  'vencimentos_cron_logs',
]);

router.get('/cron-logs', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores' });
    }
    const col = String(req.query.col || '');
    if (!CRON_LOG_COLLECTIONS.has(col)) {
      return res.status(400).json({
        error: `Coleção inválida. Use uma de: ${[...CRON_LOG_COLLECTIONS].join(', ')}`,
      });
    }
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
    const db = fa().firestore();
    const snap = await db.collection(col).orderBy('executadoEm', 'desc').limit(limit).get();
    const logs = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        executadoEmMs: d.executadoEm?.toMillis?.() ?? null,
        duracaoMs: d.duracaoMs ?? null,
        totalEmpresas: d.totalEmpresas ?? d.total ?? null,
        processadas: d.processadas ?? null,
        sucessos: d.sucessos ?? null,
        falhas: d.falhas ?? null,
        totalNovos: d.totalNovos ?? d.totalNovosXmls ?? d.totalNFes ?? d.criadas ?? null,
        erroFatal: d.erroFatal ?? d.erro ?? null,
        fonte: d.fonte ?? null,
        metodoLogin: d.metodoLogin ?? null,
        capturadoPor: d.capturadoPor ?? null,
        periodo: d.periodo ?? null,
        prestadoresAutorizados: d.prestadoresAutorizados ?? null,
        errosResumo: d.errosResumo ?? null,
      };
    });
    return res.json({ colecao: col, total: logs.length, logs });
  } catch (e) {
    console.error('[GET /cron-logs] erro:', e);
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
