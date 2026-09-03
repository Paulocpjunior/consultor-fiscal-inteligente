// ============================================================================
// sefaz-backend/dp-integration-routes.js
// Endpoints consumidos pelo projeto Consultor-DP-Folhapagamentos.
// Montados em /api/dp-integration/ pelo server.js raiz.
//
// Provê acesso a dados reais SERPRO (FGTS, eSocial, DCTFWeb, CRF FGTS) que o
// projeto de DP/Folha consome via cross-origin para evitar duplicar a
// integração mTLS + OAuth2 do Integra Contador em outro deploy.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireCrossProjectAuth } from './require-cross-project-auth.js';
import { acharEmpresaCadastrada } from './empresa-cadastro-lookup.js';
import {
    consultarFgtsDigital,
    consultarESocial,
    consultarDctfWeb,
    consultarCrfFgtsSerpro,
} from './nfp-compliance-provider.js';
import { consultarCndsPublicas } from './cnd-publica-provider.js';

const router = express.Router();
router.use(express.json());

// ─── Validação ──────────────────────────────────────────────────────────────

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

/**
 * CNPJ válido E CLIENTE do escritório.
 *
 * 🚨 Estas rotas devolvem dado SERPRO (FGTS, eSocial, DCTFWeb, CRF) e o token
 * aceito é o de qualquer usuário dos apps irmãos — sem esta trava, qualquer
 * colaborador logado enumerava a situação de QUALQUER CNPJ do Brasil. O
 * escopo por carteira não serve aqui (o uid do DP é de outro projeto), então
 * a fronteira é o CADASTRO: só quem é cliente responde. A recusa DIZ isso,
 * senão a primeira parada seria "o SERPRO está fora".
 */
async function validarCnpj(req, res) {
    const cnpj = (req.body?.cnpj || req.query?.cnpj || '').replace(/\D/g, '');
    if (!cnpj || cnpj.length !== 14) {
        res.status(400).json({ error: 'CNPJ inválido — informe 14 dígitos.' });
        return null;
    }
    const cadastrada = await acharEmpresaCadastrada(getDb(), cnpj);
    if (!cadastrada) {
        res.status(403).json({ error: `CNPJ ${cnpj} não é cliente cadastrado no CFI — a consulta SERPRO só responde por empresa da carteira.` });
        return null;
    }
    return cnpj;
}

// ─── Rotas ──────────────────────────────────────────────────────────────────

// FGTS - Consulta recolhimento por competência
// POST /api/dp-integration/fgts/recolhimento
// Body: { cnpj, competencia: 'YYYY-MM' }
router.post('/fgts/recolhimento', requireCrossProjectAuth, async (req, res) => {
    const cnpj = await validarCnpj(req, res);
    if (!cnpj) return;
    const competencia = req.body.competencia;
    if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) {
        return res.status(400).json({ error: 'competencia obrigatória no formato YYYY-MM' });
    }
    try {
        const result = await consultarFgtsDigital(cnpj, competencia);
        return res.json(result);
    } catch (err) {
        console.error('[dp-integration/fgts/recolhimento]', err);
        return res.status(500).json({ error: err.message });
    }
});

// FGTS - Consulta CRF (Certificado de Regularidade)
// Tenta SERPRO primeiro; se falhar, cai no fallback de consulta pública (Caixa).
// POST /api/dp-integration/fgts/crf
// Body: { cnpj }
router.post('/fgts/crf', requireCrossProjectAuth, async (req, res) => {
    const cnpj = await validarCnpj(req, res);
    if (!cnpj) return;
    let result;
    try {
        result = await consultarCrfFgtsSerpro(cnpj);
    } catch {
        result = { ok: false, status: 'indisponivel' };
    }
    // Se SERPRO falhou ou indisponivel, tenta consulta pública
    if (!result?.ok || result?.status === 'indisponivel' || result?.status === 'nao_consultada') {
        try {
            const publicas = await consultarCndsPublicas(cnpj);
            const crfPub = (publicas?.certidoes || []).find(c => c.tipo?.includes('CRF') || c.esfera === 'fgts');
            if (crfPub && crfPub.status !== 'indisponivel') {
                return res.json({ ...crfPub, fonte: 'consulta_publica' });
            }
        } catch (err) {
            console.warn('[dp-integration/fgts/crf] fallback publico falhou:', err.message);
        }
    }
    return res.json(result || { ok: false, status: 'indisponivel' });
});

// eSocial - Status de fechamento mensal
// POST /api/dp-integration/esocial/status
// Body: { cnpj, competencia: 'YYYY-MM' }
router.post('/esocial/status', requireCrossProjectAuth, async (req, res) => {
    const cnpj = await validarCnpj(req, res);
    if (!cnpj) return;
    const competencia = req.body.competencia;
    if (!competencia) return res.status(400).json({ error: 'competencia obrigatória' });
    try {
        const result = await consultarESocial(cnpj, competencia);
        return res.json(result);
    } catch (err) {
        console.error('[dp-integration/esocial/status]', err);
        return res.status(500).json({ error: err.message });
    }
});

// DCTFWeb - Status de transmissão
// POST /api/dp-integration/dctfweb/status
// Body: { cnpj, competencia: 'YYYY-MM' }
router.post('/dctfweb/status', requireCrossProjectAuth, async (req, res) => {
    const cnpj = await validarCnpj(req, res);
    if (!cnpj) return;
    const competencia = req.body.competencia;
    if (!competencia) return res.status(400).json({ error: 'competencia obrigatória' });
    try {
        const result = await consultarDctfWeb(cnpj, competencia);
        return res.json(result);
    } catch (err) {
        console.error('[dp-integration/dctfweb/status]', err);
        return res.status(500).json({ error: err.message });
    }
});

// Batch query — all DP-relevant data for a company in a single call.
// POST /api/dp-integration/empresa-completo
// Body: { cnpj, competencia: 'YYYY-MM' }
router.post('/empresa-completo', requireCrossProjectAuth, async (req, res) => {
    const cnpj = await validarCnpj(req, res);
    if (!cnpj) return;
    const competencia = req.body.competencia || new Date().toISOString().slice(0, 7);

    try {
        const [fgts, esocial, dctfweb, crf] = await Promise.allSettled([
            consultarFgtsDigital(cnpj, competencia),
            consultarESocial(cnpj, competencia),
            consultarDctfWeb(cnpj, competencia),
            consultarCrfFgtsSerpro(cnpj),
        ]);

        return res.json({
            cnpj,
            competencia,
            consultadoEm: new Date().toISOString(),
            fgts: fgts.status === 'fulfilled' ? fgts.value : { ok: false, erro: fgts.reason?.message },
            esocial: esocial.status === 'fulfilled' ? esocial.value : { ok: false, erro: esocial.reason?.message },
            dctfweb: dctfweb.status === 'fulfilled' ? dctfweb.value : { ok: false, erro: dctfweb.reason?.message },
            crfFgts: crf.status === 'fulfilled' ? crf.value : { ok: false, erro: crf.reason?.message },
        });
    } catch (err) {
        console.error('[dp-integration/empresa-completo]', err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;
