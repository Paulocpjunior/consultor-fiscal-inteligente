// ============================================================================
// sefaz-backend/sistema-banco-routes.js  (ESM)
//
// PAINEL SISTEMA → BANCO DE DADOS (dev-only). Pedido do Paulo (30/07):
// "controle muito acirrado sobre funcionalidade × banco de dados, algo
// visível que só eu como desenvolvedor posso ter acesso".
//
//   GET /api/admin/sistema/banco   (admin + trava opcional SISTEMA_DEV_EMAILS)
//
// O que devolve, por coleção REAL do Firestore (listCollections):
//   - dono do catálogo (grupo + funcionalidade) — catalogo-banco.js;
//   - contagem de documentos (aggregate count — barato);
//   - Δ desde o último snapshot diário (tendência de crescimento);
//   - órfãs: coleção real SEM dono no catálogo (âmbar — investigar);
//   - catalogadas sem uso (cinza — feature nunca rodou ou candidata a limpeza).
//
// Snapshot diário: gravado em sistema_banco_snapshots/{YYYY-MM-DD} na primeira
// abertura do dia (idempotente) — é o que dá o Δ de amanhã.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { CATALOGO_BANCO, catalogarColecoes, calcularDeltas } from './catalogo-banco.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

// Trava de DESENVOLVEDOR: além de admin, se SISTEMA_DEV_EMAILS estiver
// definida (csv), só os e-mails listados enxergam. Sem a env, todo admin vê.
function requireDev(req, res, next) {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas administradores' });
    }
    const lista = String(process.env.SISTEMA_DEV_EMAILS || '')
        .split(/[;,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (lista.length > 0 && !lista.includes(String(req.user.email || '').toLowerCase())) {
        return res.status(403).json({ error: 'Acesso restrito ao desenvolvedor (SISTEMA_DEV_EMAILS)' });
    }
    return next();
}

const hojeIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

router.get('/banco', requireAuth, requireDev, async (_req, res) => {
    try {
        const db = fa().firestore();

        // 1. Coleções REAIS na raiz do banco.
        const cols = await db.listCollections();
        const nomes = cols.map((c) => c.id).sort();

        // 2. Contagem por coleção (aggregate count — 1 leitura por até 1000
        //    docs contados; barato mesmo em documentos_fiscais).
        const counts = {};
        await Promise.all(nomes.map(async (nome) => {
            try {
                const snap = await db.collection(nome).count().get();
                counts[nome] = snap.data().count;
            } catch (e) {
                counts[nome] = null;
                console.warn(`[sistema-banco] count falhou em ${nome}:`, e.message);
            }
        }));

        // 3. Snapshot diário (Δ de crescimento). Lê o mais recente ANTERIOR a
        //    hoje pra comparar; grava o de hoje se ainda não existe.
        const hoje = hojeIso();
        let snapshotAnterior = null;
        let dataSnapshotAnterior = null;
        try {
            const prev = await db.collection('sistema_banco_snapshots')
                .orderBy('__name__', 'desc').limit(2).get();
            for (const d of prev.docs) {
                if (d.id !== hoje) { snapshotAnterior = d.data()?.counts || null; dataSnapshotAnterior = d.id; break; }
            }
            const hojeRef = db.collection('sistema_banco_snapshots').doc(hoje);
            const hojeSnap = await hojeRef.get();
            if (!hojeSnap.exists) {
                await hojeRef.set({ counts, criadoEm: admin.firestore.FieldValue.serverTimestamp() });
            }
        } catch (e) {
            console.warn('[sistema-banco] snapshot falhou:', e.message);
        }
        const deltas = calcularDeltas(snapshotAnterior, counts);

        // 4. Cruza com o catálogo.
        const { linhas, foraDoCatalogo, catalogadasSemUso } = catalogarColecoes(nomes);
        const linhasComNumeros = linhas.map((l) => ({
            ...l,
            docs: counts[l.colecao] ?? null,
            delta: deltas[l.colecao] ?? null,
        }));
        const orfas = foraDoCatalogo.map((nome) => ({
            colecao: nome,
            docs: counts[nome] ?? null,
            delta: deltas[nome] ?? null,
        }));

        return res.json({
            ok: true,
            geradoEm: new Date().toISOString(),
            snapshotAnterior: dataSnapshotAnterior,
            totalColecoes: nomes.length,
            totalDocs: Object.values(counts).reduce((a, b) => a + (b || 0), 0),
            totalCatalogadas: CATALOGO_BANCO.length,
            linhas: linhasComNumeros,
            orfas,
            catalogadasSemUso,
        });
    } catch (e) {
        console.error('[sistema-banco]', e);
        return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
    }
});

export default router;
