// ============================================================================
// sefaz-backend/credito-outras-routes.js
// ----------------------------------------------------------------------------
//   POST   /api/credito-outras-despesas/:docId   { itens:[{indice, ipi, st}], motivo }
//   DELETE /api/credito-outras-despesas/:docId   { motivo? }
//
// 💳 Grava (ou desfaz) o crédito de IPI / ICMS-ST que veio em "Outras
// despesas" — ver `credito-outras-despesas.js` (decisão do Paulo, 08/10: no
// próprio documento, carimbado). O XML guardado NÃO muda: o ajuste mora no
// campo `ajusteCreditoOutrasDespesas` e a escrituração o aplica ao ler.
//
// Cada gravação e cada desfazer fica no histórico do documento (autor, data,
// motivo) — um ajuste fiscal que some sem rastro não se audita.
//
// 🔒 Competência FECHADA no Fim de Mês não aceita o ajuste: mexer no valor
// mudaria o arquivo que o fechamento congelou. A resposta diz onde reabrir.
// ============================================================================
import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { podeAcessarEmpresaId } from './carteira-auth.js';
import { docRetiradoDoAcervo } from './xml-metadata-helper.js';
import { lerFechamentoDaCompetencia } from './fechamento-store.js';
import { competenciaFechada } from './fim-de-mes.js';
import { validarAjusteCreditoOutras } from './credito-outras-despesas.js';

// O corpo JSON já chega parseado pelo parser global do server.js.
const router = Router();

/** Lê o documento e confere acesso, lápide e fechamento. */
async function carregarParaAjuste(req, res) {
    const docId = String(req.params?.docId || '').trim();
    if (!docId) { res.status(400).json({ ok: false, erro: 'Documento não informado.' }); return null; }
    const db = admin.firestore();
    const ref = db.collection('documentos_fiscais').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ ok: false, erro: 'Documento não encontrado.' }); return null; }
    const doc = { id: snap.id, ...(snap.data() || {}) };
    if (req.user?.role !== 'admin') {
        const check = await podeAcessarEmpresaId(req.user, doc.empresaId);
        if (!check.ok) { res.status(check.status || 403).json({ ok: false, erro: check.error }); return null; }
    }
    if (docRetiradoDoAcervo(doc)) {
        res.status(409).json({ ok: false, erro: 'Este documento foi retirado do acervo (excluído ou mesclado) — não se ajusta.' });
        return null;
    }
    const fechamento = await lerFechamentoDaCompetencia(db, doc.empresaId, doc.competencia);
    if (competenciaFechada(fechamento)) {
        res.status(409).json({
            ok: false,
            erro: `A competência ${doc.competencia} está FECHADA no Fim de Mês`
                + `${fechamento.fechadoPor?.email ? ` (por ${fechamento.fechadoPor.email})` : ''}. `
                + 'Reabra a competência na Rotina do Mês → Fim de Mês para lançar ou desfazer o crédito.',
        });
        return null;
    }
    return { ref, doc };
}

const quem = (user) => ({ uid: user?.uid || null, email: user?.email || null });

router.post('/:docId', requireAuth, async (req, res) => {
    try {
        const alvo = await carregarParaAjuste(req, res);
        if (!alvo) return undefined;
        const v = validarAjusteCreditoOutras(alvo.doc, req.body || {});
        if (!v.ok) return res.status(400).json({ ok: false, erros: v.erros, erro: v.erros.join(' ') });

        const em = new Date().toISOString();
        const ajuste = { ...v.ajuste, autor: quem(req.user), em };
        await alvo.ref.update({
            ajusteCreditoOutrasDespesas: ajuste,
            ajusteCreditoOutrasDespesasHistorico: admin.firestore.FieldValue.arrayUnion({
                acao: alvo.doc.ajusteCreditoOutrasDespesas ? 'substituido' : 'lancado',
                ...ajuste,
            }),
        });
        return res.json({ ok: true, ajuste });
    } catch (e) {
        console.error('[credito-outras-despesas/gravar]', e);
        return res.status(500).json({ ok: false, erro: e?.message || 'Falha ao gravar o crédito.' });
    }
});

router.delete('/:docId', requireAuth, async (req, res) => {
    try {
        const alvo = await carregarParaAjuste(req, res);
        if (!alvo) return undefined;
        const anterior = alvo.doc.ajusteCreditoOutrasDespesas;
        if (!anterior) return res.status(404).json({ ok: false, erro: 'Esta nota não tem crédito de outras despesas lançado.' });
        const em = new Date().toISOString();
        await alvo.ref.update({
            ajusteCreditoOutrasDespesas: admin.firestore.FieldValue.delete(),
            ajusteCreditoOutrasDespesasHistorico: admin.firestore.FieldValue.arrayUnion({
                acao: 'desfeito',
                itens: anterior.itens || [],
                total: anterior.total ?? null,
                motivo: String(req.body?.motivo || '').trim() || null,
                autor: quem(req.user),
                em,
            }),
        });
        return res.json({ ok: true });
    } catch (e) {
        console.error('[credito-outras-despesas/desfazer]', e);
        return res.status(500).json({ ok: false, erro: e?.message || 'Falha ao desfazer o crédito.' });
    }
});

export default router;
