// ============================================================================
// sefaz-backend/sped-fiscal-routes.js  (ESM)
// Endpoints: /sped-fiscal/preview, /sped-fiscal/gerar, /sped-fiscal/listar
//
// Status atual: ESQUELETO — todas as rotas retornam 501 Not Implemented
// com mensagem clara. Logica fiscal sera implementada em Fase 1 (Bloco 0+9).
//
// Layout alvo: EFD ICMS/IPI Guia Pratico 3.2.2, Leiaute 020 (vigente 01/01/2026).
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { coletarDadosEmpresa, montarBlocos } from './sped-fiscal-orchestrator.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

async function requireAuth(req, res, next) {
    try {
        const auth = req.headers.authorization || '';
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ error: 'Token ausente' });
        const decoded = await fa().auth().verifyIdToken(m[1]);
        const uid = decoded.uid;
        const userDoc = await fa().firestore().collection('users').doc(uid).get();
        if (!userDoc.exists) return res.status(403).json({ error: 'Usuario nao encontrado' });
        req.user = { uid, email: decoded.email || userDoc.data().email, role: userDoc.data().role };
        next();
    } catch (e) {
        console.error('[sped-fiscal requireAuth] erro:', e.message);
        return res.status(401).json({ error: 'Token invalido ou expirado' });
    }
}

/**
 * GET /preview?empresaId=X&competencia=2026-03&escopo=mensal
 * Retorna preview: numero de notas, itens, participantes elegiveis pro periodo.
 * STUB: retorna 501 ate Fase 1 implementar.
 */
router.get('/preview', requireAuth, async (req, res) => {
    try {
        const { empresaId, competencia, competenciaInicio, competenciaFim } = req.query;
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });
        if (!competencia && !competenciaInicio) {
            return res.status(400).json({ error: 'competencia ou competenciaInicio+Fim obrigatorios' });
        }

        const dados = await coletarDadosEmpresa({
            empresaId,
            competencia,
            competenciaInicio,
            competenciaFim,
        });

        return res.json({
            empresaId,
            periodo: competencia || `${competenciaInicio} ate ${competenciaFim}`,
            totais: {
                notas: dados.notas.length,
                itens: dados.itens.length,
                participantes: dados.participantes.length,
            },
            warnings: dados.warnings,
        });
    } catch (e) {
        if (e.code === 'FASE1_PENDENTE') {
            return res.status(501).json({
                error: 'Fase 1 em desenvolvimento',
                message: 'A logica de preview sera implementada na proxima sessao. ' +
                         'Por enquanto, esta rota retorna 501 Not Implemented.',
            });
        }
        console.error('[sped-fiscal /preview]', e);
        return res.status(500).json({ error: e.message });
    }
});

/**
 * POST /gerar
 * Body: { empresaId, competencia, escopo, dadosContador? }
 * Retorna o .txt do SPED Fiscal montado.
 * STUB: retorna 501 ate Fase 1 implementar.
 */
router.post('/gerar', requireAuth, express.json(), async (req, res) => {
    try {
        const { empresaId, competencia, competenciaInicio, competenciaFim, dadosContador } = req.body || {};
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });

        const dados = await coletarDadosEmpresa({
            empresaId,
            competencia,
            competenciaInicio,
            competenciaFim,
        });

        const txt = await montarBlocos({ dados, dadosContador });

        // Quando Fase 1 estiver pronta, retorna o .txt como anexo:
        // res.setHeader('Content-Type', 'text/plain; charset=windows-1252');
        // res.setHeader('Content-Disposition', `attachment; filename="SPED_${empresaId}_${competencia}.txt"`);
        // return res.send(txt);

        return res.json({ ok: true, txt });
    } catch (e) {
        if (e.code === 'FASE1_PENDENTE') {
            return res.status(501).json({
                error: 'Fase 1 em desenvolvimento',
                message: 'A geracao do SPED sera implementada na proxima sessao. ' +
                         'A UI esta pronta e os endpoints existem, mas a logica fiscal ' +
                         '(Blocos 0 e 9) ainda nao foi finalizada.',
                fase: 1,
                blocosImplementados: [],
                blocosPendentes: ['0', '9'],
            });
        }
        console.error('[sped-fiscal /gerar]', e);
        return res.status(500).json({ error: e.message });
    }
});

/**
 * GET /historico?empresaId=X
 * Lista SPEDs ja gerados (Firestore: spedfiscal_geracoes).
 * STUB: retorna lista vazia ate implementar persistencia.
 */
router.get('/historico', requireAuth, async (_req, res) => {
    return res.json({ entries: [], message: 'Historico sera implementado na Fase 4.' });
});

export default router;
