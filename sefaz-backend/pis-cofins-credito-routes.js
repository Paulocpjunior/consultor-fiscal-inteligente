// ============================================================================
// sefaz-backend/pis-cofins-credito-routes.js  (ESM)
//
// A base de crédito de PIS/COFINS derivada dos DOCUMENTOS, por empresa ×
// competência — e o backfill que a viabiliza.
//
//   GET  /api/admin/pis-cofins/base-credito?empresaId=&competencia=&baseUsada=
//   POST /api/admin/pis-cofins/backfill-cst   { empresaId, competencias[] }
//
// Ambas requireAdmin. O GET é CONSULTA PURA (não grava nada). O POST só
// COMPLETA campo vazio a partir do XML que já está no Storage — não fala com a
// SEFAZ, não consome NSU, não pede nada ao cliente.
//
// CONTEXTO (caso WALDESA, 12/08/2026): a apuração vivia em planilha aplicando
// 1,65%/7,6% sobre a conta contábil inteira de compras. Esta rota existe pra
// responder, com documento na mão, quanto daquela base tinha lastro.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { apurarBaseCredito, compararComBaseUsada, ALIQ_PIS, ALIQ_COFINS } from './pis-cofins-credito.js';
import { reprocessarCstDosItens } from './backfill-cst-itens.js';
// docCancelado + direcaoEfetivaDoc: as duas réguas da casa que NÃO se
// reimplementa aqui — reimplementar filtro é criar a divergência de novo.
import { docCancelado, direcaoEfetivaDoc } from './xml-metadata-helper.js';

const router = express.Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const COMPETENCIA_RX = /^\d{4}-\d{2}$/;

/**
 * Entradas VÁLIDAS da competência.
 *
 * Duas réguas da casa, e nenhuma pode ser reimplementada aqui:
 *   · `docCancelado` — cancelada não conta (a régua decide na LEITURA, porque
 *     o status gravado pode mentir);
 *   · `direcaoEfetivaDoc` — nota própria de entrada (tpNF=0) é ENTRADA mesmo
 *     tendo o cliente como emitente.
 */
async function carregarEntradas(db, empresaId, competencia) {
    const snap = await db.collection('documentos_fiscais')
        .where('empresaId', '==', empresaId)
        .where('competencia', '==', competencia)
        .get();

    const docs = [];
    let canceladas = 0, semItens = 0;
    snap.forEach((s) => {
        const d = s.data() || {};
        if (docCancelado(d)) { canceladas++; return; }
        if (direcaoEfetivaDoc(d) !== 'entrada') return;
        if (!Array.isArray(d.itens) || !d.itens.length) { semItens++; return; }
        docs.push(d);
    });
    return { docs, canceladas, semItens };
}

// ── GET base de crédito ─────────────────────────────────────────────────────
router.get('/base-credito', requireAdmin, async (req, res) => {
    try {
        const empresaId = String(req.query.empresaId || '').trim();
        const competencia = String(req.query.competencia || '').trim();
        if (!empresaId) return res.status(400).json({ erro: 'empresaId é obrigatório' });
        if (!COMPETENCIA_RX.test(competencia)) {
            return res.status(400).json({ erro: 'competencia inválida — use AAAA-MM (ex.: 2025-06)' });
        }

        const db = getDb();
        const { docs, canceladas, semItens } = await carregarEntradas(db, empresaId, competencia);

        // ZERO NUNCA É SUCESSO: sem entrada capturada o número não é "crédito
        // zero", é "não sei" — e dizer zero aqui mandaria o colaborador
        // concluir que não há crédito quando pode não haver CAPTURA.
        if (!docs.length) {
            return res.json({
                ok: true,
                empresaId, competencia,
                semDados: true,
                aviso: 'Nenhuma entrada com itens capturada nesta competência. Isso NÃO significa crédito zero: '
                    + 'confira a captura do cliente antes de concluir qualquer coisa.',
                documentosCancelados: canceladas,
                documentosSemItens: semItens,
            });
        }

        const apuracao = apurarBaseCredito(docs);
        const creditoPis = Number((apuracao.baseConfirmada * ALIQ_PIS).toFixed(2));
        const creditoCofins = Number((apuracao.baseConfirmada * ALIQ_COFINS).toFixed(2));

        const baseUsadaRaw = req.query.baseUsada;
        const comparacao = baseUsadaRaw !== undefined && baseUsadaRaw !== ''
            ? compararComBaseUsada(apuracao, Number(baseUsadaRaw))
            : null;

        return res.json({
            ok: true,
            empresaId, competencia,
            documentos: docs.length,
            documentosCancelados: canceladas,
            documentosSemItens: semItens,
            ...apuracao,
            creditoPis,
            creditoCofins,
            creditoTotal: Number((creditoPis + creditoCofins).toFixed(2)),
            comparacao,
        });
    } catch (e) {
        console.error('[pis-cofins/base-credito]', e);
        return res.status(500).json({ erro: e.message });
    }
});

// ── POST backfill do CST ────────────────────────────────────────────────────
router.post('/backfill-cst', requireAdmin, async (req, res) => {
    try {
        const empresaId = String(req.body?.empresaId || '').trim() || null;
        const competencias = Array.isArray(req.body?.competencias) ? req.body.competencias : [];
        for (const c of competencias) {
            if (!COMPETENCIA_RX.test(String(c))) {
                return res.status(400).json({ erro: `competência inválida: "${c}" — use AAAA-MM` });
            }
        }
        // Sem alvo, o backfill varreria a base inteira. Reprocessar tudo é caro
        // (uma leitura de Storage por documento) e ninguém pediu isso.
        if (!empresaId && !competencias.length) {
            return res.status(400).json({ erro: 'informe empresaId e/ou competencias — o backfill não roda na base inteira sem alvo' });
        }

        const log = await reprocessarCstDosItens({ empresaId, competencias, maxDocs: 20000 });
        return res.json({ ok: true, ...log });
    } catch (e) {
        console.error('[pis-cofins/backfill-cst]', e);
        return res.status(500).json({ erro: e.message });
    }
});

export default router;
