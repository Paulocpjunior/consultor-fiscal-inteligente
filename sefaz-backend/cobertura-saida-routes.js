// ============================================================================
// sefaz-backend/cobertura-saida-routes.js  (ESM)
//
// Relatorio de COBERTURA DE SAIDA: lista as empresas-cliente monitoradas que
// NAO tiveram nenhuma NF-e de saida (mod 55) capturada na janela — o sinal de
// que o CNPJ do escritorio ainda nao esta no <autXML> do emissor daquele
// cliente (ou que ele era colhido por outro caminho da SIEG). E a lista de
// "onde precisa mexer" pra completar a migracao da captura de saida.
//
//   GET /api/admin/sefaz/cobertura-saida?janelaDias=90   (requireAdmin)
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { analisarCoberturaSaida } from './cobertura-saida.js';
import { analisarSequenciasSaida } from './prova-saida.js';

const router = express.Router();

function getDb() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin.firestore();
}

// Empresas monitoradas (Simples + Lucro) com o regime de origem.
async function carregarEmpresas(db) {
  const out = [];
  for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
    const snap = await db.collection(col).get();
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const cnpj = String(d.cnpj || '').replace(/\D/g, '');
      if (cnpj.length !== 14) return;
      out.push({
        empresaId: doc.id,
        cnpj,
        nome: d.razaoSocial || d.nome || d.fantasia || '—',
        regime,
        ativo: d.ativo !== false && d.situacao !== 'baixada',
      });
    });
  }
  return out;
}

router.get('/cobertura-saida', requireAdmin, async (req, res) => {
  try {
    const janelaDias = Math.min(Math.max(Number(req.query.janelaDias) || 90, 1), 365);
    const db = getDb();

    const empresas = await carregarEmpresas(db);

    // So os docs de saida (where reduz muito a leitura); mod 55 + janela filtram
    // em memoria (Firestore nao indexa "modelo da chave" nem sabemos o formato
    // exato de dhEmi pra comparar como string com seguranca).
    const snaps = await fetchAllDocs(
      db.collection('documentos_fiscais').where('direcao', '==', 'saida'),
      { label: 'cobertura-saida' },
    );
    const docs = snaps.map((s) => {
      const x = s.data() || {};
      return {
        empresaId: x.empresaId,
        cnpjEmit: x.cnpjEmit,
        empresaCnpj: x.empresaCnpj,
        direcao: x.direcao,
        chave: x.chave,
        dhEmi: x.dhEmi,
        // Trilho da captura: 'email' = cofre; 'autxml'/'sefaz' = DistDFe com o
        // CNPJ do escritório no autXML; fonte separa o que foi importado à mão.
        origem: x.origem || null,
        capturadoPor: x.capturadoPor?.fonte ? { fonte: x.capturadoPor.fonte } : null,
      };
    });

    const relatorio = analisarCoberturaSaida({ empresas, docs, hojeMs: Date.now(), janelaDias });

    return res.json({ ...relatorio, docsSaidaLidos: docs.length, geradoEm: new Date().toISOString() });
  } catch (e) {
    console.error('[cobertura-saida]', e);
    return res.status(500).json({ error: 'Falha interna' });
  }
});

// ── GET /prova-saida?janelaDias=90 ─────────────────────────────────────────
// PROVA EXATA por NUMERAÇÃO: NF-e é sequencial por série — buraco na sequência
// capturada é nota faltante COM NÚMERO (ou inutilizada — a confirmar). Zero
// dependência de fonte externa (SIEG/cliente): a exatidão sai dos nossos
// próprios dados. Pedido do Paulo 30/07 ("não pode ser no chute").
router.get('/prova-saida', requireAdmin, async (req, res) => {
  try {
    const janelaDias = Math.min(Math.max(Number(req.query.janelaDias) || 90, 1), 365);
    const db = getDb();
    const empresas = await carregarEmpresas(db);
    const snaps = await fetchAllDocs(
      db.collection('documentos_fiscais').where('direcao', '==', 'saida'),
      { label: 'prova-saida' },
    );
    const docs = snaps.map((s) => {
      const x = s.data() || {};
      return {
        empresaId: x.empresaId,
        cnpjEmit: x.cnpjEmit,
        empresaCnpj: x.empresaCnpj,
        direcao: x.direcao,
        chave: x.chave,
        dhEmi: x.dhEmi,
        numero: x.numero,
        serie: x.serie,
      };
    });
    const prova = analisarSequenciasSaida({ docs, empresas, hojeMs: Date.now(), janelaDias });
    return res.json({ ok: true, ...prova, docsSaidaLidos: docs.length, geradoEm: new Date().toISOString() });
  } catch (e) {
    console.error('[prova-saida]', e);
    return res.status(500).json({ error: 'Falha interna' });
  }
});

export default router;
