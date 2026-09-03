// ============================================================================
// sefaz-backend/dare-sp.js  (ESM)
// ----------------------------------------------------------------------------
// DARE-SP (Documento de Arrecadação de Receitas Estaduais) — ICMS.
// Lógica PURA (testável): tabela de códigos + validação/montagem do payload.
//
// FONTE DOS CÓDIGOS: três DAREs REAIS emitidos pelo escritório (prints do
// Paulo, 24/07/2026) — não são códigos chutados:
//   · WALDESA   → campo 01 "046-2 · ICMS – regime periódico de apuração"
//                 campo 02 "SEFAZ-404601 – ICMS – Operações Próprias – RPA (04601)"
//   · FLANACAR  → campo 01 "146-6 · ICMS – Substituição Tributária (contribuinte
//                 do Estado de São Paulo)"
//                 campo 02 "SEFAZ-414601 – ICMS – Substituição Tributária – RPA (14601)"
//   · GS ODONTO → campo 01 "046-2 · ICMS – regime periódico de apuração"
//                 campo 02 "SEFAZ-404602 – ICMS – Diferencial de alíquota –
//                 Simples Nacional (04602)"
//
// EMISSÃO: o NÚMERO do DARE e o código de barras são emitidos pelo SISTEMA da
// SEFAZ-SP — não existe geração offline válida. Dois caminhos:
//   (a) HOJE: preview conferido no app + emissão no portal DARE com os dados
//       prontos (copiar/colar). NUNCA gerar barras "mock" pra DARE.
//   (b) FUTURO: API oficial "DARE ICMS" da SEFAZ-SP — exige credenciamento
//       (api_dare_icms@fazenda.sp.gov.br). Quando credenciar, o provider
//       pluga aqui em cima sem mudar a validação.
// ============================================================================

import { competenciaTarefa } from './competencia.js';
// Portal oficial de emissão (entrada pública; sem parâmetros fabricados).
export const PORTAL_DARE_URL = 'https://www3.fazenda.sp.gov.br/DARE/';

// Tabela de serviços DARE-ICMS suportados. `codigoServico` é a chave.
export const CODIGOS_DARE_ICMS = {
  '04601': {
    codigoServico: '04601',
    codigoReceita: '046-2',
    sefaz: 'SEFAZ-404601',
    descricao: 'ICMS – Operações Próprias – RPA',
    derivacao: 'proprio',
    regimes: ['rpa'],
  },
  '14601': {
    codigoServico: '14601',
    codigoReceita: '146-6',
    sefaz: 'SEFAZ-414601',
    descricao: 'ICMS – Substituição Tributária (contribuinte do Estado de São Paulo) – RPA',
    derivacao: 'st',
    regimes: ['rpa'],
  },
  '04602': {
    codigoServico: '04602',
    codigoReceita: '046-2',
    sefaz: 'SEFAZ-404602',
    descricao: 'ICMS – Diferencial de alíquota – Simples Nacional',
    derivacao: 'difal',
    regimes: ['simples'],
  },
};

/** Normaliza referência para 'MM/AAAA'. Aceita 'MM/AAAA' e 'AAAA-MM'. */
export function normalizarReferencia(ref) {
  // ⚠️ AS QUATRO FORMAS, pelo dono. Este parse conhecia duas (`MM/AAAA` e
  // `AAAA-MM`) e recusava `202607` (colagem de arquivo) e `AAAA-MM-DD` (a
  // forma que a ficha financeira grava) — competências legítimas voltando com
  // "referência inválida".
  //
  // ✅ E o que ele JÁ FAZIA CERTO fica: ilegível devolve **null**, e quem
  // chama RECUSA com o motivo. Ao contrário do DARF, aqui a ausência nunca
  // virou data de hoje — é o desenho que o resto da casa copiou.
  return competenciaTarefa(ref);
}

/**
 * Monta e VALIDA o payload de um DARE-ICMS. Não emite nada — devolve os dados
 * conferíveis (mesmos campos do documento real) ou lança erro em português
 * com a AÇÃO prática. Zero tolerância: campo inválido = não sai guia.
 */
export function montarDare({
  cnpj, razaoSocial, codigoServico, referencia, valor, vencimento,
  // Serviços conhecidos ALÉM da tabela fixa — hoje só o da antecipação do
  // 426-A, que mora no banco porque é rubrica própria e o número vem da
  // lista real da SEFAZ (dare-antecipacao-config.js). Sem ele cadastrado, a
  // guia da antecipação é recusada aqui mesmo.
  codigosExtras = null,
}) {
  const cnpjNum = String(cnpj || '').replace(/\D/g, '');
  if (cnpjNum.length !== 14) {
    throw new Error(`CNPJ inválido ("${cnpj || ''}"). Confira o cadastro da empresa.`);
  }
  const nome = String(razaoSocial || '').trim();
  if (!nome) throw new Error('Razão social vazia — confira o cadastro da empresa.');

  const tabela = codigosExtras ? { ...CODIGOS_DARE_ICMS, ...codigosExtras } : CODIGOS_DARE_ICMS;
  const svc = tabela[String(codigoServico || '').trim()];
  if (!svc) {
    const validos = Object.keys(tabela).join(', ');
    throw new Error(`Código de serviço DARE desconhecido ("${codigoServico}"). Válidos: ${validos}.`);
  }

  const ref = normalizarReferencia(referencia);
  if (!ref) {
    throw new Error(`Referência inválida ("${referencia}"). Use MM/AAAA (ex.: 06/2026).`);
  }

  const v = Number(valor);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`Valor inválido ("${valor}"). Informe o valor apurado (> 0).`);
  }
  // Centavos exatos — guia de imposto não arredonda silenciosamente.
  const valorCent = Math.round(v * 100);

  const venc = String(vencimento || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venc) || Number.isNaN(Date.parse(venc))) {
    throw new Error(`Vencimento inválido ("${vencimento}"). Use AAAA-MM-DD (data do vencimento do imposto).`);
  }

  return {
    contribuinte: { cnpj: cnpjNum, razaoSocial: nome },
    codigoServico: svc.codigoServico,
    codigoReceita: svc.codigoReceita,
    sefaz: svc.sefaz,
    descricao: svc.descricao,
    derivacao: svc.derivacao,
    referencia: ref,
    valor: valorCent / 100,
    vencimento: venc,
    portalUrl: PORTAL_DARE_URL,
  };
}

/** Derivações de ICMS disponíveis para um regime ('rpa' | 'simples'). */
export function derivacoesDisponiveis(regime) {
  const r = String(regime || '').toLowerCase();
  return Object.values(CODIGOS_DARE_ICMS).filter((c) => c.regimes.includes(r));
}

// ── Trilho GNRE em Lote (XML) ───────────────────────────────────────────────
// Tabela de CONVERSÃO oficial exibida em www4.fazenda.sp.gov.br/DareICMS/
// GnreLote (print do Paulo, 24/07/2026). DESCOBERTA IMPORTANTE: o lote
// XML-GNRE cobre SÓ estas 8 receitas (perfil "contribuinte de fora de SP
// recolhendo pra SP" — comunicação/energia/transporte/DIFAL remetente/
// especiais/ST/importação). NÃO emite as guias mensais RPA do escritório
// (046-2 ICMS próprio, 146-6 ST do inscrito paulista) — pra essas, o trilho
// é Dare Unitário/Dare em Lote ou a API oficial credenciada.
export const CONVERSAO_GNRE_DARE_SP = {
  '10001-3': { dareSp: '113-2', gnre: 'ICMS Comunicação' },
  '10002-1': { dareSp: '116-8', gnre: 'ICMS Energia Elétrica' },
  '10003-0': { dareSp: '111-9', gnre: 'ICMS Transporte' },
  '10004-8': { dareSp: '246-0', gnre: 'ICMS Consumidor final não contribuinte' },
  '10008-0': { dareSp: '119-3', gnre: 'ICMS Recolhimentos Especiais' },
  '10009-9': { dareSp: '247-1', gnre: 'ICMS Substituição Tributária por Apuração' },
  '10010-2': { dareSp: '101-6', gnre: 'ICMS Substituição Tributária por Operação' },
  '10011-0': { dareSp: '102-8', gnre: 'ICMS Importação' },
};

/** O código DARE-SP é emissível pelo lote XML-GNRE? (null = não — usar
 *  Dare Unitário/Dare em Lote/API. Vale pros RPA 046-2 e 146-6.) */
export function codigoGnreParaDareSp(codigoDareSp) {
  const alvo = String(codigoDareSp || '').trim();
  for (const [gnre, info] of Object.entries(CONVERSAO_GNRE_DARE_SP)) {
    if (info.dareSp === alvo) return gnre;
  }
  return null;
}

// ── Trilho "Dare em Lote" (TXT copiar/colar) ────────────────────────────────
// Formato DOCUMENTADO na própria página www4.fazenda.sp.gov.br/DareICMS/
// DareLote (print do Paulo, 24/07/2026) — é o lote do ICMS DECLARADO, com os
// códigos RPA (04601/14601) no dropdown. Regras da página:
//   · linha: CNPJ;servico;MM/AAAA;DD/MM/AAAA;valor;1   (1 = sistema calcula
//     acréscimos moratórios/valor total — nosso default: nunca calculamos
//     multa/juros de guia estadual localmente)
//   · SEM espaços; centavos com PONTO; máx 50 documentos por lote;
//   · não misturar inscritos e não-inscritos no mesmo lote;
//   · serviços PROIBIDOS em lote: 06305, 08101, 1044, 89202.
// Exemplos oficiais da página (os testes replicam verbatim):
//   18857209000131;06301;03/2022;30/04/2022;1000.99;1
//   18821372000144;10101;04/2022;31/05/2022;0;0;2000.53
export const MAX_DOCS_LOTE_DARE = 50;
export const SERVICOS_BLOQUEADOS_LOTE = ['06305', '08101', '1044', '89202'];

/** Uma linha do lote TXT. Valida TUDO via montarDare (mesma régua da guia
 *  unitária) e formata exatamente como os exemplos oficiais. */
export function montarLinhaLoteTxt(item) {
  return montarItemLote(item).linha;
}

/** A linha E o valor VALIDADO que ela carrega — é dele que o total do lote sai. */
function montarItemLote({ cnpj, razaoSocial, codigoServico, referencia, valor, vencimento }) {
  const svcNum = String(codigoServico || '').trim();
  if (SERVICOS_BLOQUEADOS_LOTE.includes(svcNum)) {
    throw new Error(`Serviço ${svcNum} não pode ser emitido em lote (regra do portal DARE) — emita pelo Dare Unitário.`);
  }
  const p = montarDare({ cnpj, razaoSocial: razaoSocial || 'lote', codigoServico, referencia, valor, vencimento });
  const vencBr = p.vencimento.split('-').reverse().join('/'); // AAAA-MM-DD → DD/MM/AAAA
  return {
    linha: `${p.contribuinte.cnpj};${p.codigoServico};${p.referencia};${vencBr};${p.valor.toFixed(2)};1`,
    valor: p.valor,
  };
}

/**
 * Monta o lote TXT completo. Erro em QUALQUER item aborta o lote inteiro
 * (guia de imposto não sai "quase certa"); >50 itens = dividir em 2 lotes.
 * @returns {{ texto: string, linhas: string[], totalValor: number }}
 */
export function montarLoteTxt(itens) {
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new Error('Lote vazio — selecione ao menos uma guia.');
  }
  if (itens.length > MAX_DOCS_LOTE_DARE) {
    throw new Error(`Lote com ${itens.length} documentos — o portal aceita no máximo ${MAX_DOCS_LOTE_DARE} por lote. Divida em lotes menores.`);
  }
  const montados = itens.map((item, i) => {
    try {
      return montarItemLote(item);
    } catch (e) {
      throw new Error(`Item ${i + 1} (${item?.razaoSocial || item?.cnpj || '?'}): ${e.message}`);
    }
  });
  const linhas = montados.map((m) => m.linha);
  // 🚨 O total era somado dos itens CRUS (`Number(it.valor || 0)`), enquanto
  // cada linha sai do valor VALIDADO em centavos por `montarDare` (03/09). O
  // total podia divergir da soma das linhas — e readmitir o que `montarDare`
  // tinha acabado de recusar. O total é a soma das LINHAS, centavo a centavo.
  const totalValor = montados.reduce((s, m) => s + Math.round(m.valor * 100), 0) / 100;
  return { texto: linhas.join('\n'), linhas, totalValor };
}
