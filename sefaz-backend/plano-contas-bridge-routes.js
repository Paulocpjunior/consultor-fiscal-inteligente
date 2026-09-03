import express from 'express';
import { getDasMode } from './das-provider.js';
import { getDctfwebMode } from './dctfweb-provider.js';
import { getProviderMode as getCaixaPostalMode } from './caixa-postal-provider.js';
import { consultarPagamentosTributarios } from './fiscal-payments-connector.js';
import { secretsMatch } from './cron-secret.js';

const router = express.Router();
const BRIDGE_TOKEN = String(process.env.FISCAL_GATEWAY_TOKEN || process.env.PLANO_CONTAS_INTERNAL_TOKEN || '').trim();

function tokenDaRequisicao(req) {
    const auth = req.header('authorization') || '';
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
    return req.header('x-fiscal-gateway-token') || req.header('x-internal-token') || '';
}

function requireBridgeToken(req, res, next) {
    if (!BRIDGE_TOKEN) {
        return res.status(503).json({
            ok: false,
            error: 'FISCAL_GATEWAY_TOKEN nao configurado no app fiscal',
        });
    }
    // Comparação em tempo constante — era o ÚNICO segredo do backend ainda
    // comparado com `!==` (o cron-secret.js existe justamente para isso).
    if (!secretsMatch(tokenDaRequisicao(req), BRIDGE_TOKEN)) {
        return res.status(403).json({ ok: false, error: 'token interno invalido' });
    }
    next();
}

function cnpjLimpo(v) {
    return String(v || '').replace(/\D/g, '');
}

// Sem o token, o /status responde só o pulso (`{ok:true}`) — serve de sonda de
// vida para o app irmão sem dizer a anônimo se o token está configurado nem em
// qual modo cada provider roda; com o token válido, vem o detalhe.
router.get('/status', (req, res) => {
    if (!BRIDGE_TOKEN || !secretsMatch(tokenDaRequisicao(req), BRIDGE_TOKEN)) return res.json({ ok: true });
    res.json({
        ok: true,
        bridge: !!BRIDGE_TOKEN,
        das: { mode: getDasMode(), ok: true },
        dctfweb: { mode: getDctfwebMode(), ok: true },
        caixaPostal: { mode: getCaixaPostalMode(), ok: true },
        pagamentos: {
            contrato: 'fiscal_pagamentos_v1',
            fontes: ['CFI_DAS', 'CFI_DARF', 'DCTFWEB', 'COMPROVANTES_OFICIAIS'],
            politica: 'somente_comprovante_oficial_contabilizavel',
            adaptadores: {
                receita_ecac: 'credencial_disponivel_consulta_automatica_nao_configurada',
                fgts_digital: 'nao_configurado',
                estadual: 'nao_configurado',
                municipal: 'nao_configurado',
            },
        },
    });
});

router.post('/fiscal/sync', requireBridgeToken, async (req, res) => {
    const cnpj = cnpjLimpo(req.body?.cnpj || req.body?.empresaCnpj);
    if (cnpj.length !== 14) return res.status(400).json({ ok: false, error: 'cnpj invalido' });

    try {
        const resultado = await consultarPagamentosTributarios(cnpj, {
            competencia: req.body?.competencia,
        });
        res.json({
            ...resultado,
            modes: {
                das: getDasMode(),
                dctfweb: getDctfwebMode(),
                caixaPostal: getCaixaPostalMode(),
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

export default router;
