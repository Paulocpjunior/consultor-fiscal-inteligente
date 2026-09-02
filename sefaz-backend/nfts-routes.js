// ============================================================================
// sefaz-backend/nfts-routes.js  (ESM)
//
// A VOLTA da NFTS: lê o export do portal e cruza com os serviços tomados que o
// CFI capturou, pra achar onde falta NFTS.
//
//   POST /api/admin/nfts/cruzamento   (multipart: csv + empresaId + competencia)
//
// requireAdmin. CONSULTA PURA — não grava nada. O módulo NFTS existente faz a
// IDA (PDFs → TXT do lote pra emitir na PMSP); esta rota fecha o ciclo.
//
// CONTEXTO (12/08/2026): o export de 07/2026 veio com `Total;0` e depois com 3
// NFTS — duas delas DUPLICADAS. Zero NFTS é ambíguo ("não tomou" × "tomou e não
// emitiu") e é essa ambiguidade que a rota resolve.
// ============================================================================

import express from 'express';
import multer from 'multer';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { parseCsvNftsSp } from './nfts-sp-csv-parser.js';
import { cruzarServicosComNfts } from './nfts-cruzamento.js';
import {
    dataDeclaradaDoDocumento, docCancelado, direcaoEfetivaDoc, issRetidoDoDocumento,
} from './xml-metadata-helper.js';
import { ehNotaDeServico } from './sped-selecao-documentos.js';

const router = express.Router();
const uploadCsv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const COMPETENCIA_RX = /^\d{4}-\d{2}$/;

/**
 * Serviços TOMADOS da competência (NFS-e de entrada).
 *
 * Mesma forma que `linhasServicos` do front usa — e a MESMA régua de cancelada
 * (`docCancelado`), que não se reimplementa.
 */
async function carregarServicosTomados(db, empresaId, competencia) {
    const snap = await db.collection('documentos_fiscais')
        .where('empresaId', '==', empresaId)
        .where('competencia', '==', competencia)
        .get();

    const out = [];
    snap.forEach((s) => {
        const d = s.data() || {};
        if (docCancelado(d)) return;
        // 🚨 `d.tipo !== 'NFSe'` era a forma MAIS RARA: a NFS-e do ADN grava
        // `tipo: 'nfseNacional'` e sumia da declaração de serviços TOMADOS —
        // que é justamente onde entra o prestador de fora do município.
        if (!ehNotaDeServico(d)) return;
        if (direcaoEfetivaDoc(d) !== 'entrada') return;
        const parte = d.prestador || d.emitente || {};
        const v = d.valores || {};
        out.push({
            numero: d.numero || '—',
            // 🚨 `.slice(0, 10)` só acerta a forma ISO: sobre a do portal de SP
            // (`11/05/2026 14:31:31`) ele devolve `11/05/2026`, que NÃO é data
            // ISO — e vai para uma DECLARAÇÃO da prefeitura. Quem lê é o DONO.
            data: dataDeclaradaDoDocumento(d.dhEmi),
            participante: parte.nome || '—',
            doc: String(parte.cnpjCpf || '').replace(/\D/g, ''),
            municipio: parte.municipio || '',
            codMunIBGE: parte.codMunIBGE || d.codMunIBGE || '',
            origem: d.origem || '',
            base: v.baseCalculo ?? d.valorTotal ?? 0,
            // O ISS retido também tem quatro formas — lido pelo DONO.
            issRetido: Number.isFinite(issRetidoDoDocumento(d)) ? issRetidoDoDocumento(d) : 0,
        });
    });
    return out;
}

router.post('/cruzamento', requireAdmin, uploadCsv.single('csv'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ erro: 'Envie o CSV exportado do portal no campo "csv".' });
        const empresaId = String(req.body?.empresaId || '').trim();
        const competencia = String(req.body?.competencia || '').trim();
        if (!empresaId) return res.status(400).json({ erro: 'empresaId é obrigatório' });
        if (!COMPETENCIA_RX.test(competencia)) {
            return res.status(400).json({ erro: 'competencia inválida — use AAAA-MM (ex.: 2026-07)' });
        }

        let parsed;
        try {
            parsed = parseCsvNftsSp(req.file.buffer);
        } catch (e) {
            return res.status(400).json({ erro: `Arquivo não pôde ser lido: ${e.message}` });
        }
        if (parsed.colunasFaltando.length) {
            return res.status(400).json({
                erro: 'Este arquivo não parece o export de NFTS do portal — faltam colunas essenciais: '
                    + parsed.colunasFaltando.join(', ') + '. Exporte de novo pela consulta de NFTS.',
            });
        }

        const db = getDb();
        const servicos = await carregarServicosTomados(db, empresaId, competencia);
        const cruzamento = cruzarServicosComNfts(servicos, parsed.notas);

        return res.json({
            ok: true,
            empresaId, competencia,
            arquivo: {
                nome: req.file.originalname,
                colunas: parsed.colunas,
                nftsLidas: parsed.notas.length,
                totalDeclarado: parsed.totalDeclarado,
                valorServicosDeclarado: parsed.valorServicosDeclarado,
                valorIssDeclarado: parsed.valorIssDeclarado,
                periodoSemNfts: parsed.periodoSemNfts,
                acao: parsed.acao,
                // Duplicidade é achado do ARQUIVO, independe do cruzamento.
                duplicadas: parsed.duplicadas,
            },
            ...cruzamento,
        });
    } catch (e) {
        console.error('[nfts/cruzamento]', e);
        return res.status(500).json({ erro: e.message });
    }
});

export default router;
