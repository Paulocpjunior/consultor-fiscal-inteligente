// ============================================================================
// sefaz-backend/cron-health-routes.js  (ESM)
//
// GET  /api/admin/crons/health         — visão única de saúde de todos os crons
//                                         (verde/amarelo/vermelho). Somente admin.
// POST /api/admin/crons/health-alerta  — cron que dispara e-mail quando algum
//                                         cron está em falha/travado. x-cron-secret.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { secretsMatch } from './cron-secret.js';
import { coletarSaudeCrons, decidirAlertaCron } from './cron-health.js';
import { enviarEmail, isGraphConfigured } from './graph-provider.js';
import { parseDestinatarios } from './email-destinatarios-helper.js';

const router = express.Router();

const REMETENTE = process.env.GRAPH_REMETENTE || 'junior@spassessoriacontabil.com.br';
const ALERTA_PARA = parseDestinatarios(process.env.CRON_ALERT_TO || process.env.CERT_ALERT_TO, REMETENTE);

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

function requireCronAuth(req, res, next) {
    const secret = process.env.SEFAZ_CRON_SECRET;
    if (!secret) {
        console.error('[cron-health-alerta] SEFAZ_CRON_SECRET não configurado');
        return res.status(500).json({ error: 'Cron secret not configured' });
    }
    const header = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'];
    if (secretsMatch(header, secret)) return next();
    return res.status(403).json({ error: 'Cron auth failed' });
}

router.get('/health', requireAdmin, async (req, res) => {
    try {
        const saude = await coletarSaudeCrons(fa().firestore());
        return res.json({ ok: true, ...saude });
    } catch (e) {
        console.error('[cron-health] erro:', e.message);
        return res.status(500).json({ ok: false, erro: 'Falha ao coletar saúde dos crons' });
    }
});

function corpoEmailAlerta(problemas, geradoEm) {
    const linhas = problemas.map(p => {
        const idade = p.idadeHoras == null ? 'nunca rodou'
            : p.idadeHoras < 24 ? `há ${Math.round(p.idadeHoras)}h`
            : `há ${Math.round(p.idadeHoras / 24)}d`;
        const cor = p.saude === 'falha' ? '#dc2626' : '#ea580c';
        return `<tr>
            <td style="padding:6px 10px;font-weight:bold">${p.label}</td>
            <td style="padding:6px 10px;color:${cor};font-weight:bold;text-transform:uppercase">${p.saude}</td>
            <td style="padding:6px 10px;color:#64748b">${idade}</td>
        </tr>`;
    }).join('');
    return `<div style="font-family:system-ui,Arial,sans-serif;max-width:640px">
        <h2 style="color:#dc2626">🔴 ${problemas.length} cron(s) com problema</h2>
        <p style="color:#334155">Detectado em ${new Date(geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.
        Um cron em <b>falha</b> não concluiu; <b>travado</b> ficou preso em 'iniciado' (container reciclado no meio).</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
            <thead><tr style="background:#f1f5f9;text-align:left">
                <th style="padding:6px 10px">Cron</th><th style="padding:6px 10px">Estado</th><th style="padding:6px 10px">Último run</th>
            </tr></thead>
            <tbody>${linhas}</tbody>
        </table>
        <p style="color:#64748b;font-size:12px;margin-top:16px">Veja o detalhe em Documentos Fiscais → Captura automática → Saúde dos crons.</p>
    </div>`;
}

// POST /health-alerta — dispara e-mail quando há cron em falha/travado. Anti-spam
// por assinatura (re-alerta 1x/dia por problema persistente; na hora se muda).
router.post('/health-alerta', requireCronAuth, async (req, res) => {
    try {
        const db = fa().firestore();
        const saude = await coletarSaudeCrons(db);
        const stateRef = db.collection('cron_health_alerta_state').doc('singleton');
        const snap = await stateRef.get();
        const estadoAnterior = snap.exists ? snap.data() : null;
        const hojeData = new Date().toISOString().slice(0, 10);
        const decisao = decidirAlertaCron(saude, estadoAnterior, hojeData);

        let emailStatus = 'nao-enviado';
        if (decisao.alertar) {
            if (!isGraphConfigured()) {
                emailStatus = 'graph-nao-configurado';
            } else {
                const r = await enviarEmail({
                    remetente: REMETENTE,
                    para: ALERTA_PARA,
                    assunto: `🔴 ${decisao.problemas.length} cron(s) com problema — captura fiscal`,
                    corpoHtml: corpoEmailAlerta(decisao.problemas, saude.geradoEm),
                });
                emailStatus = r.ok ? 'enviado' : `falha: ${r.error || 'desconhecida'}`;
            }
        }

        // Persiste a assinatura atual (mesmo sem alertar) pra o anti-spam funcionar.
        await stateRef.set({
            assinatura: decisao.assinatura,
            data: hojeData,
            problemas: decisao.problemas.length,
            emailStatus: decisao.alertar ? emailStatus : 'sem-mudanca',
            avaliadoEm: new Date().toISOString(),
        }, { merge: true });

        return res.json({
            ok: true,
            problemas: decisao.problemas.length,
            alertado: decisao.alertar,
            emailStatus,
        });
    } catch (e) {
        console.error('[cron-health-alerta] erro:', e.message);
        return res.status(500).json({ ok: false, erro: e.message });
    }
});

export default router;
