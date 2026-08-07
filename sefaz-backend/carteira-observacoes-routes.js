// ============================================================================
// sefaz-backend/carteira-observacoes-routes.js  (ESM)
// ----------------------------------------------------------------------------
// A OBSERVAÇÃO do colaborador sobre um cliente, na competência.
//
// Paulo, 07/08: o guia do mês deve trazer "detalhes e observações de cada
// cliente". Detalhe o app deriva sozinho (captura, prazo, ISS, cadastro) — mas
// observação é o que só a pessoa sabe: "cliente pediu prazo até dia 20",
// "aguardando o XML que o contador dele vai mandar".
//
// POR QUE UMA ROTA, e não escrita direta do cliente:
//
// As subcoleções de `simples_empresas`/`lucro_empresas` liberam escrita pelo
// `createdBy` da EMPRESA — quem cadastrou. O colaborador que recebeu o cliente
// na carteira quase nunca é quem cadastrou, então ele ficaria sem escrever
// justamente na tela que é o norte dele. E afrouxar a regra pra "qualquer
// logado" abriria a carteira inteira.
//
// O guard certo já existe: `podeAcessarEmpresaId` (carteira-auth.js) — admin
// vê tudo, colaborador só as empresas dele. É o mesmo que protege a Rotina.
//
// A observação NÃO É CADASTRO e não conserta cadastro (regra permanente de
// 06/08): campo em branco continua acendendo alerta na tela de cadastro. Isto
// aqui é recado de acompanhamento, e por isso fica separado, datado e assinado.
// ============================================================================

import { Router, json } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { podeAcessarEmpresaId, getEmpresaIdsDaCarteira } from './carteira-auth.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const COMPETENCIA = /^\d{4}-\d{2}$/;
const LIMITE_TEXTO = 2000;

/** 1 doc por empresa × competência — a observação é DO MÊS, não eterna. */
const docId = (empresaId, competencia) => `${empresaId}_${competencia}`;

// ── GET /api/admin/carteira/observacoes?competencia=AAAA-MM ─────────────────
// Todas as observações da competência que o usuário PODE ver (a carteira dele;
// admin vê todas). Uma leitura só — o guia do mês pinta ~400 linhas.
router.get('/observacoes', requireAuth, async (req, res) => {
    try {
        const competencia = String(req.query.competencia || '').trim();
        if (!COMPETENCIA.test(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência (AAAA-MM).' });
        }
        const db = getDb();
        const snap = await db.collection('carteira_observacoes')
            .where('competencia', '==', competencia).limit(2000).get();

        const idsCarteira = await getEmpresaIdsDaCarteira(req.user); // null = admin
        const permitidos = idsCarteira ? new Set(idsCarteira) : null;

        const observacoes = {};
        snap.forEach((d) => {
            const o = d.data() || {};
            if (permitidos && !permitidos.has(o.empresaId)) return;
            observacoes[o.empresaId] = {
                texto: o.texto || '',
                autorNome: o.autorNome || null,
                atualizadoEm: o.atualizadoEm?.toDate?.()?.toISOString() || null,
            };
        });
        return res.json({ ok: true, competencia, observacoes });
    } catch (e) {
        console.error('[carteira/observacoes GET]', e);
        return res.status(500).json({ ok: false, error: `Falha ao ler as observações: ${e.message}` });
    }
});

// ── POST /api/admin/carteira/observacoes ────────────────────────────────────
// { empresaId, competencia, texto }. Texto vazio APAGA (o colaborador precisa
// conseguir desfazer o recado; guardar string vazia deixaria um bloco vazio na
// tela e no PDF, parecendo que há observação quando não há).
router.post('/observacoes', requireAuth, json(), async (req, res) => {
    try {
        const { empresaId, competencia, texto } = req.body || {};
        if (!empresaId || !COMPETENCIA.test(String(competencia || ''))) {
            return res.status(400).json({ ok: false, error: 'empresaId e competencia (AAAA-MM) são obrigatórios.' });
        }
        const acesso = await podeAcessarEmpresaId(req.user, empresaId);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        const limpo = String(texto ?? '').trim().slice(0, LIMITE_TEXTO);
        const db = getDb();
        const ref = db.collection('carteira_observacoes').doc(docId(empresaId, competencia));

        if (!limpo) {
            await ref.delete().catch(() => {});
            return res.json({ ok: true, apagada: true });
        }
        await ref.set({
            empresaId,
            competencia,
            texto: limpo,
            // Quem escreveu e quando — recado sem assinatura vira boato.
            autorUid: req.user?.uid || null,
            autorNome: req.user?.name || req.user?.email || null,
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        return res.json({ ok: true, apagada: false });
    } catch (e) {
        console.error('[carteira/observacoes POST]', e);
        return res.status(500).json({ ok: false, error: `Falha ao salvar a observação: ${e.message}` });
    }
});

export default router;
