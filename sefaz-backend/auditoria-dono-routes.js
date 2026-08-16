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

        const relatorio = montarAuditoria({ leituras, de, ate, quemFiltro });
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

export default router;
