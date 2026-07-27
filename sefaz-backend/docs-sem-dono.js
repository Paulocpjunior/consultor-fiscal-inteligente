// ============================================================================
// sefaz-backend/docs-sem-dono.js  (lógica PURA + varredura)
// ----------------------------------------------------------------------------
// Conserta documentos fiscais que ficaram SEM DONO (empresaId nulo).
//
// Como isso aconteceu: até 27/07/2026 a rota de importação em lote (ZIP e
// agente A3) chamava o importer com `empresaId: null` — só o CNPJ ia junto. A
// aba XMLs filtra por empresaId, então TODA nota importada por esse caminho
// ficava invisível ao filtrar o cliente (caso GUARANI: 36 XMLs importados, 2
// visíveis). A rota já foi corrigida, mas o acervo importado antes continua
// órfão — e reimportar o mesmo arquivo não bastava porque o fast-path de
// duplicidade saía antes de reatribuir.
//
// Esta varredura resolve o passado: acha os órfãos, descobre o dono pelo CNPJ
// do emitente/destinatário (mesmo matcher da captura) e devolve a posse.
// ============================================================================

/**
 * Decide o dono e a direção de um documento órfão. PURO.
 *
 * @param {object} doc          { cnpjEmit, cnpjDest, empresaCnpj }
 * @param {Map} porCnpj         índice CNPJ(14) → empresa
 * @param {Map} porRaiz         índice raiz(8) → empresa (cobre filial)
 * @returns {{empresaId, empresaCnpj, direcao, viaRaiz}|null} null = nota de
 *          terceiro (nenhuma ponta é cliente nosso) — não inventa dono.
 */
export function decidirDonoDoDoc(doc, porCnpj, porRaiz) {
  const limpar = (v) => String(v || '').replace(/\D/g, '');
  const emit = limpar(doc?.cnpjEmit);
  const dest = limpar(doc?.cnpjDest);

  const achar = (cnpj) => {
    if (cnpj.length !== 14) return null;
    if (porCnpj.has(cnpj)) return { emp: porCnpj.get(cnpj), viaRaiz: false };
    const raiz = cnpj.slice(0, 8);
    if (porRaiz.has(raiz)) return { emp: porRaiz.get(raiz), viaRaiz: true };
    return null;
  };

  // Emitente primeiro: se o cliente EMITIU, a nota é saída dele. Só depois o
  // destinatário (entrada). Mesma ordem do matcher da captura.
  const donoEmit = achar(emit);
  if (donoEmit) {
    return { empresaId: donoEmit.emp.empresaId, empresaCnpj: emit, direcao: 'saida', viaRaiz: donoEmit.viaRaiz };
  }
  const donoDest = achar(dest);
  if (donoDest) {
    return { empresaId: donoDest.emp.empresaId, empresaCnpj: dest, direcao: 'entrada', viaRaiz: donoDest.viaRaiz };
  }
  return null;
}

/**
 * Varre os documentos sem dono e (se `aplicar`) devolve a posse.
 *
 * @param {object} p
 * @param {FirebaseFirestore.Firestore} p.db
 * @param {Map} p.porCnpj  @param {Map} p.porRaiz  (de xml-empresa-matcher)
 * @param {boolean} [p.aplicar=false]  false = só relatório (ensaio)
 * @param {number} [p.maxDocs=2000]    teto por chamada (a UI repete)
 * @param {string} [p.cursor]          id do último doc da chamada anterior
 * @param {object} [p.FieldValue]      admin.firestore.FieldValue (timestamp)
 */
export async function repararDocsSemDono({ db, porCnpj, porRaiz, aplicar = false, maxDocs = 2000, cursor = null, FieldValue = null }) {
  const LOTE = 300;
  const r = {
    analisados: 0,
    reparados: 0,
    semDonoConhecido: 0,   // nota de terceiro: nenhuma ponta é cliente
    semCnpjNoDoc: 0,       // doc antigo sem cnpjEmit/cnpjDest gravados
    porEmpresa: {},
    aplicar,
    cursor: null,
    acabou: false,
  };
  let ultimoId = cursor;

  while (r.analisados < maxDocs) {
    let q = db.collection('documentos_fiscais')
      .where('empresaId', '==', null)
      .orderBy('__name__')
      .limit(Math.min(LOTE, maxDocs - r.analisados));
    if (ultimoId) q = q.startAfter(ultimoId);

    const snap = await q.get();
    if (snap.empty) { r.acabou = true; break; }

    const escritas = [];
    for (const docSnap of snap.docs) {
      r.analisados++;
      ultimoId = docSnap.id;
      const d = docSnap.data() || {};
      if (!d.cnpjEmit && !d.cnpjDest) { r.semCnpjNoDoc++; continue; }

      const dono = decidirDonoDoDoc(d, porCnpj, porRaiz);
      if (!dono) { r.semDonoConhecido++; continue; }

      const nome = (porCnpj.get(dono.empresaCnpj) || porRaiz.get(dono.empresaCnpj.slice(0, 8)) || {}).nome || dono.empresaId;
      r.porEmpresa[nome] = (r.porEmpresa[nome] || 0) + 1;
      r.reparados++;

      if (aplicar) {
        const patch = {
          empresaId: dono.empresaId,
          empresaCnpj: dono.empresaCnpj,
          direcao: dono.direcao,
          reatribuidoDe: null,
        };
        if (FieldValue) patch.reatribuidoEm = FieldValue.serverTimestamp();
        escritas.push(docSnap.ref.update(patch));
      }
    }
    if (escritas.length) await Promise.all(escritas);
    if (snap.size < LOTE) { r.acabou = true; break; }
  }

  r.cursor = r.acabou ? null : ultimoId;
  return r;
}
