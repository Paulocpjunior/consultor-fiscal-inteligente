// ============================================================================
// sefaz-backend/agent-admin-routes.js
// ----------------------------------------------------------------------------
// Rotas ADMIN pra gerenciar API keys do agente cfi-a3.
//
// Endpoints:
//   POST   /agent-keys          — admin gera uma key pra um colaborador
//   GET    /agent-keys          — lista todas as keys (sem expor hashes)
//   DELETE /agent-keys/:keyId   — revoga uma key
//
// Também: rota pra marcar empresa como tipoCert='A1'|'A3' em empresas_certificados.
//   PATCH  /cert-empresa/tipo   — { empresaId, tipoCert }
//
// Todas exigem requireAdmin (token Firebase + role admin).
// ============================================================================
import express from 'express';
import admin from 'firebase-admin';
import { gerarAgentKey, listarAgentKeys, revogarAgentKey } from './agent-keys-storage.js';
import { requireAdmin } from './require-admin.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

// ── POST /agent-keys — gera uma key nova ─────────────────────────────────
router.post('/agent-keys', requireAdmin, async (req, res) => {
    try {
        const { ownerUid, label } = req.body || {};
        if (!ownerUid) return res.status(400).json({ error: 'ownerUid obrigatório' });

        // Carrega email do owner pra denormalização
        const ownerSnap = await fa().firestore().collection('users').doc(ownerUid).get();
        if (!ownerSnap.exists) return res.status(404).json({ error: 'Colaborador não encontrado' });
        const ownerEmail = ownerSnap.data().email || null;

        const result = await gerarAgentKey({
            ownerUid,
            ownerEmail,
            label: label || `Agent ${new Date().toISOString().slice(0, 10)}`,
            createdBy: req.user.uid,
        });

        return res.json({
            ok: true,
            keyId: result.keyId,
            apiKey: result.rawKey,
            warning: 'Esta key só é exibida UMA VEZ. Copie agora.',
        });
    } catch (e) {
        console.error('[agent-keys POST] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ── GET /agent-keys — lista todas (sem hashes) ───────────────────────────
router.get('/agent-keys', requireAdmin, async (req, res) => {
    try {
        const lista = await listarAgentKeys();
        return res.json({ ok: true, keys: lista });
    } catch (e) {
        console.error('[agent-keys GET] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ── DELETE /agent-keys/:keyId — revoga ────────────────────────────────────
router.delete('/agent-keys/:keyId', requireAdmin, async (req, res) => {
    try {
        await revogarAgentKey(req.params.keyId);
        return res.json({ ok: true });
    } catch (e) {
        console.error('[agent-keys DELETE] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ── PATCH /cert-empresa/tipo — marca empresa como A1 ou A3 ───────────────
// Pra A3, o admin SOBE o cert (igual A1) só pra registrar o titular/CNPJ,
// OU pode marcar como A3 sem subir cert (basta gravar metadado).
// Implementação: simplesmente atualiza o campo `tipoCert` em
// empresas_certificados/{empresaId}. Se o doc não existir, cria mínimo.
router.patch('/cert-empresa/tipo', requireAdmin, async (req, res) => {
    try {
        const { empresaId, tipoCert } = req.body || {};
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatório' });
        if (tipoCert !== 'A1' && tipoCert !== 'A3') {
            return res.status(400).json({ error: 'tipoCert deve ser A1 ou A3' });
        }

        const ref = fa().firestore().collection('empresas_certificados').doc(empresaId);
        const snap = await ref.get();
        if (!snap.exists) {
            // Cria registro mínimo (sem .pfx — válido só pra A3, que não tem .pfx)
            await ref.set({
                empresaId,
                tipoCert,
                criadoEm: admin.firestore.FieldValue.serverTimestamp(),
                criadoPor: req.user.email,
            }, { merge: true });
        } else {
            await ref.update({
                tipoCert,
                atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
                atualizadoPor: req.user.email,
            });
        }

        return res.json({ ok: true, empresaId, tipoCert });
    } catch (e) {
        console.error('[cert-empresa/tipo] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

export default router;
