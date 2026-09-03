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
import { separarIrrfDctfweb } from './irrf-dctfweb-familias.js';
import { consolidarR4010, cruzarIrrfR4010 } from './reinf-irrf-r4010-cruzamento.js';
import { listarDebitosDeclaracao } from './dctfweb-orchestrator.js';
import { podeAcessarCnpj } from './carteira-auth.js';

const router = express.Router();

/**
 * POST /analisar
 * Body: { xmls: string[] }   (conteúdo de cada arquivo .xml de evento Reinf)
 * Retorna: { eventos: [...analise por evento...], consolidacao: {...} }
 */
router.post('/analisar', requireAdmin, async (req, res) => {
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

/**
 * POST /irrf-r4010 — cruza o IRRF dos eventos R-4010 com o IRRF de PESSOA
 * FÍSICA declarado na DCTFWeb da competência.
 *
 * Body: { xmls: string[], empresaCnpj, anoPA, mesPA, categoria?, conjuntoCompleto? }
 *
 * A Reinf é a FONTE do IRRF de pagamento a PF e a DCTFWeb é alimentada por ela:
 * evento que não chegou vira débito a menos, ou seja recolhimento a menor — e
 * ninguém enxerga, porque são dois sistemas.
 *
 * `conjuntoCompleto` é AFIRMAÇÃO de quem clica, não dedução do app: sem ela o
 * cruzamento nunca dá verde, porque "não achei divergência" no que foi subido
 * não é o mesmo que "a competência está completa".
 */
router.post('/irrf-r4010', requireAdmin, async (req, res) => {
    try {
        const b = req.body || {};
        const xmls = Array.isArray(b.xmls) ? b.xmls : [];
        const empresaCnpj = String(b.empresaCnpj || '').replace(/\D/g, '');
        const anoPA = Number(b.anoPA);
        const mesPA = Number(b.mesPA);
        if (!xmls.length) return res.status(400).json({ error: 'Envie os XMLs dos eventos R-4010 em { xmls }.' });
        if (xmls.length > 500) return res.status(400).json({ error: 'Máximo de 500 eventos por chamada.' });
        if (empresaCnpj.length !== 14) return res.status(400).json({ error: 'Informe o CNPJ da empresa (14 dígitos).' });
        if (!Number.isInteger(anoPA) || !Number.isInteger(mesPA)) {
            return res.status(400).json({ error: 'Informe anoPA e mesPA da competência.' });
        }
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });

        const parsed = xmls.map((x) => parseEventoReinf(String(x || '')));
        const reinf = consolidarR4010(parsed);

        // Lado DCTFWeb: se a consulta falhar, NÃO vira zero — vira "não lido",
        // e o cruzamento devolve pergunta em vez de divergência inventada.
        let debitos = { lido: false, motivo: null, debitos: [] };
        try {
            debitos = await listarDebitosDeclaracao({
                empresaCnpj, anoPA, mesPA, categoria: b.categoria,
            });
        } catch (e) {
            debitos = { lido: false, motivo: e.message, debitos: [] };
        }
        const dctfweb = separarIrrfDctfweb(debitos.debitos || []);
        const cruzamento = cruzarIrrfR4010({
            reinf, dctfweb,
            dctfwebLido: !!debitos.lido,
            conjuntoCompleto: b.conjuntoCompleto === true,
        });

        return res.json({
            ok: true,
            competencia: `${anoPA}-${String(mesPA).padStart(2, '0')}`,
            empresaCnpj,
            reinf,
            dctfweb: { ...dctfweb, lido: !!debitos.lido, motivo: debitos.motivo || null },
            cruzamento,
        });
    } catch (e) {
        console.error('[efd-reinf/irrf-r4010]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

export default router;
