// ============================================================================
// sefaz-backend/diagnostico-config-routes.js  (ESM)
//
// Diagnostico das env vars / configs operacionais. So admin. Nao expoe
// VALORES das envs — so reporta presenca/ausencia (segurança).
// ============================================================================

import express from 'express';
import { requireAuth } from './require-admin.js';
import { diagnosticarConfig } from './diagnostico-config-helper.js';

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

export default router;
