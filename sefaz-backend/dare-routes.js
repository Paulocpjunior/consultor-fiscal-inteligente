// ============================================================================
// sefaz-backend/dare-routes.js  (ESM)
// ----------------------------------------------------------------------------
// Rotas do DARE-SP (ICMS):
//   POST /api/admin/dare/preview   — valida e devolve o payload conferível
//                                    (mesmos campos do documento real).
//   POST /api/admin/dare/registrar — registra a solicitação de emissão em
//                                    dare_solicitacoes (auditoria: quem/quando/
//                                    o quê) ANTES de o time emitir no portal.
//
// Emissão de verdade: portal DARE (hoje) ou API oficial SEFAZ-SP (quando o
// credenciamento sair — api_dare_icms@fazenda.sp.gov.br). NUNCA geramos
// número/código de barras localmente: isso é do sistema da SEFAZ.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth, requireAdmin } from './require-admin.js';
import { montarDare, derivacoesDisponiveis, CODIGOS_DARE_ICMS, montarLoteTxt } from './dare-sp.js';
import { reconhecerPortalDare } from './dare-recon.js';

const router = Router();

function fa() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin;
}

router.post('/preview', requireAuth, async (req, res) => {
  try {
    const { cnpj, razaoSocial, codigoServico, referencia, valor, vencimento } = req.body || {};
    const payload = montarDare({ cnpj, razaoSocial, codigoServico, referencia, valor, vencimento });
    return res.json({ ok: true, payload });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/codigos', requireAuth, (req, res) => {
  const regime = String(req.query.regime || '').toLowerCase();
  return res.json({
    ok: true,
    codigos: regime ? derivacoesDisponiveis(regime) : Object.values(CODIGOS_DARE_ICMS),
  });
});

router.post('/registrar', requireAuth, async (req, res) => {
  try {
    const { cnpj, razaoSocial, codigoServico, referencia, valor, vencimento, empresaId } = req.body || {};
    // Revalida TUDO no registro — auditoria nunca grava payload inválido.
    const payload = montarDare({ cnpj, razaoSocial, codigoServico, referencia, valor, vencimento });
    const db = fa().firestore();
    const doc = await db.collection('dare_solicitacoes').add({
      ...payload,
      empresaId: empresaId || null,
      solicitadoPor: req.user?.email || req.user?.uid || 'desconhecido',
      solicitadoEm: admin.firestore.FieldValue.serverTimestamp(),
      // status do ciclo: 'gerada-no-app' → equipe emite no portal → pode ser
      // conciliada depois (futuro: emissão direta via API oficial).
      status: 'gerada-no-app',
    });
    console.log(`[dare] solicitacao ${doc.id} ${payload.codigoServico} ${payload.contribuinte.cnpj} ${payload.referencia} R$${payload.valor} por ${req.user?.email}`);
    return res.json({ ok: true, id: doc.id, payload });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

// Lote TXT do "Dare em Lote" (ICMS declarado em massa — formato documentado
// na própria página do portal). Valida TUDO (um item ruim aborta o lote) e
// registra a auditoria do lote inteiro. A emissão continua no portal (humano
// cola o TXT e resolve o reCAPTCHA; o portal gera o ZIP com os DAREs).
router.post('/lote-txt', requireAuth, async (req, res) => {
  try {
    const itens = req.body?.itens;
    const lote = montarLoteTxt(itens);
    const db = fa().firestore();
    const doc = await db.collection('dare_solicitacoes').add({
      tipo: 'lote-txt',
      totalDocs: lote.linhas.length,
      totalValor: lote.totalValor,
      linhas: lote.linhas,
      solicitadoPor: req.user?.email || req.user?.uid || 'desconhecido',
      solicitadoEm: admin.firestore.FieldValue.serverTimestamp(),
      status: 'lote-gerado-no-app',
    });
    console.log(`[dare] lote ${doc.id}: ${lote.linhas.length} guia(s), R$${lote.totalValor} por ${req.user?.email}`);
    return res.json({ ok: true, id: doc.id, ...lote });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

// Reconhecimento do portal DARE (somente leitura, admin): estrutura real das
// páginas DareAvulso/DareLote/GnreLote — o ground-truth pra automação (lote
// XML-GNRE / POST unitário) sem chutar contrato. Roda NO Cloud Run porque o
// ambiente de dev não alcança a fazenda.sp.gov.br.
router.get('/recon', requireAdmin, async (_req, res) => {
  try {
    const r = await reconhecerPortalDare();
    return res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[dare/recon] erro:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
