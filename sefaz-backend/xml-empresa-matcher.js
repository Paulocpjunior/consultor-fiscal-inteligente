// ============================================================================
// sefaz-backend/xml-empresa-matcher.js  (ESM)
// ----------------------------------------------------------------------------
// Atribuicao de um XML de DFe a empresa-cliente DONA, casando o CNPJ do
// emitente/destinatario contra as empresas monitoradas (Simples + Lucro).
//
// Extraido do distdfe-autxml-orchestrator pra ser reaproveitado tambem pela
// ingestao por e-mail (o "cofre" do CFI): a mesma logica que descobre de quem
// e a nota vinda pela DistribuiçãoDFe serve pra nota que chega por e-mail.
// ============================================================================

/**
 * Carrega as empresas monitoradas indexadas por CNPJ (14) e por RAIZ (8).
 * A raiz cobre filiais: o cliente pode estar cadastrado numa filial mas emitir
 * de outra — sem a raiz, a nota cairia "sem dono".
 */
export async function carregarEmpresas(db) {
  const porCnpj = new Map();
  const porRaiz = new Map();
  for (const col of ['simples_empresas', 'lucro_empresas']) {
    const snap = await db.collection(col).get();
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const cnpj = String(d.cnpj || '').replace(/\D/g, '');
      if (cnpj.length !== 14) return;
      const rec = { empresaId: doc.id, cnpj, nome: d.razaoSocial || d.nome || d.fantasia || '—' };
      if (!porCnpj.has(cnpj)) porCnpj.set(cnpj, rec);
      const raiz = cnpj.slice(0, 8);
      if (!porRaiz.has(raiz)) porRaiz.set(raiz, rec);
    });
  }
  return { porCnpj, porRaiz };
}

/**
 * Acha a empresa-cliente dona de um CNPJ de nota: casa por CNPJ exato; se nao
 * achar, casa pela raiz (mesma base = mesmo grupo). Retorna { emp, viaRaiz }.
 */
export function acharDono(noteCnpj, porCnpj, porRaiz) {
  if (!noteCnpj) return null;
  if (porCnpj.has(noteCnpj)) return { emp: porCnpj.get(noteCnpj), viaRaiz: false };
  const raiz = noteCnpj.slice(0, 8);
  if (porRaiz.has(raiz)) return { emp: porRaiz.get(raiz), viaRaiz: true };
  return null;
}

/**
 * Extrai CNPJ do emitente e do destinatario, cobrindo procNFe/NFe (blocos
 * <emit>/<dest>) e resNFe/resumo (so <CNPJ> do emitente no topo).
 */
export function extrairCnpjs(xml) {
  const emitBloco = (xml.match(/<emit\b[\s\S]*?<\/emit>/i) || [''])[0];
  const destBloco = (xml.match(/<dest\b[\s\S]*?<\/dest>/i) || [''])[0];
  const cnpjEmit = (emitBloco.match(/<CNPJ>(\d{14})<\/CNPJ>/) || [])[1]
    || (xml.match(/<resNFe\b[\s\S]*?<CNPJ>(\d{14})<\/CNPJ>/i) || [])[1]
    || null;
  const cnpjDest = (destBloco.match(/<CNPJ>(\d{14})<\/CNPJ>/) || [])[1] || null;
  return { cnpjEmit, cnpjDest };
}

/**
 * Dado um XML e os indices de empresas, decide dono + direcao.
 * Prioriza emit (=> saida do cliente); senao dest (=> entrada).
 * @returns {{ emp, tipo:'saida'|'entrada', cnpjNota:string, viaRaiz:boolean } | null}
 */
export function atribuirXml(xml, porCnpj, porRaiz) {
  const { cnpjEmit, cnpjDest } = extrairCnpjs(xml);
  const donoEmit = acharDono(cnpjEmit, porCnpj, porRaiz);
  if (donoEmit) return { emp: donoEmit.emp, tipo: 'saida', cnpjNota: cnpjEmit, viaRaiz: donoEmit.viaRaiz };
  const donoDest = acharDono(cnpjDest, porCnpj, porRaiz);
  if (donoDest) return { emp: donoDest.emp, tipo: 'entrada', cnpjNota: cnpjDest, viaRaiz: donoDest.viaRaiz };
  return null;
}
