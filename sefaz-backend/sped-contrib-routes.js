// ============================================================================
// sefaz-backend/sped-contrib-routes.js  (ESM)
// Endpoints: /sped-contrib/preview, /sped-contrib/gerar
//
// Layout alvo: EFD Contribuicoes (PIS/COFINS) Guia Pratico 1.35.
// ============================================================================

import express from 'express';
import { coletarDadosContribuicoes, montarBlocosContribuicoes } from './sped-contrib-orchestrator.js';
import { requireAuth } from './require-admin.js';

const router = express.Router();

/**
 * GET /preview?empresaId=X&competencia=YYYY-MM
 * Retorna estatisticas: notas, itens, participantes elegiveis pro periodo.
 */
router.get('/preview', requireAuth, async (req, res) => {
    try {
        const { empresaId, competencia } = req.query;
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });
        if (!competencia) return res.status(400).json({ error: 'competencia obrigatoria (YYYY-MM)' });

        const dados = await coletarDadosContribuicoes({ empresaId, competencia });

        return res.json({
            empresaId,
            empresaNome: dados.empresa.nome,
            competencia,
            regimeApuracao: dados.regimeApuracao,
            totais: {
                notas: dados.notas.length,
                itens: dados.itens.length,
                participantes: dados.participantes.length,
                unidades: dados.unidades.length,
            },
            warnings: dados.warnings,
        });
    } catch (e) {
        return tratarErro(e, res);
    }
});

/**
 * POST /gerar
 * Body: { empresaId, competencia }
 * Retorna o .txt do SPED Contribuicoes montado, com Content-Disposition pra download.
 */
router.post('/gerar', requireAuth, express.json(), async (req, res) => {
    try {
        const { empresaId, competencia } = req.body || {};
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });
        if (!competencia) return res.status(400).json({ error: 'competencia obrigatoria (YYYY-MM)' });

        const dados = await coletarDadosContribuicoes({ empresaId, competencia });

        const txt = await montarBlocosContribuicoes({ dados });

        // Encoding Windows-1252 (legado SPED)
        const buffer = Buffer.from(txt, 'latin1');

        // Nome do arquivo: SPED_CONTRIB_<cnpj>_<periodo>.txt
        const cnpj = (dados.empresa.cnpj || '').replace(/\D/g, '');
        const periodo = competencia.replace('-', '');
        const filename = `SPED_CONTRIB_${cnpj}_${periodo}.txt`;

        res.setHeader('Content-Type', 'text/plain; charset=windows-1252');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        if (dados.warnings.length) {
            res.setHeader('X-SPED-Warnings', encodeURIComponent(JSON.stringify(dados.warnings)));
        }
        res.setHeader('X-SPED-Stats', encodeURIComponent(JSON.stringify({
            notas: dados.notas.length,
            itens: dados.itens.length,
            participantes: dados.participantes.length,
            linhas: txt.split('\r\n').length - 1,
            regimeApuracao: dados.regimeApuracao,
        })));
        return res.send(buffer);
    } catch (e) {
        return tratarErro(e, res);
    }
});

function tratarErro(e, res) {
    if (e.code === 'DADOS_FISCAIS_INCOMPLETOS') {
        return res.status(400).json({
            error: 'DADOS_FISCAIS_INCOMPLETOS',
            message: e.message,
        });
    }
    if (e.code === 'EMPRESA_NAO_ENCONTRADA') {
        return res.status(404).json({
            error: 'EMPRESA_NAO_ENCONTRADA',
            message: e.message,
        });
    }
    console.error('[sped-contrib]', e);
    return res.status(500).json({ error: e.message });
}

export default router;
