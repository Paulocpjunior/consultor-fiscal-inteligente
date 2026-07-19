// ============================================================================
// sefaz-backend/sefaz-sp-nfce-cron.js  (ESM)
// ----------------------------------------------------------------------------
// Cron da captura de SAIDA de NFC-e (mod 65) via SAE-NFC-e (SEFAZ-SP), com o
// A1 de CADA empresa do cofre — a "frente 2" (atuar como o proprio cliente).
//
// Comportamento:
//  - percorre todas as empresas com A1 valido no cofre (tipoCert A1 +
//    storagePath + senha), da mais "atrasada" pra mais recente;
//  - janela incremental por empresa: do ultimo ponto capturado (com 24h de
//    sobreposicao por seguranca) ate agora; primeira vez = ultimos 7 dias
//    (backfill historico e pelo botao manual, que drena 100 dias por vez);
//  - orcamento de tempo GLOBAL (o que nao couber fica pro proximo disparo —
//    a ordenacao por "mais atrasada primeiro" garante rodizio justo);
//  - estado por empresa em sae_nfce_state/{cnpj14}: cursor, contadores e
//    ultimo erro (alimenta o painel Status por Empresa depois).
//
// Empresas fora de SP / sem NFC-e: a listagem volta vazia (cStat 107) ou com
// erro — custo de 1 chamada SOAP por dia, registrado no estado e seguimos.
//
// Auth: x-cron-secret (mesmo padrao dos demais crons / Cloud Scheduler).
//   POST /api/admin/sefaz/sae-nfce-cron
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { listCertsEmpresas } from './cert-storage.js';
import { capturarNFCeSaida } from './sefaz-sp-nfce-orchestrator.js';
import { secretsMatch } from './cron-secret.js';

const router = express.Router();

const DIA_MS = 86_400_000;
const ORCAMENTO_GLOBAL_MS = 8 * 60_000;  // < attempt-deadline (900s) do Scheduler
const ORCAMENTO_EMPRESA_MS = 90_000;     // teto por empresa por disparo
const SOBREPOSICAO_MS = 24 * 3600_000;   // re-cobre 24h pra nao perder nota atrasada
const JANELA_PRIMEIRA_MS = 7 * DIA_MS;   // primeira captura: ultimos 7 dias
const PAUSA_ENTRE_EMPRESAS_MS = 1_000;   // respiro entre CNPJs (gentileza com a SEFAZ)

function getDb() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin.firestore();
}

function requireCronAuth(req, res, next) {
  const secret = process.env.SEFAZ_CRON_SECRET;
  if (!secret) {
    console.error('[sae-nfce-cron] SEFAZ_CRON_SECRET não configurado');
    return res.status(500).json({ error: 'Cron secret not configured' });
  }
  const headerSecret = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'];
  if (secretsMatch(headerSecret, secret)) return next();
  const headerPrefix = headerSecret ? String(headerSecret).slice(0, 4) + '...' : '(ausente)';
  const jobName = req.headers['x-cloudscheduler-jobname'] || '(no header)';
  console.warn(`[sae-nfce-cron] 403 mismatch — header=${headerPrefix} job=${jobName} ip=${req.ip}`);
  return res.status(403).json({ error: 'Cron auth failed' });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "AAAA-MM-DDThh:mm" (cursor do SAE) -> ms. Interpreta como horario local do
// servidor — mesma base usada pelo orchestrator ao formatar (fmt usa getHours).
function cursorToMs(cursor) {
  const t = Date.parse(String(cursor));
  return Number.isNaN(t) ? null : t;
}

router.post('/sae-nfce-cron', requireCronAuth, async (req, res) => {
  const t0 = Date.now();
  const db = getDb();
  const resposta = {
    ok: true,
    empresasElegiveis: 0, processadas: 0, puladasSemTempo: 0, desativadas: 0,
    totais: { chavesEncontradas: 0, importadas: 0, jaCompletas: 0, duplicadas: 0, erros: 0 },
    detalhes: [],
  };

  try {
    // 1. Empresas com A1 utilizavel no cofre (A3 nao roda no servidor).
    const certs = (await listCertsEmpresas()).filter((c) =>
      (c.tipoCert || 'A1') === 'A1' && c.hasStoragePath && c.hasPasswordEnc &&
      String(c.cnpj || '').replace(/\D/g, '').length === 14
    );
    // Dedup por CNPJ (mais de um upload da mesma empresa).
    const porCnpj = new Map();
    for (const c of certs) {
      const cnpj = String(c.cnpj).replace(/\D/g, '');
      if (!porCnpj.has(cnpj)) porCnpj.set(cnpj, c);
    }
    resposta.empresasElegiveis = porCnpj.size;

    // 2. Estado por CNPJ (cursor + ordenacao "mais atrasada primeiro").
    const fila = [];
    for (const [cnpj, cert] of porCnpj) {
      let st = {};
      try {
        const snap = await db.collection('sae_nfce_state').doc(cnpj).get();
        st = snap.exists ? (snap.data() || {}) : {};
      } catch { /* estado indisponivel -> trata como nunca rodou */ }
      if (st.desativado === true) { resposta.desativadas++; continue; }
      fila.push({ cnpj, empresaId: cert.empresaId, lastRunMs: st.lastRunMs || 0, cursorMs: st.cursorMs || null });
    }
    fila.sort((a, b) => a.lastRunMs - b.lastRunMs);

    // 3. Processa dentro do orcamento global.
    for (const emp of fila) {
      const restante = ORCAMENTO_GLOBAL_MS - (Date.now() - t0);
      if (restante < 15_000) { resposta.puladasSemTempo = fila.length - resposta.processadas - resposta.desativadas; break; }

      const agora = Date.now();
      const iniMs = emp.cursorMs ? (emp.cursorMs - SOBREPOSICAO_MS) : (agora - JANELA_PRIMEIRA_MS);
      const stateRef = db.collection('sae_nfce_state').doc(emp.cnpj);

      let r;
      try {
        r = await capturarNFCeSaida({
          empresaId: emp.empresaId,
          dataInicial: new Date(iniMs).toISOString(),
          dataFinal: null,                     // ate agora
          tpAmb: 1,
          capturadoPor: { uid: 'cron', email: 'sae-nfce-cron' },
          maxDuracaoMs: Math.min(ORCAMENTO_EMPRESA_MS, restante - 10_000),
        });
      } catch (e) {
        r = { ok: false, error: e.message };
      }
      resposta.processadas++;

      // 4. Atualiza estado. Cursor: se parcial, retoma do ponto informado; se
      // completo, o "agora" do inicio da rodada vira o novo marco.
      const novoCursorMs = r?.parcial && r?.retomarDataInicial
        ? (cursorToMs(r.retomarDataInicial) || agora)
        : (r?.ok ? agora : (emp.cursorMs || null));
      const stUpdate = {
        lastRunMs: agora,
        cursorMs: novoCursorMs,
        ultimoOk: !!r?.ok,
        ultimoErro: r?.ok ? null : String(r?.error || 'erro desconhecido').slice(0, 300),
        ultimoResumo: r?.ok ? {
          chavesEncontradas: r.chavesEncontradas || 0, importadas: r.importadas || 0,
          jaCompletas: r.jaCompletas || 0, duplicadas: r.duplicadas || 0,
          erros: r.erros || 0, parcial: !!r.parcial,
        } : null,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      };
      try { await stateRef.set(stUpdate, { merge: true }); }
      catch (e) { console.warn(`[sae-nfce-cron] estado ${emp.cnpj}:`, e.message); }

      if (r?.ok) {
        resposta.totais.chavesEncontradas += r.chavesEncontradas || 0;
        resposta.totais.importadas += r.importadas || 0;
        resposta.totais.jaCompletas += r.jaCompletas || 0;
        resposta.totais.duplicadas += r.duplicadas || 0;
        resposta.totais.erros += r.erros || 0;
      } else {
        resposta.totais.erros++;
      }
      if (resposta.detalhes.length < 40) {
        resposta.detalhes.push({
          cnpj: emp.cnpj,
          ok: !!r?.ok,
          importadas: r?.importadas || 0,
          parcial: !!r?.parcial,
          erro: r?.ok ? undefined : (r?.error || null),
        });
      }
      await sleep(PAUSA_ENTRE_EMPRESAS_MS);
    }

    resposta.duracaoMs = Date.now() - t0;
    console.log(`[sae-nfce-cron] ${resposta.processadas}/${resposta.empresasElegiveis} empresas, ` +
      `${resposta.totais.importadas} importadas, ${resposta.totais.erros} erros, ${resposta.duracaoMs}ms`);
    return res.json(resposta);
  } catch (e) {
    console.error('[sae-nfce-cron] erro:', e);
    return res.status(500).json({ error: e.message, duracaoMs: Date.now() - t0 });
  }
});

export default router;
