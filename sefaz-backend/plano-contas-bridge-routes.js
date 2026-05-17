import express from 'express';
import { listarDas } from './das-orchestrator.js';
import { listarDeclaracoes } from './dctfweb-orchestrator.js';
import { listarMensagensLocais } from './caixa-postal-orchestrator.js';
import { getDasMode } from './das-provider.js';
import { getDctfwebMode } from './dctfweb-provider.js';
import { getProviderMode as getCaixaPostalMode } from './caixa-postal-provider.js';

const router = express.Router();
const BRIDGE_TOKEN = process.env.FISCAL_GATEWAY_TOKEN || process.env.PLANO_CONTAS_INTERNAL_TOKEN || '';

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
    if (tokenDaRequisicao(req) !== BRIDGE_TOKEN) {
        return res.status(403).json({ ok: false, error: 'token interno invalido' });
    }
    next();
}

function cnpjLimpo(v) {
    return String(v || '').replace(/\D/g, '');
}

router.get('/status', (_req, res) => {
    res.json({
        ok: true,
        bridge: !!BRIDGE_TOKEN,
        das: { mode: getDasMode(), ok: true },
        dctfweb: { mode: getDctfwebMode(), ok: true },
        caixaPostal: { mode: getCaixaPostalMode(), ok: true },
    });
});

router.post('/fiscal/sync', requireBridgeToken, express.json({ limit: '1mb' }), async (req, res) => {
    const cnpj = cnpjLimpo(req.body?.cnpj || req.body?.empresaCnpj);
    if (cnpj.length !== 14) return res.status(400).json({ ok: false, error: 'cnpj invalido' });

    try {
        const [dasResult, dctfwebResult, caixaResult] = await Promise.allSettled([
            listarDas({ empresaId: cnpj, competencia: req.body?.competencia }),
            listarDeclaracoes({ empresaCnpj: cnpj }),
            listarMensagensLocais({ empresaCnpj: cnpj, naoLidas: true }),
        ]);

        const erros = [];
        if (dasResult.status === 'rejected') erros.push({ fonte: 'DAS', erro: dasResult.reason?.message || String(dasResult.reason) });
        if (dctfwebResult.status === 'rejected') erros.push({ fonte: 'DCTFWeb', erro: dctfwebResult.reason?.message || String(dctfwebResult.reason) });
        if (caixaResult.status === 'rejected') erros.push({ fonte: 'CaixaPostal', erro: caixaResult.reason?.message || String(caixaResult.reason) });

        res.json({
            ok: erros.length === 0,
            cnpj,
            modes: {
                das: getDasMode(),
                dctfweb: getDctfwebMode(),
                caixaPostal: getCaixaPostalMode(),
            },
            das: dasResult.status === 'fulfilled' ? dasResult.value : [],
            dctfweb: dctfwebResult.status === 'fulfilled' ? dctfwebResult.value : [],
            caixaPostal: caixaResult.status === 'fulfilled' ? caixaResult.value : [],
            erros,
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

export default router;
