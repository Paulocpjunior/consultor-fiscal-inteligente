// ============================================================================
// sefaz-backend/efd-reinf-routes.js  (ESM)
//
// Montado em: /api/admin/efd-reinf
//
//   POST /analisar   — recebe 1+ XML de evento EFD-Reinf, parseia, valida a
//                      coerência interna e consolida as retenções da competência.
//
// Compute PURO (sem firebase/SERPRO): só lê os XMLs que o admin enviar. O
// cruzamento contra a DCTFWeb real é a etapa seguinte (services/efdReinfConference
// já tem o motor; falta a fonte de retenção da DCTFWeb via serpro-smoke).
// ============================================================================

import express from 'express';
import { parseEventoReinf, validarEventoReinf, consolidarReinf } from './efd-reinf-parser.js';
import { requireAdmin } from './require-admin.js';

const router = express.Router();

/**
 * POST /analisar
 * Body: { xmls: string[] }   (conteúdo de cada arquivo .xml de evento Reinf)
 * Retorna: { eventos: [...analise por evento...], consolidacao: {...} }
 */
router.post('/analisar', requireAdmin, express.json({ limit: '20mb' }), async (req, res) => {
    try {
        const body = req.body || {};
        const xmls = Array.isArray(body.xmls) ? body.xmls
            : (typeof body.xml === 'string' ? [body.xml] : null);
        if (!xmls || !xmls.length) {
            return res.status(400).json({ error: 'Envie { xmls: string[] } com o conteúdo dos eventos EFD-Reinf.' });
        }
        if (xmls.length > 500) {
            return res.status(400).json({ error: 'Máximo de 500 eventos por chamada.' });
        }
        // Teto por item: evita 1 XML único de 20MB bloquear o event loop no DOMParser.
        const MAX_XML_BYTES = 1_000_000;
        for (let i = 0; i < xmls.length; i++) {
            const x = xmls[i];
            if (typeof x !== 'string') {
                return res.status(400).json({ error: `xmls[${i}] nao e string.` });
            }
            if (Buffer.byteLength(x, 'utf8') > MAX_XML_BYTES) {
                return res.status(413).json({ error: `xmls[${i}] excede ${MAX_XML_BYTES} bytes.` });
            }
        }

        const parsed = [];
        const eventos = [];
        for (const xml of xmls) {
            const p = parseEventoReinf(xml);
            parsed.push(p);
            const validacao = validarEventoReinf(p);
            eventos.push({
                ok: p.ok,
                codigo: p.codigo,
                schemaToken: p.schemaToken,
                tipoRetorno: p.tipoRetorno,
                calibrado: p.calibrado,
                id: p.id,
                perApur: p.ideEvento.perApur,
                indRetif: p.ideEvento.indRetif,
                contribuinte: p.contribuinte,
                totais: p.totais,
                retencoes: p.retencoes,
                fechamento: p.fechamento,
                validacao,
                observacoes: p.observacoes,
            });
        }

        const consolidacao = consolidarReinf(parsed);

        return res.json({
            qtd: eventos.length,
            eventos,
            consolidacao,
        });
    } catch (e) {
        console.error('[efd-reinf/analisar]', e);
        return res.status(500).json({ error: "Falha interna" });
    }
});

export default router;
