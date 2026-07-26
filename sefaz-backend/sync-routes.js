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
import { importarXmlSefaz } from './xml-importer.js';
import { withCronHeartbeat, listarCronsOrfaos } from './cron-heartbeat.js';
import { manifestarPendentes } from './manifesto-orchestrator.js';
import { listarElegibilidadeNfseNacionalDfe } from './nfse-nacional-dfe-eligibility.js';
import { certA1MetadataValido, selecionarCertA1PorBase } from './cert-base-helper.js';
import { umaPorRaizPorCiclo } from './raiz-throttle-helper.js';
import { secretsMatch } from './cron-secret.js';

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
    if (secretsMatch(headerSecret, secret)) {
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
    const { empresaId, empresaCnpj, resetNSU = false } = req.body || {};
    if (!empresaId || !empresaCnpj) {
      return res.status(400).json({ error: 'empresaId e empresaCnpj são obrigatórios' });
    }
    // resetNSU so admin (operacao pesada — reprocessa 90 dias de DF-e)
    if (resetNSU && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'resetNSU é exclusivo de admin' });
    }
    const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
    if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
    // Janela operacional 07-20 BRT bloqueia colaborador disparando captura fora
    // do horario comercial — protege quota SEFAZ. Admin tem bypass (sabe o que
    // faz, e precisa testar fora-da-janela pra debug — vide caso S&P 03/06).
    if (req.user.role !== 'admin') {
      const janela = statusJanelaOperacional();
      if (!janela.dentro) {
        return res.status(403).json({
          error: 'Fora da janela operacional',
          motivo: janela.motivo,
          agoraBRT: janela.agoraBRT,
        });
      }
    }
    console.log(`[sync-one] início — empresa=${empresaId} cnpj=${empresaCnpj} user=${req.user.email} role=${req.user.role}`);
    // Admin tambem bypassa o lock 1h por CNPJ — diagnostico de bug exige
    // varios disparos seguidos sem esperar TTL. Deleta o lock antes; o
    // orquestrador recria normal. Race-condition de 2 admins disparando
    // o mesmo CNPJ ao mesmo tempo: risco baixo (poucos admins).
    if (req.user.role === 'admin') {
      try {
        const cnpjNum = String(empresaCnpj).replace(/\D/g, '');
        await fa().firestore().collection('sefaz_locks').doc(cnpjNum).delete();
      } catch (e) { /* lock pode nao existir — segue */ }
    }
    const result = await sincronizarEmpresa({
      empresaId, empresaCnpj, resetNSU,
      capturadoPor: { uid: req.user.uid, email: req.user.email, fonte: resetNSU ? 'manual-reset-nsu' : 'manual' },
    });
    if (!result.ok && result.locked) return res.status(409).json(result);
    // resetBloqueado (cooldown do 90d) NÃO é rate-limit da SEFAZ — é guard-rail
    // nosso. Manda 409 (não 429) pra UI não rotular como "aguarde 1h cStat 656".
    if (!result.ok && result.resetBloqueado) return res.status(409).json(result);
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
  const fonte = req.headers?.['x-cloudscheduler-jobname'] || 'sefaz-cron-noturno';
  // withCronHeartbeat:
  //  1) cria log em sefaz_cron_logs com status='iniciado' ANTES de responder 200;
  //  2) responde 200 imediato (Scheduler nao retentara);
  //  3) roda o trabalho em setImmediate e atualiza o log pra 'sucesso'/'falha'.
  //
  // Se o container for reciclado no meio, o log fica em 'iniciado' — detectavel
  // por GET /sync-cron-health (e por listarCronsOrfaos no cron de alerta).
  // Antes: 200 imediato + setImmediate gravando log SO no fim. Container morto
  // = NENHUM log gravado = ninguem sabia que o cron parou.
  await withCronHeartbeat({
    collection: 'sefaz_cron_logs',
    fonte,
    res,
  }, async () => {
    console.log('[sync-cron] início — fonte:', fonte);
    const empresas = await listarEmpresasParaCron();
    console.log(`[sync-cron] ${empresas.length} empresas elegíveis`);
    let sucessos = 0;
    let falhas = 0;
    let totalNovos = 0;
    // Top 50 falhas com motivo — pra UI 'Erros & Logs' mostrar detalhe
    // por linha expandida (PR #28). Sem isso, painel so dizia '17 falhas'
    // sem nenhuma pista de QUAIS empresas e por que.
    const errosResumo = [];
    for (const emp of empresas) {
      try {
        const result = await sincronizarEmpresa({
          empresaId: emp.id,
          empresaCnpj: emp.cnpj,
          capturadoPor: { uid: 'cron-system', email: 'cron@spassessoriacontabil', fonte: 'cron' },
        });
        if (result.ok) { sucessos++; totalNovos += (result.novosXmls || 0); }
        else {
          falhas++;
          console.warn(`[sync-cron] falha em ${emp.cnpj}: ${result.motivo}`);
          if (errosResumo.length < 50) errosResumo.push({
            cnpj: emp.cnpj,
            nome: (emp.nome || '').slice(0, 60),
            motivo: String(result.motivo || '').slice(0, 200),
            codigo: result.rateLimited ? 'cStat=656' : (result.certInvalido ? 'cStat=593' : (result.locked ? 'LOCK' : null)),
          });
        }
      } catch (e) {
        falhas++;
        console.error(`[sync-cron] exceção em ${emp.cnpj}:`, e.message);
        if (errosResumo.length < 50) errosResumo.push({
          cnpj: emp.cnpj,
          nome: (emp.nome || '').slice(0, 60),
          motivo: `[EXCECAO] ${String(e.message || '').slice(0, 200)}`,
          codigo: 'EXCEPTION',
        });
      }
    }
    // Manifestação automática (ciência) dos resNFe que ficaram pendentes de
    // execuções anteriores. Sem isso o resumo fica "Pendente" com R$ 0,00 pra
    // sempre — a SEFAZ só libera o procNFe completo (valores, itens, data)
    // depois da manifestação, que era manual (botão no painel admin). Erros
    // por nota não derrubam o cron; o resumo vai pro log.
    let manifestacaoAuto = null;
    try {
      manifestacaoAuto = await manifestarPendentes({
        tipo: 'ciencia',
        limit: 100,
        dryRun: false,
        capturadoPor: { uid: 'cron-system', email: 'cron@spassessoriacontabil', fonte: 'cron' },
      });
      console.log(`[sync-cron] manifestação automática: ${manifestacaoAuto.sucessos}/${manifestacaoAuto.total} ciência(s) aceitas, ${manifestacaoAuto.falhas} falhas`);
    } catch (e) {
      console.warn('[sync-cron] manifestação automática falhou:', e.message);
      manifestacaoAuto = { erro: String(e.message || 'desconhecido').slice(0, 200) };
    }

    console.log(`[sync-cron] fim — ${sucessos}/${empresas.length} sucessos, ${totalNovos} novos (${empresas._bloqueadasSemAcesso || 0} bloqueadas por cadastro, ${empresas._totalA3 || 0} A3 puladas)`);
    // Campos retornados aqui sao MERGED no log (junto com status='sucesso',
    // duracaoMs, finalizadoEm). Bloqueadas por cadastro (sem cert A1/A3 e sem
    // procuracao e-CAC) e A3 sao puladas em listarEmpresasParaCron, mas
    // persistidas aqui pra que o painel mostre o estado real (em vez de
    // fingir que sao "falhas").
    return {
      totalEmpresas: empresas.length,
      sucessos, falhas, totalNovosXmls: totalNovos,
      bloqueadasSemAcesso: empresas._bloqueadasSemAcesso || 0,
      totalA3: empresas._totalA3 || 0,
      manifestacaoAuto: manifestacaoAuto ? {
        total: manifestacaoAuto.total ?? 0,
        sucessos: manifestacaoAuto.sucessos ?? 0,
        falhas: manifestacaoAuto.falhas ?? 0,
        erro: manifestacaoAuto.erro || null,
      } : null,
      errosResumo,
    };
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

// ============================================================================
// /sync-drenagem-cron — drena empresas com PENDÊNCIA NSU (fila na SEFAZ).
// Caso FLANACAR 22/07: 15.586 NSUs na fila e só o cron noturno drenando
// (~2.500/noite = ~1 semana). Este cron roda de dia, descobre sozinho as
// empresas com pendenciaNSU>0 (piores primeiro), sincroniza até MAX_ALVOS
// por janela e PARA no primeiro 656 (não insiste contra rate-limit).
// O lock de 1h por CNPJ já evita colisão com o noturno e entre janelas.
// ============================================================================
router.post('/sync-drenagem-cron', requireCronAuth, async (req, res) => {
  const fonte = req.headers?.['x-cloudscheduler-jobname'] || 'sefaz-drenagem-cron';
  await withCronHeartbeat({ collection: 'sefaz_cron_logs', fonte, res }, async () => {
    const MAX_ALVOS = 10;
    const SLEEP_MS = 60_000;
    const db = fa().firestore();

    // Descobre pendências direto do sefaz_state (piores primeiro).
    const stSnap = await db.collection('sefaz_state').get();
    const pendentes = [];
    stSnap.forEach((doc) => {
      const d = doc.data() || {};
      const pend = Number(d.pendenciaNSU) || 0;
      if (pend > 0) pendentes.push({ cnpj: doc.id, pendenciaNSU: pend });
    });
    pendentes.sort((a, b) => b.pendenciaNSU - a.pendenciaNSU);
    const alvos = pendentes.slice(0, MAX_ALVOS);
    console.log(`[sync-drenagem] ${pendentes.length} empresa(s) com pendência; drenando top ${alvos.length}`);

    let sucessos = 0, falhas = 0, totalNovos = 0, parouEm656 = false;
    const errosResumo = [];
    for (let i = 0; i < alvos.length && !parouEm656; i++) {
      const alvo = alvos[i];
      // Resolve empresaId pelo CNPJ (mesma busca do sync-targeted).
      let emp = null;
      for (const col of ['simples_empresas', 'lucro_empresas']) {
        const snap = await db.collection(col).where('cnpj', '==', alvo.cnpj).limit(1).get();
        if (!snap.empty) { emp = { id: snap.docs[0].id, cnpj: alvo.cnpj }; break; }
      }
      if (!emp) {
        // cnpj formatado no doc — fallback lento só quando necessário
        for (const col of ['simples_empresas', 'lucro_empresas']) {
          const todos = await db.collection(col).get();
          for (const d of todos.docs) {
            if (String(d.data().cnpj || '').replace(/\D/g, '') === alvo.cnpj) { emp = { id: d.id, cnpj: alvo.cnpj }; break; }
          }
          if (emp) break;
        }
      }
      if (!emp) { console.warn(`[sync-drenagem] ${alvo.cnpj} sem cadastro — pulando`); continue; }

      try {
        const r = await sincronizarEmpresa({
          empresaId: emp.id, empresaCnpj: emp.cnpj,
          capturadoPor: { uid: 'cron-system', email: 'cron@spassessoriacontabil', fonte: 'drenagem' },
        });
        if (r.ok) { sucessos++; totalNovos += (r.novosXmls || 0); }
        else if (r.locked) { /* noturno/manual acabou de rodar — ok, pula */ }
        else {
          falhas++;
          if (errosResumo.length < 20) errosResumo.push({ cnpj: emp.cnpj, motivo: String(r.motivo || '').slice(0, 200) });
          if (r.rateLimited) { parouEm656 = true; console.warn('[sync-drenagem] 656 — parando a janela'); }
        }
      } catch (e) {
        falhas++;
        if (errosResumo.length < 20) errosResumo.push({ cnpj: emp.cnpj, motivo: `[EXCECAO] ${String(e.message || '').slice(0, 200)}` });
      }
      if (i < alvos.length - 1 && !parouEm656) await new Promise((r2) => setTimeout(r2, SLEEP_MS));
    }

    return {
      totalEmpresas: alvos.length,
      comPendencia: pendentes.length,
      sucessos, falhas, totalNovos, parouEm656, errosResumo,
    };
  });
});

async function listarEmpresasParaCron() {
  const db = fa().firestore();
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
        // NÃO pular por ultimoAcessoXml antigo. O filtro de 30 dias parava a
        // captura em silêncio de qualquer empresa cujos XMLs ninguém abrisse
        // por um mês — NFs emitidas contra o cliente deixavam de ser trazidas
        // sem nenhum aviso (incidente da NF 175/Mister Totem contra o próprio
        // escritório). Captura fiscal precisa ser contínua; desativação só
        // explícita via capturarSefaz=false.
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
  // NFe DistDFe no Cloud Run exige A1 proprio ou A1 valido da mesma raiz CNPJ.
  // Procuracao e-CAC do escritorio nao substitui certificado neste servico:
  // SEFAZ retorna cStat=593 quando o CNPJ-base do cert difere do consultado.
  const certsPorId = new Map();
  const certsMeta = [];
  const a3Ids = new Set();
  try {
    const certsSnap = await db.collection('empresas_certificados').get();
    certsSnap.forEach(d => {
      const c = d.data();
      const certMeta = {
        empresaId: d.id,
        tipoCert: c.tipoCert || 'A1',
        cnpj: c.cnpj,
        notAfter: c.notAfter,
        storagePath: c.storagePath,
        passwordEnc: c.passwordEnc,
      };
      certsMeta.push(certMeta);
      certsPorId.set(d.id, certMeta);
      const tipoCert = certMeta.tipoCert;
      if (tipoCert === 'A3') a3Ids.add(d.id);
    });
    if (a3Ids.size > 0) {
      console.log(`[sync-cron] pulando ${a3Ids.size} empresa(s) tipoCert=A3 (capturadas pelo agente local cfi-a3)`);
    }
  } catch (e) {
    console.warn('[sync-cron] erro carregando empresas_certificados:', e.message);
  }

  let bloqueadasSemAcesso = 0;
  let a3PuladoCloud = 0;
  let usandoA1MesmaRaiz = 0;
  const nowMs = Date.now();
  const filtradas = Array.from(map.values()).filter(e => {
    const certMeta = certsPorId.get(e.id);
    const tipoCert = certMeta?.tipoCert;
    const temA1Proprio = certA1MetadataValido(certMeta, nowMs);
    const certMesmaRaiz = selecionarCertA1PorBase(certsMeta, e.cnpj, nowMs, e.id);
    const temA1MesmaRaiz = !!certMesmaRaiz;
    const ehEscritorio = e.cnpj === CNPJ_ESCRITORIO;
    // A propria S&P (escritorio) entra mesmo sem cert em empresas_certificados:
    // o cert dela vive em Secret Manager e o orquestrador (sync-orchestrator.js)
    // sabe fazer fallback via loadCertificate() quando o CNPJ bate. Sem essa
    // excecao aqui, nem chegava a tentar — caia em "sem acesso" e era pulada.
    const temAcesso = temA1Proprio || temA1MesmaRaiz || ehEscritorio;
    if (!temAcesso) {
      if (tipoCert === 'A3') a3PuladoCloud++;
      bloqueadasSemAcesso++;
      return false;
    }
    if (!temA1Proprio && temA1MesmaRaiz) usandoA1MesmaRaiz++;
    return true;
  });

  if (a3PuladoCloud > 0) {
    console.log(`[sync-cron] pulando ${a3PuladoCloud} empresa(s) tipoCert=A3 sem A1 da mesma raiz (captura via agente local cfi-a3)`);
  }
  if (bloqueadasSemAcesso > 0) {
    console.log(`[sync-cron] pulando ${bloqueadasSemAcesso} empresa(s) sem A1 proprio/mesma raiz para NFe DistDFe`);
  }
  if (usandoA1MesmaRaiz > 0) {
    console.log(`[sync-cron] ${usandoA1MesmaRaiz} empresa(s) usando A1 de mesma raiz CNPJ`);
  }
  // Anti-656 (caso VINATEX 02/07/2026): consultar 2+ CNPJs da mesma raiz na
  // mesma janela de 1h gera "Consumo Indevido" nas consultas seguintes — a
  // filial 0002 ficou com ultNSU=0 sem nunca capturar. Regra: 1 CNPJ por raiz
  // por ciclo, rotação diária determinística (raiz-throttle-helper.js).
  const { selecionadas, puladas } = umaPorRaizPorCiclo(filtradas);
  if (puladas.length > 0) {
    console.log(`[sync-cron] adiando ${puladas.length} empresa(s) da mesma raiz CNPJ pro(s) próximo(s) ciclo(s) (anti cStat=656): ${puladas.map(e => e.cnpj).join(', ')}`);
  }

  // Anexa contadores na lista pra orchestrator persistir no log + painel
  selecionadas._bloqueadasSemAcesso = bloqueadasSemAcesso;
  selecionadas._totalA3 = a3Ids.size;
  selecionadas._a3ViaProcuracao = 0;
  selecionadas._usandoA1MesmaRaiz = usandoA1MesmaRaiz;
  selecionadas._adiadasMesmaRaiz = puladas.length;
  return selecionadas;
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

// GET /sync-cron-health — detecta crons orfaos (status='iniciado' por > staleMin).
// Se aparecer algo aqui, e prova direta de que o container morreu no meio do
// setImmediate (cold scale-down, OOM, deploy). Vide cron-heartbeat.js.
// Query: ?staleMin=120 (default 120 — folga generosa pra varredura de 60+ empresas).
router.get('/sync-cron-health', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
  const staleMin = Math.max(5, parseInt(req.query.staleMin || '120', 10));
  try {
    const orfaos = await listarCronsOrfaos('sefaz_cron_logs', staleMin);
    return res.json({ ok: true, staleMin, orfaosCount: orfaos.length, orfaos });
  } catch (e) {
    console.error('[GET /sync-cron-health] erro:', e);
    return res.status(500).json({ error: e.message });
  }
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
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores' });
  }
  await withCronHeartbeat({
    collection: 'sefaz_cron_logs',
    fonte: 'admin-manual',
    res,
    metadados: { adminEmail: req.user.email },
  }, async () => {
    console.log('[sync-cron-now] início — admin:', req.user.email);
    let sucessos = 0, falhas = 0, totalNovos = 0;
    const empresas = await listarEmpresasParaCron();
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
    // Mesma manifestação automática do cron noturno — sem ela, o admin que
    // clica "Forçar captura agora" continuava vendo os resumos "Pendente"
    // até a madrugada. Ciência agora; o procNFe completo vem na captura
    // seguinte (forçar de novo em ~30min ou aguardar o cron).
    let manifestacaoAuto = null;
    try {
      manifestacaoAuto = await manifestarPendentes({
        tipo: 'ciencia',
        limit: 100,
        dryRun: false,
        capturadoPor: { uid: req.user.uid, email: req.user.email, fonte: 'cron-now-admin' },
      });
      console.log(`[sync-cron-now] manifestação automática: ${manifestacaoAuto.sucessos}/${manifestacaoAuto.total} ciência(s) aceitas, ${manifestacaoAuto.falhas} falhas`);
    } catch (e) {
      console.warn('[sync-cron-now] manifestação automática falhou:', e.message);
      manifestacaoAuto = { erro: String(e.message || 'desconhecido').slice(0, 200) };
    }

    console.log(`[sync-cron-now] fim — ${sucessos}/${empresas.length} ok, ${totalNovos} novos`);
    return {
      totalEmpresas: empresas.length, sucessos, falhas, totalNovosXmls: totalNovos,
      manifestacaoAuto: manifestacaoAuto ? {
        total: manifestacaoAuto.total ?? 0,
        sucessos: manifestacaoAuto.sucessos ?? 0,
        falhas: manifestacaoAuto.falhas ?? 0,
        erro: manifestacaoAuto.erro || null,
      } : null,
    };
  });
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

    // Resumo do que SEFAZ devolveu — util quando cStat=138 mas o parse falhou
    // (geralmente porque vieram resumos/eventos em vez do XML completo da NFe).
    const xmlsResumo = (resp.xmls || []).map(x => ({
      schema: x.schema || null,
      nsu: x.nsu || null,
      temXml: !!x.xml,
      tamanho: x.xml?.length || 0,
      primeiraTag: x.xml ? (x.xml.match(/<(\w+)[\s>]/)?.[1] || null) : null,
    }));

    // GRAVAR a nota — quando importar=true, persiste os XMLs que a SEFAZ
    // devolveu na consulta por chave, usando o mesmo importer do distNSU.
    // Resolve o caso de NFe que existe na SEFAZ (cStat=138 por chave) mas
    // NAO vem pelo distNSU (passou do cursor / nao distribuida). Se vier
    // resumo, dispara Ciencia pra liberar o procNFe completo no proximo run.
    const importacao = [];
    if (req.body?.importar === true && resp.xmls?.length) {
      // Destinatario da nota = empresa-cliente dona do doc. Usa o do XML
      // parseado (detalhes.destinatario) ou o escritorio como fallback.
      const cnpjDest = detalhes?.destinatario?.cnpj?.replace(/\D/g, '') || CNPJ_ESCRITORIO;
      for (const x of resp.xmls) {
        if (!x.xml) continue;
        try {
          const r = await importarXmlSefaz({
            empresaId: null,
            empresaCnpj: cnpjDest,
            xml: x.xml, schema: x.schema, nsu: x.nsu,
            capturadoPor: { uid: req.user.uid, email: req.user.email, fonte: 'consulta-chave-importar' },
          });
          importacao.push({ schema: x.schema, status: r.status, chave: r.chave || chave, motivo: r.motivo || null });
          // Se gravou resumo, dispara Ciencia pra liberar o XML completo
          if ((r.status === 'ok') && r.tipoDoc === 'resNFe') {
            setImmediate(async () => {
              try {
                const { manifestarUma } = await import('./manifesto-orchestrator.js');
                await manifestarUma({ chNFe: chave, cnpjDestinatario: cnpjDest, tipo: 'ciencia', capturadoPor: req.user });
              } catch (e) { console.warn('[consulta-chave-importar] manifest falhou:', e.message); }
            });
          }
        } catch (e) {
          importacao.push({ schema: x.schema, status: 'erro', motivo: e.message });
        }
      }
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
      xmlsResumo,
      totalXmls: resp.xmls?.length || 0,
      importacao: importacao.length ? importacao : null,
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
          // 'iniciado' = run longo em andamento (heartbeat) — o painel mostra
          // "em execução" em vez de parecer travado por 15-25 min.
          status: d.status ?? null,
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

    // Lê o cursor NSU (nfse_nacional_dfe_state) das elegíveis pra PROVAR se
    // "0 docs capturados" é correto ou é bug. O ADN devolve maxNSU (último NSU
    // disponível pra aquele CNPJ); o orquestrador persiste ultNSU (até onde
    // capturamos). Se maxNSU > ultNSU há documento esperando e 0 capturado é
    // falha real. Se maxNSU <= ultNSU o próprio provedor confirma que não há
    // nada — 0 é correto (elegível sem movimento no ADN, comum na transição).
    async function estadoNsuNacional(empresas) {
      const itens = [];
      let algumComMovimento = false;
      let algumComState = false;
      await Promise.all((empresas || []).map(async (e) => {
        const cnpjNum = String(e.cnpj || '').replace(/\D/g, '');
        let ultNSU = null, maxNSU = null, ultimaSyncMs = null;
        try {
          const snap = await db.collection('nfse_nacional_dfe_state').doc(cnpjNum).get();
          if (snap.exists) {
            const d = snap.data();
            const toNum = (v) => (v == null ? null : Number(String(v).replace(/\D/g, '')));
            ultNSU = toNum(d.ultNSU);
            maxNSU = toNum(d.maxNSU);
            ultimaSyncMs = d.ultimaSync?.toMillis?.() ?? null;
            algumComState = true;
          }
        } catch { /* sem state, segue */ }
        // semMovimento: true = provedor sem nada; false = há doc esperando;
        // null = ainda não dá pra afirmar (nunca sincronizou / sem maxNSU).
        const semMovimento = (maxNSU != null && ultNSU != null) ? maxNSU <= ultNSU : null;
        if (semMovimento === false) algumComMovimento = true;
        itens.push({ nome: (e.nome || '').slice(0, 60), cnpj: cnpjNum, ultNSU, maxNSU, ultimaSyncMs, semMovimento });
      }));
      // Sinal pro farol: true se ALGUÉM tem doc esperando; false se TODOS com
      // state já alcançaram o maxNSU; null se ninguém tem state (nunca rodou).
      const movimentoDisponivel = algumComMovimento ? true : (algumComState ? false : null);
      return { itens, movimentoDisponivel };
    }

    // NFSe Nacional ADN: conta elegibilidade REAL. A flag ativa sem A1 proprio
    // gerava 258+ falhas E2243 por usar cert do escritorio em CNPJ de outra raiz.
    async function elegiveisNfseNacional() {
      try {
        const { resumo, empresas } = await listarElegibilidadeNfseNacionalDfe();
        // movimentoDisponivel é calculado SEMPRE (24/07: o cálculo era só para
        // ≤10 elegíveis — quando o #297 destravou 28, o sinal virou null e o
        // farol caía no crítico "rodando sem capturar" mesmo com o ADN
        // confirmando lote vazio pra todo mundo; N leituras de doc é barato).
        // A lista detalhada com cursor NSU continua só quando são POUCAS —
        // responde "quem são e por que 0 docs?" direto no card.
        let elegiveisLista = null;
        let movimentoDisponivel = null;
        try {
          const { itens, movimentoDisponivel: mov } = await estadoNsuNacional(empresas);
          movimentoDisponivel = mov;
          // Lista por empresa até 40 elegíveis (25/07, caso 4BZ/Jundiaí "por
          // que segue 0?"): a linha da empresa responde na tela se ela foi
          // consultada, se o ADN confirmou vazio ou se há doc esperando.
          if (resumo.elegiveis <= 40) elegiveisLista = itens;
        } catch { /* sem state, farol mantém a rede de segurança */ }
        return {
          total: resumo.elegiveis,
          travadas: null,
          bloqueadas: resumo.bloqueadas,
          totalAtivas: resumo.totalAtivas,
          bloqueiosPorMotivo: resumo.bloqueiosPorMotivo,
          elegiveisLista,
          movimentoDisponivel,
        };
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
        const candidatos = new Map(); // cnpj -> { id, procuracaoEcacAtiva }
        for (const col of ['simples_empresas', 'lucro_empresas']) {
          try {
            const snap = await db.collection(col).get();
            snap.forEach(doc => {
              const d = doc.data();
              if (d.capturarSefaz === false) return;
              const cnpj = (d.cnpj || '').replace(/\D/g, '');
              if (cnpj.length !== 14) return;
              // Sem filtro por ultimoAcessoXml — espelha listarEmpresasParaCron,
              // que não pula mais empresas por falta de acesso recente.
              if (!candidatos.has(cnpj)) {
                candidatos.set(cnpj, { id: doc.id, procuracaoEcacAtiva: d.procuracaoEcacAtiva === true });
              }
            });
          } catch (e) { /* collection indisponível, continua */ }
        }

        // Cruza com empresas_certificados pra classificar acesso a SEFAZ.
        // Criterio (mesmo do listarEmpresasParaCron):
        //   elegivel = A1 proprio OU A1 valido da mesma raiz CNPJ OU escritorio
        //   bloqueada = sem A1 para NFe DistDFe
        //   A3 = capturada por agente local cfi-a3, fora deste cron
        const certsPorId = new Map();
        const certsMeta = [];
        try {
          const certsSnap = await db.collection('empresas_certificados').get();
          certsSnap.forEach(d => {
            const c = d.data();
            const certMeta = {
              empresaId: d.id,
              tipoCert: c.tipoCert || 'A1',
              cnpj: c.cnpj,
              notAfter: c.notAfter,
              storagePath: c.storagePath,
              passwordEnc: c.passwordEnc,
            };
            certsMeta.push(certMeta);
            certsPorId.set(d.id, certMeta);
          });
        } catch (e) { /* sem certificados, segue sem filtrar */ }

        const elegiveis = new Map(); // cnpj -> id (de quem vai mesmo ser capturado)
        let bloqueadas = 0;
        const nowMs = Date.now();
        // Motivos dos bloqueios (25/07): o card mostrava "272 bloqueadas" sem
        // dizer POR QUÊ — mesmo padrão do card ADN, que já quebra por motivo.
        const bloqueiosPorMotivo = {};
        const contaMotivo = (m) => { bloqueiosPorMotivo[m] = (bloqueiosPorMotivo[m] || 0) + 1; };
        for (const [cnpj, info] of candidatos) {
          const certMeta = certsPorId.get(info.id);
          const temA1Proprio = certA1MetadataValido(certMeta, nowMs);
          const temA1MesmaRaiz = !!selecionarCertA1PorBase(certsMeta, cnpj, nowMs, info.id);
          const ehEscritorio = cnpj === CNPJ_ESCRITORIO;
          if (temA1Proprio || temA1MesmaRaiz || ehEscritorio) {
            elegiveis.set(cnpj, info.id);
          } else {
            bloqueadas++;
            if (certMeta?.tipoCert === 'A3') {
              contaMotivo('Certificado A3 — capturada pelo agente local (cfi-a3), fora do cron em nuvem.');
            } else if (certMeta) {
              contaMotivo('A1 cadastrado mas inválido (vencido ou sem PFX/senha) — reenvie o .pfx na coluna Certificado.');
            } else {
              contaMotivo('Sem certificado A1 (nem próprio, nem da mesma raiz CNPJ) — suba o A1 da empresa na coluna Certificado do Status.');
            }
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
          // sefaz_state é chaveado por CNPJ (persisteUltNSU usa .doc(cnpjNum)).
          // O lookup anterior usava o id do cadastro da empresa e NUNCA achava
          // nada — 100% das elegíveis apareciam "travadas" mesmo com a captura
          // rodando. Busca por CNPJ, com fallback no id pra docs legados.
          for (const [cnpj, id] of elegiveis) {
            const ts = stateById.get(cnpj) ?? stateById.get(id);
            if (!ts || ts < seteDias) travadas++;
          }
        } catch (e) { /* sem state, deixa travadas=0 */ }
        return { total, travadas, bloqueadas, bloqueiosPorMotivo };
      } catch (e) {
        return { erro: e.message };
      }
    }

    // Conta docs recentes por fonte. Cada importer grava tipo e data do seu
    // jeito — a versão anterior consultava tipos que não existem no banco
    // ('nfe', 'nfceCte', 'nfsesp' vs os reais 'NFe'/'NFCe'/'CTe'/'NFSe') e
    // sempre num campo só, então o painel mostrava "—" pra tudo:
    //   - xml-importer (DistDFe):        tipo 'NFe'|'NFCe'|'CTe'|'MDFe', createdAt Timestamp
    //   - nfse-sp-importer:              tipo 'NFSe',        createdAt string ISO
    //   - nfse-nacional-dfe-importer:    tipo 'nfseNacional', capturadoEm Timestamp
    // `specs` = [{ tipo, campo, desde }] com o campo/tipo de valor que a fonte
    // realmente grava.
    async function docsRecentes(specs) {
      try {
        let total = 0;
        for (const { tipo, campo, desde } of specs) {
          const snap = await db.collection('documentos_fiscais')
            .where('tipo', '==', tipo)
            .where(campo, '>=', desde)
            .count().get().catch(async () => {
              const s = await db.collection('documentos_fiscais')
                .where('tipo', '==', tipo)
                .where(campo, '>=', desde)
                .limit(1000).get();
              return { data: () => ({ count: s.size }) };
            });
          total += snap.data().count;
        }
        return total;
      } catch (e) {
        console.warn('[captura-diagnostico] docsRecentes falhou:', e.message);
        return null;
      }
    }

    // Top motivos de falha da última captura NFSe SP — trilho PORTAL CSV
    // (nfsesp_portal_cron_logs.errosResumo). 22/07: o card apontava pro WS
    // legado (erro 1102 em 121/121 — aposentado); o trilho real é o portal.
    // Fallback no log do legado enquanto o portal não tiver registro.
    async function topFalhasNfseSp(maxMotivos = 3) {
      const conta = (contagem, texto) => {
        const chave = String(texto || '').slice(0, 160);
        if (chave) contagem.set(chave, (contagem.get(chave) || 0) + 1);
      };
      try {
        const snap = await db.collection('nfsesp_portal_cron_logs')
          .orderBy('executadoEm', 'desc').limit(1).get();
        if (!snap.empty) {
          const d = snap.docs[0].data();
          const contagem = new Map();
          if (d.erroFatal) conta(contagem, `FATAL: ${d.erroFatal}`);
          if (d.headlessErroTipo) conta(contagem, `login headless: ${d.headlessErroTipo}`);
          for (const err of d.errosResumo || []) {
            conta(contagem, err.erroPrestador || err.erroTomador || err.motivo || err.status);
          }
          const top = [...contagem.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, maxMotivos)
            .map(([motivo, quantidade]) => ({ motivo, quantidade }));
          // Log do portal EXISTE → é a fonte da verdade. Se rodou sem falhas,
          // devolve null (sem quadro de motivos) — NÃO cai no log do legado,
          // que só tem o ruído 1102 do trilho aposentado (confundia o card:
          // portal 313/0 perfeito exibindo erro do serviço morto).
          return top.length ? { executadoEm: d.executadoEm || null, top } : null;
        }
        // Fallback: log do WS legado (só quando NUNCA houve run do portal).
        const legado = await db.collection('nfsesp_capturas_log')
          .orderBy('executadoEm', 'desc').limit(1).get();
        if (legado.empty) return null;
        const d = legado.docs[0].data();
        const contagem = new Map();
        for (const r of d.resultados || []) {
          if (r.sucesso) continue;
          for (const err of r.erros || []) {
            conta(contagem, `${err.codigo || '?'}: ${String(err.descricao || 'sem descrição').slice(0, 140)}`);
          }
        }
        const top = [...contagem.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, maxMotivos)
          .map(([motivo, quantidade]) => ({ motivo, quantidade }));
        return top.length ? { executadoEm: d.executadoEm || null, top } : null;
      } catch (e) {
        console.warn('[captura-diagnostico] topFalhasNfseSp:', e.message);
        return null;
      }
    }

    // Motivos agregados das falhas do último sync-cron NFe (errosResumo já é
    // gravado — top 50 por run — mas só aparecia na aba Erros & Logs; o card
    // dizia "23 falhas" mudo). Pula docs de outros tipos na mesma coleção
    // (auto-preencher-*, drenagem sem erros etc).
    async function topFalhasNfe(maxMotivos = 3) {
      try {
        const snap = await db.collection('sefaz_cron_logs')
          .orderBy('executadoEm', 'desc').limit(6).get();
        for (const docSnap of snap.docs) {
          const d = docSnap.data();
          if (!Array.isArray(d.errosResumo) || d.errosResumo.length === 0) continue;
          const contagem = new Map();
          for (const err of d.errosResumo) {
            const chave = `${err.codigo ? err.codigo + ' — ' : ''}${String(err.motivo || 'sem motivo').slice(0, 130)}`;
            contagem.set(chave, (contagem.get(chave) || 0) + 1);
          }
          const top = [...contagem.entries()]
            .sort((a, b) => b[1] - a[1]).slice(0, maxMotivos)
            .map(([motivo, quantidade]) => ({ motivo, quantidade }));
          if (top.length) return { executadoEm: d.executadoEm || null, top };
        }
        return null;
      } catch (e) {
        console.warn('[captura-diagnostico] topFalhasNfe:', e.message);
        return null;
      }
    }

    // Top motivos de falha do trilho NFSe Nacional ADN — o card mostrava só
    // "26 / 2" sem dizer QUEM falhou nem POR QUÊ (25/07, caso 4BZ). Agrega os
    // erros recentes de nfse_nacional_dfe_erros com o CNPJ junto do motivo.
    async function topFalhasNfseNacional(maxMotivos = 3) {
      try {
        const snap = await db.collection('nfse_nacional_dfe_erros')
          .orderBy('registradoEm', 'desc').limit(30).get();
        if (snap.empty) return null;
        const contagem = new Map();
        let maisRecenteMs = null;
        for (const docSnap of snap.docs) {
          const d = docSnap.data();
          const ts = d.registradoEm?.toMillis?.() ?? null;
          if (maisRecenteMs == null) maisRecenteMs = ts;
          // Janela: só erros das últimas 48h (erro velho não é "principal
          // motivo de falha" da rodada atual).
          if (ts != null && maisRecenteMs != null && (maisRecenteMs - ts) > 48 * 3600000) break;
          // E2220/NENHUM_DOCUMENTO deixou de ser erro no #302 (sucesso-vazio);
          // registros ANTIGOS dele não devem assustar o card até envelhecerem.
          if (/E2220|NENHUM_DOCUMENTO/i.test(String(d.motivo || ''))) continue;
          const chave = `${d.empresaCnpj ? d.empresaCnpj + ' — ' : ''}${String(d.motivo || 'sem motivo').slice(0, 140)}`;
          contagem.set(chave, (contagem.get(chave) || 0) + 1);
        }
        const top = [...contagem.entries()]
          .sort((a, b) => b[1] - a[1]).slice(0, maxMotivos)
          .map(([motivo, quantidade]) => ({ motivo, quantidade }));
        return top.length ? { executadoEmMs: maisRecenteMs, top } : null;
      } catch (e) {
        console.warn('[captura-diagnostico] topFalhasNfseNacional:', e.message);
        return null;
      }
    }

    // Saúde do trilho de SAÍDA mod 55 pelo cofre de e-mail (substitui a SIEG).
    // A saída não vem da SEFAZ (Rejeição 641 — nunca entrega ao emissor): vem do
    // cliente apontar o emissor pro cofre. O farol mede ADOÇÃO. Lê:
    //   - sefaz_xml_email_state/estado  → última leitura + ultimaSaidaPorEmpresa
    //   - cofre_email_runs (7d)         → saída/entrada importada na janela
    //   - simples/lucro                 → universo monitorado (denominador)
    async function estadoCofreSaida() {
      try {
        let atualizadoMs = null, ultimoResumo = null, entregando7d = 0, jaEntregaram = 0;
        try {
          const stSnap = await db.doc('sefaz_xml_email_state/estado').get();
          if (stSnap.exists) {
            const st = stSnap.data();
            atualizadoMs = st.atualizadoEm?.toMillis?.() ?? null;
            ultimoResumo = st.ultimoResumo ?? null;
            const mapa = st.ultimaSaidaPorEmpresa || {};
            jaEntregaram = Object.keys(mapa).length;
            for (const v of Object.values(mapa)) {
              const ms = v?.ms ?? null;
              if (ms && ms >= seteDias) entregando7d++;
            }
          }
        } catch { /* sem state ainda */ }

        let saida7d = 0, entrada7d = 0;
        try {
          const runsSnap = await db.collection('cofre_email_runs').where('ranAtMs', '>=', seteDias).get();
          runsSnap.forEach((d) => {
            const x = d.data();
            saida7d += Number(x.saida || 0);
            entrada7d += Number(x.entrada || 0);
          });
        } catch { /* sem histórico ainda */ }

        // Universo monitorado = empresas ativas com CNPJ (mesma base do matcher).
        let monitoradas = 0;
        const vistos = new Set();
        for (const col of ['simples_empresas', 'lucro_empresas']) {
          try {
            const snap = await db.collection(col).get();
            snap.forEach((doc) => {
              const d = doc.data();
              if (d._merged_into || d._deleted) return;
              const cnpj = String(d.cnpj || '').replace(/\D/g, '');
              if (cnpj.length !== 14 || vistos.has(cnpj)) return;
              vistos.add(cnpj);
              monitoradas++;
            });
          } catch { /* coleção indisponível */ }
        }

        return { atualizadoMs, ultimoResumo, entregando7d, jaEntregaram, saida7d, entrada7d, monitoradas };
      } catch (e) {
        return { erro: e.message };
      }
    }

    const [
      logSefaz, logNfseSp, logNfseNac,
      stateSefaz, stateNfseSp, stateNfseNac,
      docsNfe, docsNfseSp, docsNfseNac,
      falhasNfseSp, docsNfseNacTotal, falhasNfe,
      falhasNfseNac, cofreSaida,
    ] = await Promise.all([
      ultimoLog('sefaz_cron_logs'),
      // 22/07: trilho oficial NFSe SP = PORTAL CSV; o WS legado (1102) foi pausado.
      ultimoLog('nfsesp_portal_cron_logs'),
      ultimoLog('nfse_nacional_dfe_cron_logs'),
      elegiveisNfeReais(),
      elegiveisNfseSp(),
      elegiveisNfseNacional(),
      docsRecentes([
        { tipo: 'NFe', campo: 'createdAt', desde: new Date(seteDias) },
        { tipo: 'NFCe', campo: 'createdAt', desde: new Date(seteDias) },
        { tipo: 'CTe', campo: 'createdAt', desde: new Date(seteDias) },
        { tipo: 'MDFe', campo: 'createdAt', desde: new Date(seteDias) },
      ]),
      // NFSe SP tem DOIS importers com formatos de createdAt diferentes:
      //  - WS legado: string ISO (compara com string)
      //  - portal CSV: serverTimestamp (compara com Date)
      // Firestore não cruza tipos — contar só um formato zerava o painel
      // (22/07: 4445 docs do portal contavam como "0 em 7d"). Soma os dois;
      // cada doc tem UM tipo de campo, então não há dupla contagem.
      docsRecentes([
        { tipo: 'NFSe', campo: 'createdAt', desde: new Date(seteDias).toISOString() },
        { tipo: 'NFSe', campo: 'createdAt', desde: new Date(seteDias) },
      ]),
      docsRecentes([
        { tipo: 'nfseNacional', campo: 'capturadoEm', desde: new Date(seteDias) },
      ]),
      topFalhasNfseSp(),
      // Total HISTÓRICO de docs Nacional — separa "nunca capturou nada"
      // (elegibilidade errada: municípios não aderentes ao ADN, ex. SP capital
      // usa o portal próprio) de "capturava e parou" (quebra real de cursor/cert).
      (async () => {
        try {
          const snap = await db.collection('documentos_fiscais')
            .where('tipo', '==', 'nfseNacional').count().get();
          return snap.data().count;
        } catch (e) { return null; }
      })(),
      topFalhasNfe(),
      topFalhasNfseNacional(),
      estadoCofreSaida(),
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
          topFalhas: falhasNfe,
        },
        nfseSp: {
          fonte: 'NFSe SP — Portal CSV (tomados + prestados)',
          endpointCron: '/api/admin/sefaz/nfsesp-portal-cron',
          schedulerEsperado: 'nfsesp-portal-cron-noturno (03:30 BRT seg-sex)',
          ultimoCron: logNfseSp,
          state: stateNfseSp,
          docsUltimos7d: docsNfseSp,
          topFalhas: falhasNfseSp,
        },
        nfseNacional: {
          fonte: 'NFSe Nacional ADN (DFe)',
          endpointCron: '/api/admin/nfse-nacional-dfe/sync-cron',
          schedulerEsperado: 'nfse-nacional-dfe-cron-noturno (04:00 BRT seg-sex)',
          ultimoCron: logNfseNac,
          state: stateNfseNac,
          docsUltimos7d: docsNfseNac,
          docsTotalHistorico: docsNfseNacTotal,
          topFalhas: falhasNfseNac,
          // Sinal do provedor pro farol honesto: false = ADN confirma que não há
          // documento (0 capturado é correto, não crítico); true = há doc e não
          // capturamos (bug); null = desconhecido (mantém rede de segurança).
          movimentoDisponivel: stateNfseNac?.movimentoDisponivel ?? null,
        },
        // 4º trilho: SAÍDA mod 55 pelo cofre de e-mail. A SEFAZ nunca entrega a
        // saída ao emissor (Rejeição 641); ela chega quando o cliente aponta o
        // emissor pro cofre. Farol mede ADOÇÃO (avaliarSaudeCofreSaida no front).
        saidaCofre: {
          fonte: 'Saída mod 55 — Cofre de e-mail (substitui a SIEG)',
          endpointCron: '/api/admin/sefaz/xml-email-ingest-cron',
          schedulerEsperado: 'xml-email-ingest-cron (a cada 30min, 7-21h seg-sáb)',
          ultimoCron: cofreSaida?.erro ? { erro: cofreSaida.erro } : {
            executadoEmMs: cofreSaida?.atualizadoMs ?? null,
            // "sucessos" do cofre = docs importados na última leitura; "falhas" =
            // erros de importação. totalNovos = saída nova (o foco deste card).
            sucessos: cofreSaida?.ultimoResumo
              ? (Number(cofreSaida.ultimoResumo.saida || 0) + Number(cofreSaida.ultimoResumo.entrada || 0))
              : null,
            falhas: cofreSaida?.ultimoResumo?.erros ?? null,
            totalNovos: cofreSaida?.ultimoResumo?.saida ?? null,
            status: null,
            fonte: 'cofre-email',
          },
          state: {
            total: cofreSaida?.monitoradas ?? null,
            travadas: null,
          },
          // headline do card = SAÍDA importada em 7d (é o que o Paulo pergunta).
          docsUltimos7d: cofreSaida?.saida7d ?? null,
          // Sinais de adoção (o farol do cofre usa estes três):
          entregando7d: cofreSaida?.entregando7d ?? null,
          jaEntregaram: cofreSaida?.jaEntregaram ?? null,
          monitoradasCofre: cofreSaida?.monitoradas ?? null,
          entrada7dCofre: cofreSaida?.entrada7d ?? null,
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
