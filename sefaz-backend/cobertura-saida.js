// ============================================================================
// sefaz-backend/cobertura-saida.js  (ESM)
// ----------------------------------------------------------------------------
// Logica PURA (testavel, sem Firestore) do RELATORIO DE COBERTURA DE SAIDA.
//
// Objetivo: dizer, para cada empresa-cliente monitorada, se o CFI ja esta
// capturando as NF-e de SAIDA (modelo 55) que ela EMITE — via o fluxo autXML
// (DistDFe com o cert do escritorio). Uma empresa "sem saida" na janela e o
// sinal de que o CNPJ do escritorio provavelmente NAO esta na tag <autXML> do
// emissor daquele cliente (ou que ele era capturado por outro caminho da SIEG:
// A1-do-cliente ou push por API). Essa e a lista de "onde precisa mexer".
//
// Regra de captura correta (mesma da SIEG): o cliente inclui o CNPJ do
// ESCRITORIO na autXML ao emitir; a SEFAZ distribui o XML completo da saida
// para o escritorio no fluxo distNSU. Sem isso, a saida NAO chega — a DistDFe
// nunca entrega ao proprio emissor as notas que ele mesmo emitiu.
// ============================================================================

const DIA_MS = 24 * 60 * 60 * 1000;

/** Modelo do DFe = posicoes 21-22 da chave de 44 digitos ('55'=NF-e, '65'=NFC-e). */
export function modeloDaChave(chave) {
  return String(chave || '').replace(/\D/g, '').slice(20, 22);
}

/** doc conta como saida mod 55 se direcao=saida E a chave e modelo 55. */
export function ehSaidaMod55(doc) {
  return String(doc?.direcao) === 'saida' && modeloDaChave(doc?.chave) === '55';
}

/**
 * dhEmi (ISO) esta dentro da janela [hoje - janelaDias, hoje + 1dia]? O +1dia
 * tolera fuso/relogio adiantado sem descartar nota de hoje.
 */
export function dentroJanela(dhEmi, hojeMs, janelaDias) {
  const t = Date.parse(dhEmi);
  if (!Number.isFinite(t)) return false;
  const inicio = hojeMs - janelaDias * DIA_MS;
  const fim = hojeMs + DIA_MS;
  return t >= inicio && t <= fim;
}

/**
 * Cruza empresas monitoradas x documentos capturados e devolve quem NAO teve
 * nenhuma saida mod 55 na janela.
 *
 * @param {object} p
 * @param {Array<{empresaId:string, cnpj:string, nome?:string, regime?:string, ativo?:boolean}>} p.empresas
 * @param {Array<{empresaId?:string, cnpjEmit?:string, empresaCnpj?:string, direcao?:string, chave?:string, dhEmi?:string}>} p.docs
 * @param {number} p.hojeMs  timestamp de referencia (injetado p/ testabilidade)
 * @param {number} [p.janelaDias=90]
 */
export function analisarCoberturaSaida({ empresas, docs, hojeMs, janelaDias = 90 }) {
  const porId = new Map();
  const porRaiz = new Map();
  for (const e of empresas || []) {
    const cnpj = String(e.cnpj || '').replace(/\D/g, '');
    const rec = {
      empresaId: e.empresaId,
      cnpj,
      nome: e.nome || '—',
      regime: e.regime || null,
      ativo: e.ativo !== false,
      // Janela (captura recente) — define coberta x pendente.
      qtdSaida: 0,
      ultimaSaida: null,
      ultimaSaidaMs: null,
      // Histórico (toda a base, inclusive resumos só-chave e notas fora da
      // janela) — é o SINAL DE PRIORIDADE: quem tem saída na história mas 0 na
      // janela emite de verdade e parou de ser capturado → migra primeiro.
      qtdSaidaTotal: 0,
      ultimaSaidaHistorica: null,
      ultimaSaidaHistoricaMs: null,
    };
    if (e.empresaId) porId.set(e.empresaId, rec);
    // Raiz (8) cobre filial que emite de base diferente da cadastrada.
    if (cnpj.length === 14 && !porRaiz.has(cnpj.slice(0, 8))) porRaiz.set(cnpj.slice(0, 8), rec);
  }

  for (const d of docs || []) {
    if (!ehSaidaMod55(d)) continue;
    // Atribui pelo empresaId gravado; fallback pela raiz do emitente.
    let rec = d.empresaId ? porId.get(d.empresaId) : null;
    if (!rec) {
      const cEmit = String(d.cnpjEmit || d.empresaCnpj || '').replace(/\D/g, '');
      if (cEmit.length === 14) rec = porRaiz.get(cEmit.slice(0, 8));
    }
    if (!rec) continue;
    const t = Date.parse(d.dhEmi);
    // Histórico: conta SEMPRE (mesmo fora da janela ou sem dhEmi válido — a
    // existência da nota já prova que a empresa emite mod 55).
    rec.qtdSaidaTotal++;
    if (Number.isFinite(t) && (rec.ultimaSaidaHistoricaMs === null || t > rec.ultimaSaidaHistoricaMs)) {
      rec.ultimaSaidaHistoricaMs = t;
      rec.ultimaSaidaHistorica = d.dhEmi;
    }
    // Janela: só conta dentro do período (cobertura recente).
    if (dentroJanela(d.dhEmi, hojeMs, janelaDias)) {
      rec.qtdSaida++;
      if (Number.isFinite(t) && (rec.ultimaSaidaMs === null || t > rec.ultimaSaidaMs)) {
        rec.ultimaSaidaMs = t;
        rec.ultimaSaida = d.dhEmi;
      }
    }
  }

  const todas = [...porId.values()];
  const semSaida = todas.filter((e) => e.qtdSaida === 0);
  const comSaida = todas.filter((e) => e.qtdSaida > 0);

  const porNome = (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  // Prioridade: mais saída histórica primeiro; empate desempata por nome.
  const porPrioridade = (a, b) => (b.qtdSaidaTotal - a.qtdSaidaTotal) || porNome(a, b);
  const limpa = ({ ultimaSaidaMs, ultimaSaidaHistoricaMs, ...rest }) => rest; // nao vaza os ms internos

  // Dentro dos "sem saída na janela": quem TEM histórico de saída são os
  // prioritários (emite mod 55, só paramos de capturar — migrar pro cofre/autXML
  // resolve). Quem tem 0 na história inteira provavelmente não emite mod 55
  // (ex.: só presta serviço/NFS-e, ou só NFC-e) — fica no fim da fila.
  const semSaidaOrdenada = semSaida.sort(porPrioridade);
  const prioritarias = semSaidaOrdenada.filter((e) => e.qtdSaidaTotal > 0);
  const semEvidenciaSaida = semSaidaOrdenada.filter((e) => e.qtdSaidaTotal === 0);

  return {
    janelaDias,
    totalEmpresas: todas.length,
    comSaida: comSaida.length,
    semSaida: semSaida.length,
    percentualCobertura: todas.length ? Math.round((comSaida.length / todas.length) * 100) : 0,
    // A lista acionavel, JÁ PRIORIZADA: onde falta o CNPJ do escritorio no
    // autXML ou o cliente apontar o emissor pro cofre. Migrar de cima pra baixo.
    empresasSemSaida: semSaidaOrdenada.map(limpa),
    // Recortes prontos pra equipe atacar por ordem de impacto.
    prioritarias: prioritarias.map(limpa),          // emite mod 55, parou de ser capturado
    semEvidenciaSaida: semEvidenciaSaida.map(limpa), // sem sinal de que emite mod 55
    prioritariasCount: prioritarias.length,
    semEvidenciaCount: semEvidenciaSaida.length,
    empresasComSaida: comSaida.sort((a, b) => b.qtdSaida - a.qtdSaida).map(limpa),
  };
}
