// ============================================================================
// sefaz-backend/auditoria-dono-routes.js  (ESM)
// Montado em /api/admin/auditoria-dono pelo server.js.
// ----------------------------------------------------------------------------
//   GET /                — relatório consolidado (só o DONO)
//   GET /acesso          — "eu vejo este painel?" (o front pergunta antes de
//                          desenhar o botão; a resposta NÃO revela a lista)
//
// A trava é DUPLA e o backend é o dono dela: `requireAdmin` (a rota vive sob
// o guarda-chuva de admin) + `ehDono` pelo e-mail. Esconder no front seria
// enfeite — quem sabe a URL chamaria a rota direto.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { TRILHAS, montarAuditoria, ehDono } from './auditoria-dono.js';
import { TIPOS_ATO, normalizarAto, montarDesempenho, periodoPadrao } from './desempenho-colaboradores.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

/** Só o dono. A recusa NÃO diz quem é dono (não é lista de alvos). */
function requireDono(req, res, next) {
    if (!ehDono(req.user?.email)) {
        return res.status(403).json({
            ok: false,
            error: 'Este relatório é restrito ao dono do escritório.',
        });
    }
    return next();
}

router.get('/acesso', requireAdmin, (req, res) => {
    return res.json({ ok: true, tenho: ehDono(req.user?.email) });
});

router.get('/', requireAdmin, requireDono, async (req, res) => {
    try {
        const db = getDb();
        const de = String(req.query.de || '').trim() || null;
        const ate = String(req.query.ate || '').trim() || null;
        const quemFiltro = String(req.query.quem || '').trim() || null;

        // Cada trilha é lida em SEPARADO de propósito: uma que falhe não
        // derruba o relatório inteiro — ela entra em `naoLidas` e o total
        // sai marcado como incompleto (zero silencioso é o defeito caro).
        const leituras = await Promise.all(TRILHAS.map(async (trilha) => {
            try {
                const snap = await db.collection(trilha.colecao).limit(1000).get();
                return { trilha, docs: snap.docs.map((d) => ({ id: d.id, dados: d.data() })) };
            } catch (e) {
                console.warn(`[auditoria-dono] trilha ${trilha.colecao} não lida:`, e.message);
                return { trilha, erro: e.message };
            }
        }));

        // SÓ O CFI: `users` é o cadastro central de todos os módulos e
        // `carteiras` diz quem é do Fiscal — o recorte precisa dos dois.
        const [usuariosSnap, carteirasSnap] = await Promise.all([
            db.collection('users').get(),
            db.collection('carteiras').get(),
        ]);
        const escopo = {
            usuarios: usuariosSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })),
            vinculos: carteirasSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })),
        };
        const relatorio = montarAuditoria({ leituras, de, ate, quemFiltro, escopo });
        return res.json({
            ok: true,
            periodo: { de, ate, quem: quemFiltro },
            geradoEm: new Date().toISOString(),
            geradoPor: req.user?.email || null,
            trilhas: TRILHAS.map((t) => ({ id: t.id, rotulo: t.rotulo, peso: t.peso, desde: t.desde })),
            ...relatorio,
            // A lista completa pesa; a tela mostra as últimas e o PDF sai
            // com o mesmo recorte DITO (lista cortada sempre diz X de N).
            eventos: relatorio.eventos.slice(0, 300),
            eventosMostrados: Math.min(300, relatorio.eventos.length),
        });
    } catch (e) {
        console.error('[auditoria-dono]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /desempenho?de=ISO&ate=ISO — 📊 colaborador × empresa × tipo de ato.
//
// Paulo, 22/09: "o que cada colaborador efetivamente executou nos últimos 2
// meses". Cada trilha é lida em separado (uma que falhe entra em `naoLidas`,
// nunca vira zero). Trilha com data em Timestamp/ISO é lida por RANGE no
// próprio Firestore; a de documentos importados à mão é lida por
// `origem == 'manual'` e cortada em memória (a data mora em três campos).
// ────────────────────────────────────────────────────────────────────────────
const TETO_POR_TRILHA = 5000;

function paraTimestamp(iso) {
    return admin.firestore.Timestamp.fromDate(new Date(iso));
}

async function lerTrilha(db, tipo, { de, ate }) {
    let q = db.collection(tipo.colecao);
    if (tipo.filtroIgual) {
        for (const [k, v] of Object.entries(tipo.filtroIgual)) q = q.where(k, '==', v);
    }
    if (tipo.leituraPorRange && tipo.campoData?.[0]) {
        const campo = tipo.campoData[0];
        if (tipo.tipoData === 'timestamp') {
            q = q.where(campo, '>=', paraTimestamp(de)).where(campo, '<=', paraTimestamp(ate));
        } else {
            q = q.where(campo, '>=', de).where(campo, '<=', ate);
        }
    }
    const snap = await q.limit(TETO_POR_TRILHA).get();
    return {
        docs: snap.docs.map((d) => normalizarAto(tipo, d.id, d.data())),
        truncada: snap.size >= TETO_POR_TRILHA,
    };
}

router.get('/desempenho', requireAdmin, requireDono, async (req, res) => {
    try {
        const db = getDb();
        const padrao = periodoPadrao(2);
        const de = String(req.query.de || '').trim() || padrao.de;
        const ate = String(req.query.ate || '').trim() || padrao.ate;
        if (Number.isNaN(Date.parse(de)) || Number.isNaN(Date.parse(ate))) {
            return res.status(400).json({ ok: false, error: 'de/ate devem ser datas ISO' });
        }

        const [usuariosSnap, carteirasSnap] = await Promise.all([
            db.collection('users').get(),
            db.collection('carteiras').get(),
        ]);
        const usuarios = usuariosSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        const vinculos = carteirasSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

        const naoLidas = [];
        const truncadas = [];
        const atos = [];
        await Promise.all(TIPOS_ATO.map(async (tipo) => {
            try {
                const r = await lerTrilha(db, tipo, { de, ate });
                atos.push(...r.docs);
                if (r.truncada) truncadas.push(tipo.rotulo);
            } catch (e) {
                console.warn(`[auditoria-dono/desempenho] trilha ${tipo.colecao} não lida:`, e.message);
                naoLidas.push({ tipo: tipo.id, rotulo: tipo.rotulo, motivo: e.message });
            }
        }));

        const relatorio = montarDesempenho({ atos, usuarios, vinculos, naoLidas, de, ate });
        if (truncadas.length) {
            relatorio.ressalvas.unshift(`⚠️ ${truncadas.join(', ')}: leitura cortada em ${TETO_POR_TRILHA} registros — o total dessa(s) trilha(s) é PARCIAL.`);
        }
        return res.json({
            ok: true,
            geradoEm: new Date().toISOString(),
            geradoPor: req.user?.email || null,
            tipos: TIPOS_ATO.map((t) => ({ id: t.id, rotulo: t.rotulo, grupo: t.grupo, desde: t.desde, carimbaQuem: t.carimbaQuem })),
            ...relatorio,
        });
    } catch (e) {
        console.error('[auditoria-dono/desempenho]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
