// ============================================================================
// sefaz-backend/notificacoes-routes.js
// Express router para notificações (e-mail via Microsoft Graph, Teams depois).
// Montado em /api/admin/notificacoes pelo server.js raiz.
// ============================================================================

import express from 'express';
import { requireAdmin } from './require-admin.js';
import admin from 'firebase-admin';
import { isGraphConfigured, enviarEmail } from './graph-provider.js';
import { coletarResumoCapturas, enviarResumoDiario, enviarResumoIndividualizado } from './notificacoes-orchestrator.js';

const router = express.Router();

// Status: confirma se as credenciais do Graph estão presentes (não testa envio).
router.get('/status', requireAdmin, (_req, res) => {
    res.json({ graphConfigurado: isGraphConfigured() });
});

// Teste de envio de e-mail. Só admin. Manda um e-mail real pela caixa indicada.
// Body: { remetente, para } — se omitidos, usa o e-mail do próprio admin logado.
router.post('/teste-email', requireAdmin, express.json(), async (req, res) => {
    try {
        const remetente = req.body?.remetente || req.user?.email;
        const para = req.body?.para || req.user?.email;

        if (!remetente || !para) {
            return res.status(400).json({
                ok: false,
                error: 'Informe remetente e para (ou logue com um usuário que tenha e-mail).',
            });
        }

        const r = await enviarEmail({
            remetente,
            para,
            assunto: 'Teste — Consultor Fiscal Inteligente',
            corpoHtml: `
                <p>Este é um e-mail de teste do <strong>Consultor Fiscal Inteligente</strong>.</p>
                <p>Se você recebeu esta mensagem, a integração com o Microsoft Graph
                está funcionando.</p>
                <p style="color:#888;font-size:12px">Enviado automaticamente — não responda.</p>
            `,
        });

        if (r.ok) {
            res.json({ ok: true, remetente, para });
        } else {
            res.status(502).json({ ok: false, error: r.error });
        }
    } catch (err) {
        console.error('[notificacoes] /teste-email:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Teste do resumo diario. So admin. Coleta as capturas das ultimas 24h e
// envia o e-mail de resumo pra caixa do admin logado (ou destinatario do body).
router.post('/teste-resumo', requireAdmin, express.json(), async (req, res) => {
    try {
        const remetente = req.body?.remetente || req.user?.email;
        const destinatarios = req.body?.para || req.user?.email;
        if (!remetente || !destinatarios) {
            return res.status(400).json({ ok: false, error: 'Informe remetente e para.' });
        }
        const r = await enviarResumoDiario({ remetente, destinatarios, horas: 24 });
        if (r.ok) {
            res.json({ ok: true, resumo: r.resumo });
        } else {
            res.status(502).json({ ok: false, error: r.error, resumo: r.resumo });
        }
    } catch (err) {
        console.error('[notificacoes] /teste-resumo:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Previa do resumo (so coleta, NAO envia e-mail). Util pra conferir os numeros.
router.get('/previa-resumo', requireAdmin, async (_req, res) => {
    try {
        const resumo = await coletarResumoCapturas(24);
        res.json(resumo);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cron do resumo diario. Autenticado por NOTIF_CRON_SECRET (header) ou OIDC.
// Dispara o resumo global para todos os usuarios com e-mail cadastrado.
router.post('/cron-resumo', async (req, res) => {
    // auth do cron — exige NOTIF_CRON_SECRET no header X-Notif-Cron-Secret.
    // Bug anterior: aceitava qualquer header 'Authorization: Bearer ...' sem
    // validar assinatura/issuer do OIDC — bypass via curl com token random.
    // Fix: removido o fallback Bearer-qualquer. Se o Cloud Scheduler usa OIDC,
    // ele DEVE ser configurado tambem com x-notif-cron-secret.
    const cronSecret = req.headers['x-notif-cron-secret'];
    const expected = process.env.NOTIF_CRON_SECRET;
    if (!expected || cronSecret !== expected) {
        return res.status(401).json({ error: 'Cron nao autorizado' });
    }

    try {
        // destinatarios: todos os users com e-mail (cada um recebe resumo da sua carteira)
        const snap = await admin.firestore().collection('users').get();
        const usuarios = snap.docs
            .map(d => ({
                uid: d.id,
                email: d.data().email,
                role: d.data().role || 'colaborador',
                nome: d.data().nome || d.data().displayName || '',
            }))
            .filter(u => typeof u.email === 'string' && u.email.includes('@'));

        if (usuarios.length === 0) {
            return res.json({ ok: true, aviso: 'nenhum usuario com e-mail', enviados: 0 });
        }

        const r = await enviarResumoIndividualizado({
            remetente: process.env.NOTIF_REMETENTE_EMAIL || '',
            usuarios,
            horas: 24,
        });

        if (r.ok) {
            res.json({ ok: true, enviados: r.enviados, falhas: r.falhas, total: usuarios.length, detalhes: r.detalhes });
        } else {
            res.status(502).json({ ok: false, error: r.error });
        }
    } catch (err) {
        console.error('[notificacoes] /cron-resumo:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

export default router;
