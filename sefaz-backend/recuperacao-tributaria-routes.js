import { Router } from 'express';
import { requireAdmin, requireAuth } from './require-admin.js';
import { getCatalogoTeses, analisarEmpresa, analisarTodas } from './recuperacao-tributaria-orchestrator.js';

const router = Router();

// Modelo centralizado em env var (default gemini-3.5-flash, GA mai/2026).
const GEMINI_MODEL_PRO = process.env.GEMINI_MODEL_PRO || 'gemini-3.5-flash';

// GET /status — modo atual
router.get('/status', (_req, res) => {
    res.json({ mode: 'ativo', teses: getCatalogoTeses().length });
});

// GET /teses — catálogo de teses disponíveis
router.get('/teses', requireAuth, (_req, res) => {
    res.json({ teses: getCatalogoTeses() });
});

// GET /analisar/:empresaId?regime=simples|lucro — análise de uma empresa
router.get('/analisar/:empresaId', requireAuth, async (req, res) => {
    try {
        const regime = req.query.regime || 'simples';
        const resultado = await analisarEmpresa(req.params.empresaId, regime);
        res.json(resultado);
    } catch (err) {
        console.error('[recuperacao/analisar]', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /analisar-todas — análise global
router.get('/analisar-todas', requireAdmin, async (_req, res) => {
    try {
        const resultado = await analisarTodas();
        res.json(resultado);
    } catch (err) {
        console.error('[recuperacao/analisar-todas]', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /parecer-ia — parecer da IA sobre uma tese específica
router.post('/parecer-ia', requireAdmin, async (req, res) => {
    try {
        const { empresaNome, tese, itens } = req.body;
        if (!tese) return res.status(400).json({ error: 'tese obrigatoria' });

        // Get AI instance from the global (set by server.js)
        const ai = req.app.get('ai');
        if (!ai) return res.status(503).json({ error: 'IA indisponivel' });

        const resumoItens = (itens || []).slice(0, 10).map(i =>
            `  ${i.competencia}: ${i.descricao} — Original R$ ${i.valorOriginal} → Recuperável R$ ${i.valorRecuperavel}`
        ).join('\n');

        const prompt = `Voce eh um advogado tributarista senior. Analise esta oportunidade de recuperacao tributaria:

Empresa: ${empresaNome || 'N/I'}
Tese: ${tese.nome}
Fundamento Legal: ${tese.fundamentoLegal}
Valor Estimado: R$ ${(tese.valorEstimado || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
Prazo Decadencial: ${tese.prazoDecadencial} anos

Itens identificados:
${resumoItens || '  Nenhum item detalhado'}

Em portugues brasileiro, em 4 paragrafos:
1. **Fundamentacao juridica:** explique a tese, cite os dispositivos legais e jurisprudencia aplicavel
2. **Viabilidade:** avalie a probabilidade de exito (alta/media/baixa) com base na jurisprudencia consolidada
3. **Procedimento:** descreva o caminho processual (administrativo ou judicial) e prazos estimados
4. **Recomendacao:** acao concreta para o escritorio (documentos necessarios, providencias imediatas)

Use **negrito** nos pontos-chave. Seja tecnicamente preciso.`;

        const response = await ai.models.generateContent({
            model: GEMINI_MODEL_PRO,
            contents: prompt,
        });

        res.json({
            analise: response.text ?? '',
            modelo: GEMINI_MODEL_PRO,
            geradoEm: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[recuperacao/parecer-ia]', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
