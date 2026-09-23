// ============================================================================
// sefaz-backend/diagnostico-config-routes.js  (ESM)
//
// Diagnostico das env vars / configs operacionais. So admin. Nao expoe
// VALORES das envs — so reporta presenca/ausencia (segurança).
// ============================================================================

import express from 'express';
import { requireAuth } from './require-admin.js';
import { diagnosticarConfig } from './diagnostico-config-helper.js';
import { isGraphConfigured, getGraphToken, invalidarTokenGraph } from './graph-provider.js';
import { vereditoDaCredencialDeEmail } from './graph-credencial-sonda.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });

        // Detecta ambiente: se EMISSAO_BLOQUEADA=true e tem SERPRO_CONSUMER_KEY,
        // assume prod. Senao, dev.
        const ambiente = process.env.NODE_ENV === 'production' ? 'prod'
            : process.env.AMBIENTE === 'staging' ? 'staging' : 'prod'; // default prod
            // Default 'prod' eh agressivo proposital — admin quer ver TUDO que falta.

        const { resumo, achados } = diagnosticarConfig(process.env, ambiente);

        return res.json({
            ambiente,
            resumo,
            achados,
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[diagnostico-config]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

// ============================================================================
// POST /testar-credencial-email
//
// 🚨 "JÁ TÍNHAMOS MATADO ONTEM A QUESTÃO DO E-MAIL" (Paulo, 02/09) — e não
// dava para conferir. A credencial do SharePoint foi corrigida ontem e está
// funcionando; o e-mail é OUTRO aplicativo do Azure, guardado numa variável de
// MESMO NOME em OUTRO serviço. O único jeito de descobrir era **mandar uma
// guia a um cliente e ver falhar**, que foi como a Sandra descobriu.
//
// Esta rota PERGUNTA à Microsoft e devolve a resposta dela — **sem enviar
// mensagem a ninguém**. É a régua da casa (validação por RESULTADO) aplicada
// ao trilho que mais dói quando quebra.
//
// ⚠️ Invalida o token em cache antes de perguntar: o cache vale ~1h, e sondar
// com o token velho responderia "está tudo bem" sobre a credencial ANTIGA —
// exatamente a pergunta que ninguém quer errar depois de trocar o segredo.
// ============================================================================
router.post('/testar-credencial-email', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });

        const configurado = isGraphConfigured();
        if (!configurado) {
            return res.json({ ...vereditoDaCredencialDeEmail({ ok: false, configurado: false }), testadoEm: new Date().toISOString() });
        }
        invalidarTokenGraph();
        try {
            await getGraphToken();
            return res.json({ ...vereditoDaCredencialDeEmail({ ok: true, configurado: true }), testadoEm: new Date().toISOString() });
        } catch (e) {
            return res.json({
                ...vereditoDaCredencialDeEmail({ ok: false, configurado: true, erro: e.message }),
                // A resposta da Microsoft vai INTEIRA: é ela que nomeia o
                // aplicativo, e foi confundir os dois que custou o dia.
                respostaMicrosoft: String(e.message || '').slice(0, 600),
                testadoEm: new Date().toISOString(),
            });
        }
    } catch (e) {
        console.error('[diagnostico-config/testar-credencial-email]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

export default router;
