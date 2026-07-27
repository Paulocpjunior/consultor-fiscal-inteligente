// ============================================================================
// cron-heartbeat.js
//
// Pattern de heartbeat pra cron jobs fire-and-forget (necessario quando o
// trabalho passa do timeout HTTP do Cloud Scheduler / 30s).
//
// Problema que resolve: o handler responde 200 imediato pra Scheduler nao
// cancelar/retentar, e processa em setImmediate(). Mas se o Cloud Run matar
// o container no meio (cold scale-down, OOM, deploy), o setImmediate e
// abortado SEM TRACO. Resultado: cron silenciosamente parado, ninguem percebe
// (vide incidente 01/06/2026 mencionado em sync-routes.js).
//
// Solucao: gravar um log com status='iniciado' ANTES de responder. Atualizar
// pra status='sucesso' ou 'falha' no fim. Se ficar orfao em 'iniciado' por
// muito tempo, e prova direta de que o container morreu no meio.
//
// Uso:
//   await withCronHeartbeat({
//     collection: 'sefaz_cron_logs',
//     fonte: req.headers?.['x-cloudscheduler-jobname'] || 'sefaz-cron-noturno',
//     res,                              // express response — sera respondido aqui
//     respostaImediata: { ok: true },   // opcional, payload extra na resposta
//   }, async (logRef) => {
//     // trabalho pesado — pode demorar muito
//     return {
//       totalEmpresas: 60,
//       sucessos: 58,
//       falhas: 2,
//       // ... qualquer campo que se queira persistir no log final
//     };
//   });
//
// O setImmediate, o try/catch, a resposta imediata e o update do log ficam
// todos encapsulados aqui.
// ============================================================================

import admin from 'firebase-admin';

function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

// Firestore handle (real ou injetado em testes). O segundo argumento
// `firestoreOverride` em opts permite passar um stub no teste, sem precisar
// mockar firebase-admin inteiro.
function getDb(opts) {
  if (opts && opts.firestoreOverride) return opts.firestoreOverride;
  return fa().firestore();
}

// FieldValue.serverTimestamp e o mesmo no real e no override (admin SDK).
// Em teste passamos um stub que aceita o sentinela.
function getServerTs(opts) {
  if (opts && opts.serverTimestampOverride) return opts.serverTimestampOverride();
  return fa().firestore.FieldValue.serverTimestamp();
}

// ── Runs em andamento + desligamento gracioso ───────────────────────────────
// Cloud Run manda SIGTERM antes de matar a instancia (deploy, scale-down). O
// setImmediate em curso morre junto e o log fica em 'iniciado' PRA SEMPRE — o
// painel mostrava "TRAVADO ha 9h" com nada travado (caso NFS-e SP 27/07).
// Aqui marcamos os runs vivos como 'interrompido' NA HORA, com motivo honesto.
// (A rede de seguranca pra quando nem isso da tempo e a auto-cura por idade em
// cron-health.decidirCuraOrfao.)
const RUNS_EM_ANDAMENTO = new Map(); // logRef → { collection, fonte }
let desligamentoArmado = false;

/** Registra um log 'iniciado' vivo, pra ser marcado se o servidor cair. */
export function registrarRunEmAndamento(logRef, meta = {}) {
  if (!logRef || typeof logRef.update !== 'function') return;
  RUNS_EM_ANDAMENTO.set(logRef, meta);
  armarDesligamentoGracioso();
}

/** Run terminou (sucesso ou falha) — sai da lista de "vivos". */
export function concluirRunEmAndamento(logRef) {
  if (logRef) RUNS_EM_ANDAMENTO.delete(logRef);
}

/** Marca todos os runs vivos como 'interrompido'. Exportada pra teste. */
export async function marcarRunsInterrompidos(sinal = 'SIGTERM') {
  const pendentes = [...RUNS_EM_ANDAMENTO.entries()];
  RUNS_EM_ANDAMENTO.clear();
  if (pendentes.length === 0) return 0;
  const motivoInterrupcao = `Execucao interrompida pelo servidor (${sinal} — deploy ou reciclagem da instancia). Nada foi capturado nesta rodada: rode a captura de novo ou aguarde o proximo horario do cron.`;
  await Promise.allSettled(pendentes.map(([ref]) => ref.update({
    status: 'interrompido',
    interrompidoEm: new Date().toISOString(),
    motivoInterrupcao,
  })));
  return pendentes.length;
}

function armarDesligamentoGracioso() {
  if (desligamentoArmado) return;
  desligamentoArmado = true;
  process.on('SIGTERM', async () => {
    // Janela de graca do Cloud Run e curta (~10s): tenta marcar e sai.
    const timeout = new Promise((r) => setTimeout(() => r('timeout'), 8000));
    try {
      const n = await Promise.race([marcarRunsInterrompidos('SIGTERM'), timeout]);
      if (n && n !== 'timeout') console.warn(`[cron-heartbeat] SIGTERM: ${n} run(s) marcados como interrompidos`);
    } catch (e) {
      console.warn('[cron-heartbeat] SIGTERM: falha marcando runs:', e.message);
    }
    process.exit(0);
  });
}

/**
 * @param {object} opts
 * @param {string} opts.collection - nome da colecao Firestore p/ logar (ex 'sefaz_cron_logs').
 * @param {string} opts.fonte - identificador da fonte (ex job name do Scheduler, ou 'admin-manual').
 * @param {import('express').Response} opts.res - express response.
 * @param {object} [opts.respostaImediata] - merge no payload da resposta 200.
 * @param {object} [opts.metadados] - campos extras gravados no log inicial.
 * @param {(logRef: FirebaseFirestore.DocumentReference) => Promise<object>} work - funcao que faz
 *   o trabalho. Pode receber o logRef pra anexar updates incrementais. Deve retornar um objeto
 *   com os campos finais (sucessos, falhas, etc) — sera merged no log com status='sucesso'.
 */
export async function withCronHeartbeat(opts, work) {
  const { collection, fonte, res, respostaImediata = {}, metadados = {} } = opts;
  const inicioMs = Date.now();
  const iniciadoEm = new Date().toISOString();

  // 1) Heartbeat: cria log 'iniciado' ANTES de responder. Se isso falhar,
  //    Scheduler recebe 500 e pode tentar de novo — preferivel a fingir sucesso.
  let logRef;
  try {
    logRef = await getDb(opts).collection(collection).add({
      executadoEm: getServerTs(opts),
      iniciadoEm,
      status: 'iniciado',
      fonte,
      ...metadados,
    });
  } catch (e) {
    console.error(`[cron-heartbeat] falha gravando log inicial em ${collection}:`, e.message);
    res.status(500).json({ ok: false, motivo: 'Falha registrando inicio do cron' });
    return;
  }
  registrarRunEmAndamento(logRef, { collection, fonte });

  // 2) Responde 200 imediato. Scheduler nao retentara mesmo se o trabalho
  //    pesado demorar minutos. O logId vai junto pra debug.
  res.json({
    ok: true,
    motivo: 'Cron iniciado em background',
    logId: logRef.id,
    startedAt: iniciadoEm,
    ...respostaImediata,
  });

  // 3) Trabalho pesado. Resultado (ou erro) atualiza o mesmo log.
  setImmediate(async () => {
    try {
      const result = (await work(logRef)) || {};
      const duracaoMs = Date.now() - inicioMs;
      concluirRunEmAndamento(logRef);
      try {
        await logRef.update({
          status: 'sucesso',
          duracaoMs,
          finalizadoEm: getServerTs(opts),
          ...result,
        });
      } catch (errUpdate) {
        console.error(`[cron-heartbeat] falha atualizando log de sucesso ${logRef.id}:`, errUpdate.message);
      }
    } catch (e) {
      console.error(`[cron-heartbeat] erro fatal no cron (fonte=${fonte}, logId=${logRef.id}):`, e);
      const duracaoMs = Date.now() - inicioMs;
      concluirRunEmAndamento(logRef);
      try {
        await logRef.update({
          status: 'falha',
          erro: String(e.message || e).slice(0, 1000),
          duracaoMs,
          finalizadoEm: getServerTs(opts),
        });
      } catch (errLog) {
        // Duplo silenciamento aqui apagaria rastro do erro fatal — logamos.
        console.error(`[cron-heartbeat] FALHA tambem registrando o erro em ${collection}:`, errLog.message);
      }
    }
  });
}

/**
 * Detecta logs em status='iniciado' mais antigos que `staleMinutes`. Sao
 * provas de cron morto no meio (container reciclado, OOM, etc).
 *
 * @param {string} collection
 * @param {number} staleMinutes - default 120 (2h — folga generosa pro cron NFe
 *   que varre 60+ empresas com sleeps).
 * @returns {Promise<Array<{id: string, fonte: string, iniciadoEm: string, idadeMinutos: number}>>}
 */
export async function listarCronsOrfaos(collection, staleMinutes = 120, opts = {}) {
  const limiteMs = Date.now() - staleMinutes * 60_000;
  const limiteIso = new Date(limiteMs).toISOString();
  const snap = await getDb(opts)
    .collection(collection)
    .where('status', '==', 'iniciado')
    .where('iniciadoEm', '<', limiteIso)
    .limit(50)
    .get();
  return snap.docs.map(d => {
    const data = d.data();
    const iniciadoMs = data.iniciadoEm ? new Date(data.iniciadoEm).getTime() : 0;
    return {
      id: d.id,
      fonte: data.fonte || '(desconhecida)',
      iniciadoEm: data.iniciadoEm || null,
      idadeMinutos: iniciadoMs ? Math.round((Date.now() - iniciadoMs) / 60_000) : null,
    };
  });
}
