// ============================================================================
// sefaz-backend/darf-routes.js
// Express router pra emissao de DARF (Lucro Presumido / Real).
// Montado em /api/admin/darf pelo server.js raiz.
// ============================================================================

import express from 'express';
import { requireEmissao } from './require-admin.js';
import {
    emitirDarf, listarDarfs, getResumoDarf,
    marcarPago, processarVencimentos,
} from './darf-orchestrator.js';
import { getDarfMode, montarPayloadDarfSerpro } from './darf-provider.js';
import { listarCodigos, sugerirCodigoReceita } from './darf-codigos-receita.js';
import { getCnpjsDaCarteira, podeAcessarCnpj } from './carteira-auth.js';
import { secretsMatch } from './cron-secret.js';

const router = express.Router();
const CRON_SECRET = process.env.SEFAZ_CRON_SECRET || '';
const JSON_LIMIT = '256kb';

// CNPJs da carteira do colaborador como Set (ou null = admin, sem restrição).
async function cnpjsPermitidos(user) {
    const cnpjs = await getCnpjsDaCarteira(user);
    return cnpjs ? new Set(cnpjs) : null;
}

router.get('/status', (_req, res) => {
    res.json({ mode: getDarfMode(), ok: true });
});

router.get('/codigos-receita', requireEmissao, (_req, res) => {
    res.json(listarCodigos());
});

router.get('/sugerir-codigo', requireEmissao, (req, res) => {
    const { regime, tributo, periodicidade } = req.query;
    const sug = sugerirCodigoReceita(regime, tributo, periodicidade);
    res.json(sug || {});
});

router.get('/resumo', requireEmissao, async (req, res) => {
    try { res.json(await getResumoDarf(await cnpjsPermitidos(req.user))); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/listar', requireEmissao, async (req, res) => {
    try {
        res.json(await listarDarfs({
            empresaId:   req.query.empresaId,
            competencia: req.query.competencia,
            tributo:     req.query.tributo,
            regime:      req.query.regime,
            status:      req.query.status,
        }, await cnpjsPermitidos(req.user)));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/emitir', requireEmissao, express.json({ limit: JSON_LIMIT }), async (req, res) => {
    try {
        // Escreve no Fisco em nome do CNPJ — exige que ele esteja na carteira.
        const carteira = await podeAcessarCnpj(req.user, req.body?.empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await emitirDarf(req.body));
    } catch (err) { res.status(err.httpStatus || 400).json({ error: err.message, code: err.code }); }
});

// PREVIEW (dry-run): monta o payload EXATO que seria enviado ao SERPRO pra
// emitir o DARF — SEM enviar nada. Read-only, NAO passa pelo kill-switch.
// Uso: validar o idServico (EMITEDARF61 e chute) + estrutura do payload contra
// o catalogo da conta SERPRO ANTES de ligar a emissao real.
router.post('/preview', requireEmissao, express.json({ limit: JSON_LIMIT }), (req, res) => {
    try {
        const payload = montarPayloadDarfSerpro(req.body || {});
        res.json({
            preview: true,
            avisoIdServico: 'idServico EMITEDARF61 e suposto (TODO[SERPRO_REAL]). '
                + 'Confirme no catalogo PAGTOWEB da sua conta SERPRO; ajuste via env SERPRO_DARF_SERVICO se diferente.',
            payloadSerpro: payload,
        });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/marcar-pago', requireEmissao, express.json({ limit: JSON_LIMIT }), async (req, res) => {
    try {
        const { docId, dataPagamento } = req.body;
        if (!docId) return res.status(400).json({ error: 'docId obrigatorio' });
        res.json(await marcarPago(docId, dataPagamento, await cnpjsPermitidos(req.user)));
    } catch (err) { res.status(err.httpStatus || 500).json({ error: err.message }); }
});

// Cron noturno (Cloud Scheduler) — marca DARFs vencidas
router.post('/cron', async (req, res) => {
    const headerSecret = req.header('X-Cron-Secret') || '';
    if (!secretsMatch(headerSecret, CRON_SECRET)) {
        return res.status(403).json({ erro: 'cron secret invalido' });
    }
    try {
        const stats = await processarVencimentos();
        return res.json({ ok: true, ...stats });
    } catch (err) {
        return res.status(500).json({ ok: false, erro: err.message });
    }
});

export default router;
