// ============================================================================
// sefaz-backend/cert-alerta-cron.js  (ESM)
// ----------------------------------------------------------------------------
// Cron de ALERTA DE VENCIMENTO DE CERTIFICADO DIGITAL.
//
// Gap que fecha: existia GET /cert/status (sob demanda do admin) e cálculo de
// diasRestantes, mas NENHUM job proativo avisava que um certificado estava
// vencendo. O cert do escritório (S&P) é usado por 54+ empresas via fallback —
// se ele expira, a captura para pra todo mundo (cStat 280). Este cron roda
// diariamente e dispara email quando um cert entra em faixa de vencimento.
//
// Cobre:
//   1. Cert do ESCRITÓRIO  — sefaz_certificados/atual (validade.fim)
//   2. Certs POR EMPRESA   — empresas_certificados/{id} (notAfter)
//
// Anti-spam: alerta UMA vez por FAIXA (30/15/7/3/1/expirado). Guarda a última
// faixa avisada em `alertaVencimento.bucket` no próprio doc do cert; só
// reenvia quando a faixa MUDA (escalada 30→15→7…). Renovou (dias>30) → reseta.
//
// Auth: x-cron-secret (mesmo padrão dos demais crons). Canal: email via Graph.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { enviarEmail, isGraphConfigured } from './graph-provider.js';
import { listCertsEmpresas } from './cert-storage.js';
import { parseDestinatarios } from './email-destinatarios-helper.js';

const router = express.Router();

const REMETENTE = process.env.GRAPH_REMETENTE || 'junior@spassessoriacontabil.com.br';
// Destinatário(s) do alerta — aceita lista com vírgula (default = caixa do remetente).
const ALERTA_PARA = parseDestinatarios(process.env.CERT_ALERT_TO, REMETENTE);
const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');

function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

function requireCronAuth(req, res, next) {
  const secret = process.env.SEFAZ_CRON_SECRET;
  if (!secret) {
    console.error('[cert-alerta-cron] SEFAZ_CRON_SECRET não configurado');
    return res.status(500).json({ error: 'Cron secret not configured' });
  }
  const headerSecret = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'];
  if (headerSecret === secret) return next();
  const headerPrefix = headerSecret ? String(headerSecret).slice(0, 4) + '...' : '(ausente)';
  const jobName = req.headers['x-cloudscheduler-jobname'] || '(no header)';
  console.warn(`[cert-alerta-cron] 403 mismatch — header=${headerPrefix} job=${jobName} ip=${req.ip}`);
  return res.status(403).json({ error: 'Cron auth failed' });
}

// dias restantes (floor) a partir de uma data ISO/Date.
function diasAte(fimIso) {
  if (!fimIso) return null;
  const fim = new Date(fimIso);
  if (Number.isNaN(fim.getTime())) return null;
  return Math.floor((fim.getTime() - Date.now()) / 86_400_000);
}

// Logica de faixa testada em cert-vencimento-helper.js (24 testes).
// Mantido o "emoji" aqui porque so o email usa.
import { faixaDeVencimento, urgenciaFaixa } from './cert-vencimento-helper.js';

const faixaDe = faixaDeVencimento;

function urgencia(faixa) {
  const u = urgenciaFaixa(faixa);
  // adiciona emoji especifico do email
  const emoji = u.severidade === 'critica' ? '🔴' : u.severidade === 'alta' ? '🟠' : '🟡';
  return { ...u, emoji };
}

function corpoEmail({ escopo, titular, cnpj, fimIso, dias, faixa, afetaTodas }) {
  const u = urgencia(faixa);
  const fimBR = fimIso ? new Date(fimIso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
  const linhaPrazo = faixa === 'expirado'
    ? `<b style="color:${u.cor}">EXPIROU em ${fimBR}</b> (${Math.abs(dias)} dia(s) atrás)`
    : `vence em <b style="color:${u.cor}">${dias} dia(s)</b> — ${fimBR}`;
  const instrucoes = escopo === 'escritorio'
    ? `<p>Renove o certificado A1 e suba o novo <code>.pfx</code> no <b>Secret Manager</b>
         (<code>sefaz-cert-a1</code> / <code>sefaz-cert-password</code>) ou pela tela
         <b>Certificado do Escritório</b>.</p>
       ${afetaTodas ? `<p style="color:${u.cor}"><b>⚠ Este é o certificado do escritório — a captura automática
         de TODAS as empresas que usam o cert do escritório para enquanto ele estiver vencido.</b></p>` : ''}`
    : `<p>Renove o A1 desta empresa e suba o novo <code>.pfx</code> em
         <b>Empresas Monitoradas → coluna Certificado</b>.</p>`;
  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;max-width:560px">
      <h2 style="color:${u.cor};margin-bottom:4px">${u.emoji} Certificado ${u.label}</h2>
      <p style="margin-top:0;color:#475569">${escopo === 'escritorio' ? 'Certificado do escritório' : 'Certificado de empresa'}</p>
      <table style="border-collapse:collapse;margin:12px 0">
        <tr><td style="padding:2px 8px;color:#64748b">Titular</td><td style="padding:2px 8px"><b>${titular || '—'}</b></td></tr>
        <tr><td style="padding:2px 8px;color:#64748b">CNPJ</td><td style="padding:2px 8px">${cnpj || '—'}</td></tr>
        <tr><td style="padding:2px 8px;color:#64748b">Validade</td><td style="padding:2px 8px">${linhaPrazo}</td></tr>
      </table>
      ${instrucoes}
      <p style="color:#94a3b8;font-size:12px;margin-top:16px">
        Alerta automático — Consultor Fiscal Inteligente. Você recebe este aviso uma vez por faixa
        (30/15/7/3/1 dias e expirado).
      </p>
    </div>`;
}

/**
 * Processa um cert: compara faixa atual com a última avisada (gravada no doc).
 * Envia email só na MUDANÇA de faixa. Retorna o resumo do que aconteceu.
 */
async function processarCert({ ref, escopo, titular, cnpj, fimIso, faixaAnterior, afetaTodas, graphOk }) {
  const dias = diasAte(fimIso);
  const faixa = faixaDe(dias);

  if (faixa === (faixaAnterior ?? null)) {
    return { escopo, cnpj, titular, dias, faixa, acao: 'sem-mudanca' };
  }

  let emailStatus = 'nao-enviado';
  if (faixa) {
    if (!graphOk) {
      emailStatus = 'graph-nao-configurado';
    } else {
      const assuntoPrazo = faixa === 'expirado' ? 'EXPIRADO' : `vence em ${dias} dia(s)`;
      const r = await enviarEmail({
        remetente: REMETENTE,
        para: ALERTA_PARA,
        assunto: `${urgencia(faixa).emoji} Certificado ${assuntoPrazo} — ${titular || cnpj || escopo}`,
        corpoHtml: corpoEmail({ escopo, titular, cnpj, fimIso, dias, faixa, afetaTodas }),
      });
      emailStatus = r.ok ? 'enviado' : `falha: ${r.error || 'desconhecida'}`;
    }
  }

  // Persiste a nova faixa (inclui reset pra null quando renovou).
  try {
    await ref.set({
      alertaVencimento: {
        bucket: faixa,
        diasRestantes: dias,
        avaliadoEm: new Date().toISOString(),
        emailStatus: faixa ? emailStatus : 'reset-renovado',
      },
    }, { merge: true });
  } catch (e) {
    console.warn(`[cert-alerta-cron] falha gravando alertaVencimento (${escopo}/${cnpj}):`, e.message);
  }

  return { escopo, cnpj, titular, dias, faixa, faixaAnterior: faixaAnterior ?? null, acao: faixa ? 'alertado' : 'reset', emailStatus };
}

// --- POST /cert-alerta-cron ---
router.post('/cert-alerta-cron', requireCronAuth, async (req, res) => {
  const inicio = Date.now();
  const graphOk = isGraphConfigured();
  const resultados = [];
  let alertasEnviados = 0;

  try {
    const db = fa().firestore();

    // 1) Cert do ESCRITÓRIO
    try {
      const snap = await db.collection('sefaz_certificados').doc('atual').get();
      if (snap.exists) {
        const d = snap.data();
        const r = await processarCert({
          ref: snap.ref,
          escopo: 'escritorio',
          titular: d.titular || 'Escritório',
          cnpj: d.cnpj || CNPJ_ESCRITORIO,
          fimIso: d.validade?.fim || null,
          faixaAnterior: d.alertaVencimento?.bucket ?? null,
          afetaTodas: true,
          graphOk,
        });
        if (r.acao === 'alertado' && r.emailStatus === 'enviado') alertasEnviados++;
        resultados.push(r);
      } else {
        resultados.push({ escopo: 'escritorio', acao: 'sem-cert-cadastrado' });
      }
    } catch (e) {
      console.error('[cert-alerta-cron] erro no cert do escritório:', e.message);
      resultados.push({ escopo: 'escritorio', acao: 'erro', motivo: e.message });
    }

    // 2) Certs POR EMPRESA
    try {
      const certs = await listCertsEmpresas();
      for (const c of certs) {
        // Cert per-empresa do escritorio ja foi avaliado acima como cert do
        // escritorio (sefaz_certificados/atual). Pula pra nao alertar 2x.
        if (String(c.cnpj || '').replace(/\D/g, '') === CNPJ_ESCRITORIO) continue;
        try {
          const ref = db.collection('empresas_certificados').doc(c.empresaId);
          const snap = await ref.get();
          const faixaAnterior = snap.exists ? (snap.data().alertaVencimento?.bucket ?? null) : null;
          const r = await processarCert({
            ref,
            escopo: 'empresa',
            titular: c.subject || c.cnpj || c.empresaId,
            cnpj: c.cnpj,
            fimIso: c.notAfter || null,
            faixaAnterior,
            afetaTodas: false,
            graphOk,
          });
          if (r.acao === 'alertado' && r.emailStatus === 'enviado') alertasEnviados++;
          if (r.acao !== 'sem-mudanca') resultados.push(r);
        } catch (e) {
          console.warn(`[cert-alerta-cron] erro empresa ${c.empresaId}:`, e.message);
        }
      }
    } catch (e) {
      console.error('[cert-alerta-cron] erro listando certs de empresas:', e.message);
    }

    const resumo = {
      ok: true,
      graphConfigurado: graphOk,
      alertasEnviados,
      avaliados: resultados.length,
      destinatario: ALERTA_PARA,
      duracaoMs: Date.now() - inicio,
      resultados,
    };
    console.log(`[cert-alerta-cron] concluído — ${alertasEnviados} alerta(s) enviado(s), ${resultados.length} mudança(s)`);

    // Log de auditoria (admin SDK; observabilidade do cron).
    try {
      await fa().firestore().collection('cert_alerta_cron_logs').add({
        ...resumo,
        criadoEm: fa().firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) { /* não-fatal */ }

    return res.json(resumo);
  } catch (e) {
    console.error('[cert-alerta-cron] erro fatal:', e);
    return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
  }
});

export default router;
