// ============================================================================
// sefaz-backend/notificacoes-routes.js
// Express router para notificações (e-mail via Microsoft Graph, Teams depois).
// Montado em /api/admin/notificacoes pelo server.js raiz.
// ============================================================================

import express from 'express';
import { requireAdmin } from './require-admin.js';
import { isGraphConfigured, enviarEmail } from './graph-provider.js';

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

export default router;
