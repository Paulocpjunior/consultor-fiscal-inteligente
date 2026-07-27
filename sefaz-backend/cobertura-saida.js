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
 * Por qual TRILHO a nota de saida chegou — e a prova de que a configuracao do
 * cliente esta valendo (27/07, pergunta do Paulo: "o cliente diz que incluiu
 * nosso CNPJ, como confirmar?").
 *
 *   'autxml' → veio da SEFAZ pelo DistDFe do escritorio. A SEFAZ NUNCA entrega
 *              ao emissor a saida que ele mesmo emitiu (Rejeicao 641): se uma
 *              saida mod 55 chegou por 'sefaz', so pode ser porque o CNPJ do
 *              escritorio esta na tag <autXML> (ou somos destinatarios). Ou
 *              seja: prova direta de que a configuracao do cliente funcionou.
 *   'cofre'  → o emissor do cliente mandou o XML pra caixa xml@ (origem
 *              'email').
 *   'manual' → alguem importou (ZIP/upload/SharePoint). NAO confirma nada: se
 *              a captura automatica parar, ninguem percebe.
 */
export function trilhoDaOrigem(origem, fonte = null) {
  const o = String(origem || '').toLowerCase();
  const f = String(fonte || '').toLowerCase();
  if (o === 'email') return 'cofre';
  if (o === 'autxml') return 'autxml';
  // Importação por gente (ZIP, consulta por chave, conferência, SharePoint):
  // NÃO confirma configuração nenhuma — se a captura automática parar, ninguém
  // percebe. Precisa vir antes do 'sefaz', porque essas rotas também gravam
  // origem='sefaz' (default do importer).
  if (o === 'sharepoint_auto' || o === 'manual'
    || /conferencia|consulta-chave|manual|agent|importac/.test(f)) return 'manual';
  if (o === 'sefaz') return 'autxml';
  return 'desconhecido';
}

/**
 * Veredito de CONFIRMAÇÃO da configuração de saída de UMA empresa — responde
 * "o cliente disse que ligou; ligou mesmo?" com prova (trilho + data).
 * PURA. `rec` vem do analisarCoberturaSaida (contadores por trilho).
 */
export function classificarConfirmacaoSaida(rec, hojeMs, janelaDias = 90) {
  const t = rec?.trilhos || {};
  const auto = ['cofre', 'autxml'].filter((k) => (t[k]?.qtd || 0) > 0);
  const ultimaAutoMs = Math.max(0, ...auto.map((k) => t[k].ultimaMs || 0));
  const diasSemAuto = ultimaAutoMs ? Math.floor((hojeMs - ultimaAutoMs) / DIA_MS) : null;

  if (auto.length > 0) {
    const nomes = auto.map((k) => (k === 'cofre' ? 'cofre de e-mail' : 'autXML')).join(' + ');
    return {
      confirmado: true,
      trilhos: auto,
      titulo: `Ligado por ${nomes}`,
      detalhe: `Última saída capturada há ${diasSemAuto} dia(s) — ${auto.map((k) => `${t[k].qtd} pelo ${k === 'cofre' ? 'cofre' : 'autXML'}`).join(', ')} na janela de ${janelaDias} dias.`,
      acao: null,
    };
  }
  if ((t.manual?.qtd || 0) > 0) {
    return {
      confirmado: false,
      trilhos: ['manual'],
      titulo: 'Só importação manual',
      detalhe: `${t.manual.qtd} nota(s) na janela, todas importadas à mão — nenhuma chegou sozinha.`,
      acao: 'A configuração do cliente NÃO está valendo: peça o e-mail do emissor apontado para xml@spassessoriacontabil.com.br OU o CNPJ 44.388.152/0001-89 na tag autXML. Enquanto isso, a captura depende de alguém lembrar de importar.',
    };
  }
  if ((rec?.qtdSaidaTotal || 0) > 0) {
    return {
      confirmado: false,
      trilhos: [],
      titulo: 'Emite mod 55, mas nada chega',
      detalhe: `Nenhuma saída nos últimos ${janelaDias} dias; a última conhecida é de ${String(rec.ultimaSaidaHistorica || '').slice(0, 10) || '—'}.`,
      acao: 'Confirme com o cliente ONDE ele mexeu: (1) cofre — o emissor precisa mandar o XML para xml@spassessoriacontabil.com.br a cada emissão (não só o PDF/DANFE); (2) autXML — o CNPJ 44.388.152/0001-89 tem de entrar na tag autXML DA NOTA, no cadastro do emissor (não no Bloco 0100 do SPED). Só vale para notas emitidas DEPOIS da mudança.',
    };
  }
  return {
    confirmado: false,
    trilhos: [],
    titulo: 'Sem evidência de que emite mod 55',
    detalhe: 'Nenhuma saída mod 55 na base, nem na janela nem no histórico.',
    acao: 'Antes de cobrar configuração, confirme com o cliente se ele emite NF-e mod 55 (pode ser só serviço/NFS-e ou só NFC-e).',
  };
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
      // Por TRILHO, dentro da janela — é a prova de qual das duas ligações
      // (cofre de e-mail / autXML com nosso CNPJ) está de fato valendo.
      trilhos: {},
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
      const trilho = trilhoDaOrigem(d.origem, d.capturadoPor?.fonte);
      const bucket = rec.trilhos[trilho] || (rec.trilhos[trilho] = { qtd: 0, ultimaMs: null, ultima: null });
      bucket.qtd++;
      if (Number.isFinite(t) && (bucket.ultimaMs === null || t > bucket.ultimaMs)) {
        bucket.ultimaMs = t;
        bucket.ultima = d.dhEmi;
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
    // CONFIRMAÇÃO por cliente: a resposta a "o cliente disse que ligou o cofre
    // (ou pôs nosso CNPJ no autXML) — ligou mesmo?". Vem para TODAS as
    // empresas, com o trilho e a data que provam (ou a ação, quando não há).
    confirmacoes: todas
      .map((e) => ({
        empresaId: e.empresaId,
        cnpj: e.cnpj,
        nome: e.nome,
        ativo: e.ativo,
        qtdSaida: e.qtdSaida,
        ultimaSaida: e.ultimaSaida,
        ultimaSaidaHistorica: e.ultimaSaidaHistorica,
        cofre: e.trilhos.cofre ? { qtd: e.trilhos.cofre.qtd, ultima: e.trilhos.cofre.ultima } : null,
        autxml: e.trilhos.autxml ? { qtd: e.trilhos.autxml.qtd, ultima: e.trilhos.autxml.ultima } : null,
        manual: e.trilhos.manual ? { qtd: e.trilhos.manual.qtd, ultima: e.trilhos.manual.ultima } : null,
        ...classificarConfirmacaoSaida(e, hojeMs, janelaDias),
      }))
      .sort(porNome),
    confirmadas: todas.filter((e) => (e.trilhos.cofre?.qtd || 0) > 0 || (e.trilhos.autxml?.qtd || 0) > 0).length,
  };
}
