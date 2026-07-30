// ============================================================================
// sefaz-backend/cron-retomada.js  (ESM)
//
// Retomada AUTOMÁTICA de crons interrompidos por deploy/reinício.
//
// Problema: quando o Cloud Run recicla a instância no meio de uma varredura
// (deploy, scale-down), o run é marcado 'interrompido' (SIGTERM em
// cron-heartbeat / auto-cura em cron-health) — mas a RETOMADA era manual: o
// painel dizia "clique 'Forçar captura agora' ou aguarde o próximo horário do
// cron" (caso NFS-e SP: varredura de 4h perdida até alguém clicar).
//
// Solução: no BOOT do servidor novo (que é exatamente quem matou o run — o
// deploy troca a instância), esperar o servidor estabilizar e re-disparar os
// crons cujo último estado é 'interrompido' recente. O re-disparo é um POST
// no próprio servidor (localhost) com o x-cron-secret — reusa 100% do fluxo
// (heartbeat, logs, dedup de importação).
//
// Corrida entre instâncias (Cloud Run pode subir 2+): a "reivindicação" do
// log interrompido é uma transação que só grava se o status AINDA for
// 'interrompido' — quem perde a corrida não re-dispara.
// ============================================================================

import admin from 'firebase-admin';

function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

// Crons com heartbeat 'iniciado'→'interrompido' que fazem sentido retomar.
// body: enviado no POST (manifest-cron exige dryRun:false explícito — o
// default do endpoint é dry-run por segurança).
export const CRONS_RETOMAVEIS = [
  { collection: 'sefaz_cron_logs',         path: '/api/admin/sefaz/sync-cron',           body: {},                label: 'Captura NF-e (DistDFe)' },
  { collection: 'nfsesp_portal_cron_logs', path: '/api/admin/sefaz/nfsesp-portal-cron',  body: {},                label: 'NFS-e SP (portal CSV)' },
  { collection: 'manifestacoes_cron_logs', path: '/api/admin/sefaz/manifest-cron',       body: { dryRun: false }, label: 'Manifestações (ciência)' },
];

// Só retoma interrupção RECENTE. Mais velho que isso, o próprio cron agendado
// já rodou (todos rodam pelo menos 1x/dia) — re-disparar seria redundante.
export const RETOMADA_MAX_IDADE_MS = 6 * 60 * 60 * 1000; // 6h

// Espera pós-boot antes de retomar: deixa o servidor estabilizar (Firestore,
// certs) e não compete com o health-check do deploy.
const DELAY_POS_BOOT_MS = 2 * 60 * 1000; // 2 min

/**
 * PURA (testável): dentre docs de log, escolhe os que devem ser retomados.
 * Critério: status='interrompido', interrompido há <= maxIdadeMs, e ainda
 * sem marca de retomada.
 */
export function selecionarInterrompidosParaRetomar(docs, agoraMs = Date.now(), maxIdadeMs = RETOMADA_MAX_IDADE_MS) {
  return (docs || []).filter((d) => {
    if (!d || d.status !== 'interrompido') return false;
    if (d.retomadoEm) return false;
    const ms = d.interrompidoEm ? Date.parse(d.interrompidoEm) : NaN;
    if (!Number.isFinite(ms)) return false;
    const idade = agoraMs - ms;
    return idade >= 0 && idade <= maxIdadeMs;
  });
}

// Reivindica o doc numa transação: só ganha quem encontrar status ainda
// 'interrompido'. O vencedor marca status='retomado' (sai do radar de novas
// retomadas e do aviso âmbar do painel; o run novo cria log próprio).
async function reivindicarRetomada(docRef) {
  const db = fa().firestore();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return false;
    const d = snap.data();
    if (d.status !== 'interrompido' || d.retomadoEm) return false;
    tx.update(docRef, {
      status: 'retomado',
      retomadoEm: new Date().toISOString(),
      retomadoPor: 'boot-retomada-automatica',
      // Preserva o motivo original pra auditoria do que aconteceu.
      motivoInterrupcao: d.motivoInterrupcao || null,
    });
    return true;
  });
}

/**
 * Varre as coleções retomáveis e re-dispara (via POST localhost) cada cron
 * cujo run mais recente foi interrompido há pouco. Retorna resumo p/ log.
 */
export async function retomarCronsInterrompidos({ port }) {
  const secret = process.env.SEFAZ_CRON_SECRET;
  if (!secret) {
    console.warn('[cron-retomada] SEFAZ_CRON_SECRET ausente — retomada automática desativada');
    return { ok: false, motivo: 'sem SEFAZ_CRON_SECRET' };
  }
  const db = fa().firestore();
  const resumo = [];
  for (const reg of CRONS_RETOMAVEIS) {
    try {
      // Busca por status (índice single-field). Idade/dedup filtrados em
      // memória; docs reivindicados mudam de status e saem da query pra sempre.
      const snap = await db.collection(reg.collection)
        .where('status', '==', 'interrompido')
        .limit(30)
        .get();
      const docs = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
      const candidatos = selecionarInterrompidosParaRetomar(docs);
      if (candidatos.length === 0) {
        resumo.push({ collection: reg.collection, retomado: false, motivo: 'nada interrompido recente' });
        continue;
      }
      // Reivindica TODOS os candidatos (evita nova retomada dos mesmos docs em
      // outro boot), mas dispara o cron UMA vez só por coleção.
      let ganhouAlgum = false;
      for (const c of candidatos) {
        try {
          const ganhou = await reivindicarRetomada(c.ref);
          ganhouAlgum = ganhouAlgum || ganhou;
        } catch (e) {
          console.warn(`[cron-retomada] falha reivindicando ${reg.collection}/${c.id}:`, e.message);
        }
      }
      if (!ganhouAlgum) {
        resumo.push({ collection: reg.collection, retomado: false, motivo: 'outra instância reivindicou' });
        continue;
      }
      const url = `http://127.0.0.1:${port}${reg.path}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'x-cron-secret': secret, 'Content-Type': 'application/json' },
        body: JSON.stringify(reg.body || {}),
      });
      console.log(`[cron-retomada] ${reg.label}: interrompido há pouco → re-disparado (HTTP ${resp.status})`);
      resumo.push({ collection: reg.collection, retomado: true, httpStatus: resp.status });
    } catch (e) {
      console.warn(`[cron-retomada] erro em ${reg.collection}:`, e.message);
      resumo.push({ collection: reg.collection, retomado: false, motivo: e.message });
    }
  }
  return { ok: true, resumo };
}

/**
 * Hook de boot: agenda a retomada pra DELAY_POS_BOOT_MS depois do listen.
 * Fire-and-forget — falha aqui nunca derruba o servidor.
 */
export function agendarRetomadaAposBoot({ port, delayMs = DELAY_POS_BOOT_MS } = {}) {
  const t = setTimeout(async () => {
    try {
      const r = await retomarCronsInterrompidos({ port });
      const retomados = (r.resumo || []).filter((x) => x.retomado).map((x) => x.collection);
      if (retomados.length > 0) {
        console.log(`[cron-retomada] boot: ${retomados.length} cron(s) retomado(s): ${retomados.join(', ')}`);
      }
    } catch (e) {
      console.warn('[cron-retomada] retomada pós-boot falhou:', e.message);
    }
  }, delayMs);
  // Não segura o processo vivo só por causa do timer.
  if (typeof t.unref === 'function') t.unref();
  return t;
}
