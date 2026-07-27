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
import { montarDare, derivacoesDisponiveis, CODIGOS_DARE_ICMS, montarLoteTxt, montarLinhaLoteTxt, MAX_DOCS_LOTE_DARE } from './dare-sp.js';
import { reconhecerPortalDare } from './dare-recon.js';
import {
  listarReceitas, emitirDareUnitario, emitirDareLote, montarDareApiDTO,
  resolverAmbiente, AMBIENTE_PADRAO, resumirRetornoDare,
} from './dare-icms-api.js';

const router = Router();

function fa() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin;
}

router.post('/preview', requireAuth, async (req, res) => {
  try {
    const { cnpj, razaoSocial, codigoServico, referencia, valor, vencimento } = req.body || {};
    const payload = montarDare({ cnpj, razaoSocial, codigoServico, referencia, valor, vencimento });
    // linhaTxt: a MESMA página de colar TXT do portal aceita 1 linha só —
    // é o caminho rápido da emissão INDIVIDUAL (colaborador cola 1 linha em
    // vez de digitar 6 campos no formulário unitário). Serviço bloqueado em
    // lote → linhaTxt null (cai no unitário mesmo).
    let linhaTxt = null;
    try {
      linhaTxt = montarLinhaLoteTxt({ cnpj, razaoSocial, codigoServico, referencia, valor, vencimento });
    } catch { /* serviço fora do lote — sem linha */ }
    return res.json({ ok: true, payload, linhaTxt });
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

// ── Web API oficial DARE-ICMS (credenciamento 27/07/2026) ──────────────────
// A emissão sai do portal e passa a ser feita pela API: o número e o código de
// barras continuam vindo da SEFAZ, mas chegam direto no app.
//
//   GET  /api/admin/dare/api/receitas?ambiente=  — teste de fumaça da chave
//   POST /api/admin/dare/api/emitir              — 1 DARE
//   POST /api/admin/dare/api/emitir-lote         — até 50 DAREs
//
// Produção exige confirmação EXPLÍCITA no corpo (confirmoProducao: true):
// DARE de produção é cobrança de verdade, pagável na rede bancária.

/**
 * Guarda o PDF do DARE (documentoImpressao, base64) no Storage. Firestore não
 * serve pra isso (teto de 1 MiB por doc) e o PDF é o comprovante que o cliente
 * recebe — some daqui, some do rito de envio.
 * Falha ao salvar NÃO derruba a emissão (o DARE já existe na SEFAZ): devolve
 * null e o log fica sem o caminho.
 */
async function salvarBase64NoStorage(base64, caminho) {
  if (!base64) return null;
  try {
    const bucket = fa().storage().bucket();
    const arquivo = bucket.file(caminho);
    await arquivo.save(Buffer.from(base64, 'base64'), {
      contentType: caminho.endsWith('.zip') ? 'application/zip' : 'application/pdf',
      resumable: false,
    });
    return caminho;
  } catch (e) {
    console.warn('[dare/api] falha salvando arquivo no Storage:', e.message);
    return null;
  }
}

function salvarPdfDare(resposta, id, ambiente) {
  const item = resposta?.itensParaGeracao?.[0] || resposta || {};
  return salvarBase64NoStorage(item.documentoImpressao, `dares/${ambiente}/${id}.pdf`);
}

function salvarZipLote(resposta, id, ambiente) {
  return salvarBase64NoStorage(resposta?.zipDownload, `dares/${ambiente}/${id}-lote.zip`);
}

/** Só admin emite guia — mesma régua do envio de imposto (#293). */
function checarProducao(req) {
  const ambiente = String(req.body?.ambiente || req.query?.ambiente || AMBIENTE_PADRAO).toLowerCase();
  if (ambiente === 'producao' && req.body?.confirmoProducao !== true) {
    const err = new Error(
      'Emissão em PRODUÇÃO exige confirmação explícita: o DARE gerado é válido e pagável. '
      + 'Confirme na tela (ou envie confirmoProducao: true) para seguir.',
    );
    err.precisaConfirmar = true;
    throw err;
  }
  return ambiente;
}

router.get('/api/receitas', requireAdmin, async (req, res) => {
  try {
    const ambiente = String(req.query.ambiente || AMBIENTE_PADRAO).toLowerCase();
    const receitas = await listarReceitas({ ambiente });
    return res.json({ ok: true, ambiente, rotulo: resolverAmbiente(ambiente).rotulo, receitas });
  } catch (e) {
    console.error('[dare/api/receitas]', e.message);
    return res.status(e.httpStatus && e.httpStatus < 500 ? 400 : 502).json({ ok: false, error: e.message });
  }
});

router.post('/api/emitir', requireAdmin, async (req, res) => {
  try {
    const ambiente = checarProducao(req);
    const { cnpj, razaoSocial, codigoServico, referencia, valor, vencimento, linha06, linha08, gerarPDF, empresaId } = req.body || {};
    // Revalida pelo montarDare (mesma régua do preview: código de serviço
    // conhecido, referência/vencimento/valor coerentes) ANTES de chamar a API.
    const preview = montarDare({ cnpj, razaoSocial, codigoServico, referencia, valor, vencimento });
    const dto = montarDareApiDTO({
      cnpj, razaoSocial: razaoSocial || preview.contribuinte?.razaoSocial,
      codigoServico, codigoReceita: preview.codigoReceita,
      referencia: preview.referencia, valor: preview.valor,
      dataVencimento: preview.vencimento, linha06, linha08, gerarPDF,
    });

    const db = fa().firestore();
    const logRef = await db.collection('dare_solicitacoes').add({
      ...preview,
      empresaId: empresaId || null,
      ambiente,
      linha06: dto.linha06 || null,
      linha08: dto.linha08 || null,
      solicitadoPor: req.user?.email || req.user?.uid || 'desconhecido',
      solicitadoEm: admin.firestore.FieldValue.serverTimestamp(),
      status: 'emitindo-via-api',
    });

    try {
      const resposta = await emitirDareUnitario(dto, { ambiente });
      // O comprovante (número, barras, Pix) vai pra auditoria; o PDF é grande
      // demais pro Firestore (limite de 1 MiB por doc) e vai pro Storage.
      const resumo = resumirRetornoDare(resposta);
      const pdfPath = await salvarPdfDare(resposta, logRef.id, ambiente);
      await logRef.update({
        status: 'emitida-via-api',
        emitidaEm: admin.firestore.FieldValue.serverTimestamp(),
        comprovante: resumo,
        pdfPath: pdfPath || null,
      });
      return res.json({ ok: true, id: logRef.id, ambiente, preview, comprovante: resumo, pdfPath, retorno: resposta });
    } catch (erroApi) {
      // Rede caiu no meio do POST: NÃO dá pra afirmar que falhou — a SEFAZ
      // pode ter criado a guia e só a resposta ter se perdido. Marcar como
      // 'falha-api' aqui levaria alguém a reemitir e duplicar o DARE.
      await logRef.update({
        status: erroApi.indeterminado ? 'indeterminado' : 'falha-api',
        erro: String(erroApi.message || erroApi).slice(0, 800),
        falhouEm: admin.firestore.FieldValue.serverTimestamp(),
      });
      throw erroApi;
    }
  } catch (e) {
    const status = e.precisaConfirmar ? 428
      : e.indeterminado ? 504
      : (e.camposInvalidos || !e.httpStatus ? 400 : 502);
    return res.status(status).json({
      ok: false, error: e.message,
      camposInvalidos: e.camposInvalidos || null,
      indeterminado: !!e.indeterminado,
    });
  }
});

router.post('/api/emitir-lote', requireAdmin, async (req, res) => {
  try {
    const ambiente = checarProducao(req);
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
    if (itens.length === 0) return res.status(400).json({ ok: false, error: 'Informe ao menos um DARE no lote.' });
    if (itens.length > MAX_DOCS_LOTE_DARE) {
      return res.status(400).json({ ok: false, error: `O lote aceita no máximo ${MAX_DOCS_LOTE_DARE} guias — divida o envio.` });
    }

    // Um item inválido aborta o lote inteiro (nunca emitir metade).
    const previews = itens.map((it) => montarDare(it));
    const dtos = itens.map((it, i) => montarDareApiDTO({
      cnpj: it.cnpj, razaoSocial: it.razaoSocial || previews[i].contribuinte?.razaoSocial,
      codigoServico: it.codigoServico, codigoReceita: previews[i].codigoReceita,
      referencia: previews[i].referencia,
      valor: previews[i].valor, dataVencimento: previews[i].vencimento,
      linha06: it.linha06, linha08: it.linha08, gerarPDF: req.body?.gerarPDF,
    }));

    const db = fa().firestore();
    const logRef = await db.collection('dare_solicitacoes').add({
      tipo: 'lote-api',
      ambiente,
      totalDocs: dtos.length,
      totalValor: previews.reduce((s, p) => s + Number(p.valor || 0), 0),
      solicitadoPor: req.user?.email || req.user?.uid || 'desconhecido',
      solicitadoEm: admin.firestore.FieldValue.serverTimestamp(),
      status: 'emitindo-via-api',
    });

    try {
      const resposta = await emitirDareLote(dtos, { ambiente });
      const zipPath = await salvarZipLote(resposta, logRef.id, ambiente);
      await logRef.update({
        status: 'emitida-via-api',
        emitidaEm: admin.firestore.FieldValue.serverTimestamp(),
        comprovantes: (resposta?.itensParaGeracao || []).map(resumirRetornoDare).slice(0, 50),
        zipPath: zipPath || null,
      });
      return res.json({ ok: true, id: logRef.id, ambiente, total: dtos.length, zipPath, retorno: resposta });
    } catch (erroApi) {
      await logRef.update({
        status: erroApi.indeterminado ? 'indeterminado' : 'falha-api',
        erro: String(erroApi.message || erroApi).slice(0, 800),
        falhouEm: admin.firestore.FieldValue.serverTimestamp(),
      });
      throw erroApi;
    }
  } catch (e) {
    const status = e.precisaConfirmar ? 428
      : e.indeterminado ? 504
      : (e.camposInvalidos || !e.httpStatus ? 400 : 502);
    return res.status(status).json({
      ok: false, error: e.message,
      camposInvalidos: e.camposInvalidos || null,
      indeterminado: !!e.indeterminado,
    });
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
