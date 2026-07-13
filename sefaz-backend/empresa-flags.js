// ============================================================================
// sefaz-backend/empresa-flags.js  (ESM)
// Flags cadastrais da empresa (uf + procuracaoEcacAtiva) compartilhadas entre
// sync-orchestrator (DistDFe) e manifesto-orchestrator (re-download pos-ciencia,
// que precisa da UF pro cUFAutor do consChNFe).
// ============================================================================

import admin from 'firebase-admin';

export const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');

function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

// Carrega flags da empresa (uf + procuracaoEcacAtiva) consultando
// simples_empresas e lucro_empresas (tenta as duas). A flag de procuracao
// continua informativa para outros fluxos, mas NFe DistDFe no Cloud Run exige
// A1 da propria raiz CNPJ. SEFAZ rejeita cert do escritorio com cStat=593.
export async function carregarFlagsEmpresa(empresaId, empresaCnpj) {
  if (!empresaId) return { uf: null, procuracaoEcacAtiva: false };
  const db = fa().firestore();
  for (const col of ['simples_empresas', 'lucro_empresas']) {
    try {
      const snap = await db.collection(col).doc(empresaId).get();
      if (snap.exists) {
        const d = snap.data() || {};
        // Cadastro canonico: dadosFiscais.uf. Fallback ao top-level pra
        // cobrir docs legados onde a UF foi gravada como d.uf direto.
        const uf = d.dadosFiscais?.uf || d.uf;
        return {
          uf: uf ? String(uf).trim().toUpperCase() : null,
          procuracaoEcacAtiva: d.procuracaoEcacAtiva === true,
        };
      }
    } catch (e) {
      console.warn(`[empresa-flags] erro lendo ${col}/${empresaId}:`, e.message);
    }
  }
  // Caso especial: a propria S&P (escritorio) — defaulta SP. Sem isso,
  // o escritorio tinha que cadastrar UF=SP pra si mesmo manualmente, o
  // que e ridiculo (S&P Assessoria Contabil esta literalmente em SP).
  const cnpjNum = String(empresaCnpj || '').replace(/\D/g, '');
  if (cnpjNum === CNPJ_ESCRITORIO) return { uf: 'SP', procuracaoEcacAtiva: false };
  return { uf: null, procuracaoEcacAtiva: false };
}
