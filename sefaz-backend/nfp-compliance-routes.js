// ============================================================================
// sefaz-backend/nfp-compliance-routes.js
// Express router pra consultas de compliance fiscal via SERPRO.
// Montado em /api/admin/nfp-compliance pelo server.js raiz.
// ============================================================================

import express from 'express';
import { requireAuth } from './require-admin.js';
import {
    consultarSituacaoFiscal,
    consultarDividaAtiva,
    consultarCertidoes,
    consultarObrigacoes,
    consultarParcelamentos,
    analisarEmpresaCompleta,
} from './nfp-compliance-provider.js';

const router = express.Router();

// ─── Validação ──────────────────────────────────────────────────────────────

function validarCnpj(req, res) {
    const cnpj = (req.body.cnpj || '').replace(/\D/g, '');
    if (!cnpj || cnpj.length !== 14) {
        res.status(400).json({ error: 'CNPJ inválido — informe 14 dígitos numéricos.' });
        return null;
    }
    return cnpj;
}

// ─── Rotas ──────────────────────────────────────────────────────────────────

router.post('/situacao-fiscal', requireAuth, async (req, res) => {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    try {
        const result = await consultarSituacaoFiscal(cnpj);
        res.json(result);
    } catch (err) {
        console.error('[nfp-compliance-routes] situacao-fiscal error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/divida-ativa', requireAuth, async (req, res) => {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    try {
        const result = await consultarDividaAtiva(cnpj);
        res.json(result);
    } catch (err) {
        console.error('[nfp-compliance-routes] divida-ativa error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/certidoes', requireAuth, async (req, res) => {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    try {
        const result = await consultarCertidoes(cnpj);
        res.json(result);
    } catch (err) {
        console.error('[nfp-compliance-routes] certidoes error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/obrigacoes', requireAuth, async (req, res) => {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    try {
        const result = await consultarObrigacoes(cnpj);
        res.json(result);
    } catch (err) {
        console.error('[nfp-compliance-routes] obrigacoes error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/parcelamentos', requireAuth, async (req, res) => {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    try {
        const result = await consultarParcelamentos(cnpj);
        res.json(result);
    } catch (err) {
        console.error('[nfp-compliance-routes] parcelamentos error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/analise-completa', requireAuth, async (req, res) => {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    try {
        const result = await analisarEmpresaCompleta(cnpj);
        res.json(result);
    } catch (err) {
        console.error('[nfp-compliance-routes] analise-completa error:', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
