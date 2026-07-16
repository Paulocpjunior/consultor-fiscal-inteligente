// ============================================================================
// sefaz-backend/poc-saida-sp-routes.js  (ESM) — Fase F0
//
// Rota admin de RECONHECIMENTO SEFAZ-SP (NF-e de SAIDA). Roda no backend
// implantado usando o A1 da empresa guardado no cofre (cert-storage) — assim
// o teste do handshake mTLS pode ser feito sem ninguem instalar nada nem
// manusear o .pfx localmente.
//
// SOMENTE LEITURA: nao grava Firestore/Storage; so faz GET de reconhecimento.
// Protegida por requireAdmin. Herda o apiLimiter global de /api/.
//
//   GET /api/admin/sefaz/poc-saida-sp?empresaId=<id>
//   GET /api/admin/sefaz/poc-saida-sp?cnpj=<14 ou raiz>
//   GET /api/admin/sefaz/poc-saida-sp?cnpj=...&url=<extra>&timeout=<ms>
// ============================================================================

import express from 'express';
import { requireAdmin } from './require-admin.js';
import { loadCertEmpresa } from './cert-storage.js';
import { resolverCertEmpresa } from './poc-cert-diagnostico.js';
import { reconhecerSaidaSp } from './poc-saida-sp-recon.js';

const router = express.Router();

router.get('/poc-saida-sp', requireAdmin, async (req, res) => {
  const inicio = Date.now();
  try {
    const empresaId = req.query.empresaId ? String(req.query.empresaId) : null;
    const cnpjRaw = req.query.cnpj ? String(req.query.cnpj).replace(/\D/g, '') : null;
    if (!empresaId && !cnpjRaw) {
      return res.status(400).json({ error: 'Informe empresaId ou cnpj na query.' });
    }

    // Carrega o A1 DA EMPRESA (nao o do escritorio). Por CNPJ usa o resolvedor
    // com diagnostico (aceita raiz de 8 OU CNPJ de 14 e explica o motivo se
    // nao achar). Por empresaId, carrega direto.
    let cert = null;
    let motivoNaoAchou = null;
    if (empresaId) {
      cert = await loadCertEmpresa(empresaId);
    } else {
      const r = await resolverCertEmpresa(cnpjRaw);
      if (r.ok) cert = r.cert;
      else motivoNaoAchou = r;
    }

    if (!cert || !cert.pfxBuffer) {
      return res.status(404).json({
        error: 'Certificado A1 da empresa nao encontrado no cofre.',
        dica: 'Faca upload do A1 (tipo A1, valido) em Certificados (cert-empresa) para a raiz do CNPJ informado.',
        empresaId, cnpj: cnpjRaw,
        diagnostico: motivoNaoAchou || null,
      });
    }

    const urlQ = req.query.url;
    const extraUrls = urlQ ? (Array.isArray(urlQ) ? urlQ.map(String) : [String(urlQ)]) : [];
    const timeoutMs = Number(req.query.timeout) || undefined;

    const relatorio = await reconhecerSaidaSp({ cert, extraUrls, timeoutMs });

    res.json({
      ok: true,
      fase: 'F0-reconhecimento',
      geradoEm: new Date().toISOString(),
      duracaoMs: Date.now() - inicio,
      certEmpresa: { empresaId: cert.empresaId || empresaId || null, cnpj: cert.cnpj || null },
      ...relatorio,
    });
  } catch (e) {
    console.error('[poc-saida-sp] erro:', e.message);
    res.status(500).json({ error: e.message, duracaoMs: Date.now() - inicio });
  }
});

export default router;
