// ============================================================================
// sefaz-backend/health-alerta-cron.js  (ESM)
//
// Cron noturno que consulta o /health-consolidado internamente e dispara
// email se o status piorou. Roda 1× por dia (08:00 BRT recomendado).
//
// Anti-spam: guarda `lastStatus` em Firestore (health_alertas/atual).
// So dispara email se:
//   - status piorou (ok → medio → alto → critico)
//   - OU passou >24h desde ultimo envio
// Status melhorou (volta pra ok) tambem dispara — "tudo voltou ao normal".
//
// Cron auth pelo header X-Cron-Secret (mesma convencao dos outros crons).
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { enviarEmail, isGraphConfigured } from './graph-provider.js';
import { pendenciasCadastro, gravidadeCadastro } from './diagnostico-cadastros-helper.js';
import { faixaDeVencimento, diasAteVencimento } from './cert-vencimento-helper.js';
import { diagnosticarConfig } from './diagnostico-config-helper.js';
import { listCertsEmpresas } from './cert-storage.js';
import { fetchAllDocs } from './firestore-paginate.js';

const router = express.Router();

const REMETENTE = process.env.GRAPH_REMETENTE || 'junior@spassessoriacontabil.com.br';
const DESTINATARIO = process.env.HEALTH_ALERT_TO || process.env.CERT_ALERT_TO || REMETENTE;
const COLLECTION = 'health_alertas';
const DOC_ID = 'atual';
const REENVIO_MS = 24 * 60 * 60 * 1000; // 24h

const ORDEM_STATUS = { ok: 0, degraded: 1, medio: 2, alto: 3, critico: 4 };

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

function requireCronAuth(req, res, next) {
    const secret = process.env.SEFAZ_CRON_SECRET;
    if (!secret) {
        console.error('[health-alerta-cron] SEFAZ_CRON_SECRET não configurado');
        return res.status(500).json({ error: 'Cron secret not configured' });
    }
    const headerSecret = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'];
    if (headerSecret === secret) return next();
    const headerPrefix = headerSecret ? String(headerSecret).slice(0, 4) + '...' : '(ausente)';
    const jobName = req.headers['x-cloudscheduler-jobname'] || '(no header)';
    console.warn(`[health-alerta-cron] 403 mismatch — header=${headerPrefix} job=${jobName} ip=${req.ip}`);
    return res.status(403).json({ error: 'Cron auth failed' });
}

// ─── Reusa a lógica do /health-consolidado em proc, sem HTTP self-call ──────
async function calcularSaude() {
    const erros = [];
    let cadastros = null, documentos = null, certificados = null, configuracoes = null;

    // Cadastros
    try {
        const db = fa().firestore();
        const empresas = [];
        for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
            const snap = await db.collection(col).get();
            snap.forEach((doc) => {
                const d = doc.data();
                if (d._merged_into) return;
                const pendencias = pendenciasCadastro(d, regime);
                empresas.push({ gravidade: gravidadeCadastro(pendencias) });
            });
        }
        cadastros = {
            total: empresas.length,
            criticos: empresas.filter((e) => e.gravidade === 'critico').length,
            altos: empresas.filter((e) => e.gravidade === 'alto').length,
            medios: empresas.filter((e) => e.gravidade === 'medio').length,
            ok: empresas.filter((e) => e.gravidade === 'ok').length,
        };
    } catch (e) { erros.push({ secao: 'cadastros', erro: e.message }); }

    // Documentos fiscais
    try {
        const db = fa().firestore();
        const docs = await fetchAllDocs(db.collection('documentos_fiscais'), { label: 'health-cron/docs' });
        let semChave = 0, semEmpresa = 0;
        const porChave = new Map();
        for (const d of docs) {
            const x = d.data() || {};
            const chave = String(x.chave || x.chaveAcesso || '').replace(/\D/g, '');
            if (chave.length !== 44) semChave++;
            else porChave.set(chave, (porChave.get(chave) || 0) + 1);
            if (!x.empresaId || !x.empresaCnpj) semEmpresa++;
        }
        let duplicadas = 0;
        for (const c of porChave.values()) if (c > 1) duplicadas += c;
        documentos = { total: docs.length, semChave, semEmpresa, duplicadas };
    } catch (e) { erros.push({ secao: 'documentos', erro: e.message }); }

    // Certificados
    try {
        const agora = new Date();
        const items = [];
        try {
            const sefazDoc = await fa().firestore().collection('sefaz_certificados').doc('atual').get();
            if (sefazDoc.exists) {
                const fim = sefazDoc.data().validade?.fim;
                if (fim) items.push({ faixa: faixaDeVencimento(diasAteVencimento(fim, agora)) });
            }
        } catch { /* ignora */ }
        const lista = await listCertsEmpresas();
        for (const c of (lista || [])) {
            items.push({ faixa: faixaDeVencimento(diasAteVencimento(c.notAfter, agora)) });
        }
        certificados = {
            total: items.length,
            expirados: items.filter((i) => i.faixa === 'expirado').length,
            criticos: items.filter((i) => i.faixa === '1' || i.faixa === '3').length,
            urgentes: items.filter((i) => i.faixa === '7').length,
        };
    } catch (e) { erros.push({ secao: 'certificados', erro: e.message }); }

    // Configurações
    try {
        const { resumo } = diagnosticarConfig(process.env, 'prod');
        configuracoes = { total: resumo.total, criticos: resumo.criticos, altos: resumo.altos };
    } catch (e) { erros.push({ secao: 'configuracoes', erro: e.message }); }

    const cadCrit = cadastros?.criticos || 0;
    const certExp = certificados?.expirados || 0;
    const cfgCrit = configuracoes?.criticos || 0;
    const totalCritico = cadCrit + certExp + cfgCrit;
    const totalAlto = (cadastros?.altos || 0) + (certificados?.criticos || 0) + (certificados?.urgentes || 0) + (configuracoes?.altos || 0);

    const status = totalCritico > 0 ? 'critico'
        : totalAlto > 0 ? 'alto'
        : ((documentos?.semChave || 0) + (documentos?.semEmpresa || 0) + (documentos?.duplicadas || 0)) > 0 ? 'medio'
        : erros.length > 0 ? 'degraded'
        : 'ok';

    return {
        status,
        totais: { critico: totalCritico, alto: totalAlto },
        secoes: { cadastros, documentos, certificados, configuracoes },
        erros,
    };
}

function corpoEmail(saude) {
    const labels = { ok: '✅ OK', degraded: '⚠️ DEGRADADO', medio: '🟡 ATENÇÃO', alto: '🟠 ALTO', critico: '🔴 CRÍTICO' };
    const cor = saude.status === 'critico' ? '#dc2626' : saude.status === 'alto' ? '#ea580c' : saude.status === 'medio' ? '#d97706' : saude.status === 'degraded' ? '#6b7280' : '#16a34a';

    const linhasSecao = (titulo, m) => {
        if (!m) return `<tr><td colspan="2"><i>${titulo}: indisponível</i></td></tr>`;
        return Object.entries(m)
            .filter(([k]) => k !== 'total')
            .map(([k, v]) => `<tr><td>${titulo} — ${k}</td><td style="text-align:right;font-weight:bold">${v}</td></tr>`)
            .join('');
    };

    const errosHtml = saude.erros.length
        ? `<p style="color:#6b7280">⚠ Leitura parcial: ${saude.erros.map((e) => `<b>${e.secao}</b>`).join(', ')} falharam.</p>`
        : '';

    return {
        assunto: `[Consultor Fiscal] Saúde do sistema: ${saude.status.toUpperCase()}`,
        corpoHtml: `
<div style="font-family:Arial,sans-serif;max-width:700px;margin:auto">
  <h1 style="color:${cor}">${labels[saude.status]}</h1>
  <p>Diagnóstico noturno em ${new Date().toLocaleString('pt-BR')}:</p>
  <table border="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:13px">
    ${linhasSecao('CADASTROS', saude.secoes.cadastros)}
    ${linhasSecao('DOCUMENTOS', saude.secoes.documentos)}
    ${linhasSecao('CERTIFICADOS', saude.secoes.certificados)}
    ${linhasSecao('CONFIGURAÇÕES', saude.secoes.configuracoes)}
  </table>
  ${errosHtml}
  <p style="color:#6b7280;font-size:12px;margin-top:24px">
    Esse alerta vem do cron noturno (health-alerta-cron). Anti-spam: re-envia
    apenas se status mudou ou se passaram &gt;24h. Para detalhes, acesse o
    painel "Saúde Geral" no consultor fiscal.
  </p>
</div>`,
    };
}

// ── POST /health-alerta-cron — chamado pelo Cloud Scheduler ────────────────
router.post('/health-alerta-cron', requireCronAuth, async (req, res) => {
    const dryRun = req.body?.dryRun === true || req.query?.dryRun === '1';
    try {
        const graphOk = isGraphConfigured();
        const saude = await calcularSaude();

        // Le status anterior
        const ref = fa().firestore().collection(COLLECTION).doc(DOC_ID);
        const snap = await ref.get();
        const prev = snap.exists ? snap.data() : null;
        const prevStatus = prev?.lastStatus || 'ok';
        const prevAt = prev?.lastSentAt?.toDate?.()?.getTime?.() || 0;

        const piorou = ORDEM_STATUS[saude.status] > ORDEM_STATUS[prevStatus];
        const melhorou = ORDEM_STATUS[saude.status] < ORDEM_STATUS[prevStatus];
        const passou24h = Date.now() - prevAt > REENVIO_MS;
        // Reenvia se piorou OU melhorou OU (status atual nao-ok E passou 24h)
        const deveEnviar = piorou || melhorou || (saude.status !== 'ok' && passou24h);

        let envioResult = { ok: false, motivo: 'sem mudança / dentro de 24h' };
        if (deveEnviar && !dryRun && graphOk) {
            const { assunto, corpoHtml } = corpoEmail(saude);
            envioResult = await enviarEmail({
                remetente: REMETENTE,
                para: DESTINATARIO,
                assunto,
                corpoHtml,
            });
            if (envioResult.ok) {
                await ref.set({
                    lastStatus: saude.status,
                    lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastTotais: saude.totais,
                }, { merge: true });
            }
        } else if (!graphOk) {
            envioResult = { ok: false, motivo: 'Graph não configurado (GRAPH_* envs)' };
        } else if (dryRun) {
            envioResult = { ok: false, motivo: 'dry-run' };
        }

        return res.json({
            status: saude.status,
            totais: saude.totais,
            secoes: saude.secoes,
            erros: saude.erros,
            statusAnterior: prevStatus,
            piorou, melhorou, passou24h,
            envioEmail: envioResult,
            dryRun,
        });
    } catch (e) {
        console.error('[health-alerta-cron]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

export default router;
