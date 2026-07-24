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
  const s = String(ref || '').trim();
  let m = s.match(/^(\d{2})\/(\d{4})$/);
  if (m) {
    const mes = Number(m[1]);
    if (mes >= 1 && mes <= 12) return `${m[1]}/${m[2]}`;
    return null;
  }
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const mes = Number(m[2]);
    if (mes >= 1 && mes <= 12) return `${m[2]}/${m[1]}`;
    return null;
  }
  return null;
}

/**
 * Monta e VALIDA o payload de um DARE-ICMS. Não emite nada — devolve os dados
 * conferíveis (mesmos campos do documento real) ou lança erro em português
 * com a AÇÃO prática. Zero tolerância: campo inválido = não sai guia.
 */
export function montarDare({ cnpj, razaoSocial, codigoServico, referencia, valor, vencimento }) {
  const cnpjNum = String(cnpj || '').replace(/\D/g, '');
  if (cnpjNum.length !== 14) {
    throw new Error(`CNPJ inválido ("${cnpj || ''}"). Confira o cadastro da empresa.`);
  }
  const nome = String(razaoSocial || '').trim();
  if (!nome) throw new Error('Razão social vazia — confira o cadastro da empresa.');

  const svc = CODIGOS_DARE_ICMS[String(codigoServico || '').trim()];
  if (!svc) {
    const validos = Object.keys(CODIGOS_DARE_ICMS).join(', ');
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
