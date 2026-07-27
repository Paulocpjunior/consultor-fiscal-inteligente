// ============================================================================
// sefaz-backend/dare-icms-api.js  (ESM — rede)
// ----------------------------------------------------------------------------
// Cliente da Web API oficial DARE-ICMS da SEFAZ-SP (credenciamento recebido em
// 27/07/2026). É a fase final prevista no dare-sp.js: o número do DARE e o
// código de barras SEMPRE foram do sistema da SEFAZ — com a API, o CFI passa a
// receber e arquivar em vez de mandar o operador digitar no portal.
//
// Ambientes (o de homologação emite DARE SEM validade — é onde se testa):
//   homologacao → https://apigateway-hml.fazenda.sp.gov.br/dare-icms
//   producao    → https://apigateway.fazenda.sp.gov.br/dare-icms
//
// Autenticação: header `api-key`. A chave NUNCA vive no código nem em variável
// de ambiente comum — vem do Secret Manager (uma por ambiente), com cache curto.
//
// Métodos: /receitas · /dare-unitario/emitir · /dare-lote/emitir
// ============================================================================

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { validarCamposExtra, normalizarCodigoServico } from './dare-icms-campos.js';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'consultorfiscalapp';

export const AMBIENTES = {
  homologacao: {
    baseUrl: 'https://apigateway-hml.fazenda.sp.gov.br/dare-icms',
    secret: process.env.DARE_ICMS_SECRET_HML || 'dare-icms-api-key-hml',
    rotulo: 'Homologação (DARE sem validade — não pode ser pago)',
  },
  producao: {
    baseUrl: 'https://apigateway.fazenda.sp.gov.br/dare-icms',
    secret: process.env.DARE_ICMS_SECRET_PROD || 'dare-icms-api-key-prod',
    rotulo: 'Produção (DARE válido, pagável na rede bancária e por Pix)',
  },
};

/** Ambiente padrão. Começa em homologação DE PROPÓSITO: virar a chave pra
 *  produção é decisão explícita (DARE de produção é cobrança de verdade). */
export const AMBIENTE_PADRAO = process.env.DARE_ICMS_AMBIENTE || 'homologacao';

const TIMEOUT_MS = Number(process.env.DARE_ICMS_TIMEOUT_MS || 30_000);
const CACHE_TTL_MS = 5 * 60 * 1000;
const cacheChaves = new Map(); // ambiente → { chave, carregadaEm }
let secretClient = null;

function getSecretClient() {
  if (!secretClient) secretClient = new SecretManagerServiceClient();
  return secretClient;
}

export function resolverAmbiente(nome) {
  const chave = String(nome || AMBIENTE_PADRAO).toLowerCase();
  const amb = AMBIENTES[chave];
  if (!amb) {
    throw new Error(`Ambiente DARE inválido: "${nome}". Use "homologacao" ou "producao".`);
  }
  return { nome: chave, ...amb };
}

/** Lê a api-key do Secret Manager (cache de 5 min). Nunca loga o valor. */
export async function obterApiKey(ambienteNome = AMBIENTE_PADRAO) {
  const amb = resolverAmbiente(ambienteNome);
  const cached = cacheChaves.get(amb.nome);
  if (cached && Date.now() - cached.carregadaEm < CACHE_TTL_MS) return cached.chave;
  const path = `projects/${PROJECT_ID}/secrets/${amb.secret}/versions/latest`;
  let chave;
  try {
    const [resp] = await getSecretClient().accessSecretVersion({ name: path });
    chave = resp.payload.data.toString('utf-8').trim();
  } catch (e) {
    throw new Error(
      `Não consegui ler a chave da API DARE (${amb.nome}). Grave o secret "${amb.secret}" no projeto ${PROJECT_ID} `
      + `e confira se a service account do Cloud Run tem acesso a ele. Detalhe técnico: ${e.message}`,
    );
  }
  if (!chave || chave.length < 8) {
    throw new Error(`A chave da API DARE (${amb.nome}) está vazia no secret "${amb.secret}".`);
  }
  cacheChaves.set(amb.nome, { chave, carregadaEm: Date.now() });
  return chave;
}

/** Zera o cache — usado quando o admin roda a rotação da chave. */
export function limparCacheApiKey() {
  cacheChaves.clear();
}

/**
 * Traduz a falha do gateway pra português com a AÇÃO (padrão interpretarCstat).
 * A api-key nunca entra na mensagem.
 */
export function traduzirErroDare(status, corpo) {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo || {});
  const trecho = texto.slice(0, 400);
  if (status === 401 || status === 403) {
    return 'A SEFAZ recusou a chave da API DARE (401/403). Confira se o secret do ambiente escolhido tem a chave certa '
      + 'e se ela não foi rotacionada — a chave de homologação não vale em produção e vice-versa.';
  }
  if (status === 404) {
    return 'Endpoint da API DARE não encontrado (404). O caminho mudou ou o ambiente está errado — confira a URL base do ambiente.';
  }
  if (status === 429) {
    return 'A SEFAZ limitou a quantidade de chamadas (429). Aguarde alguns minutos e emita de novo — sem reenviar em série.';
  }
  if (status >= 500) {
    return `A API DARE da SEFAZ está indisponível no momento (HTTP ${status}). Tente de novo em alguns minutos; `
      + `se persistir, emita pelo portal DARE e registre depois. Retorno: ${trecho}`;
  }
  if (status === 400 || status === 422) {
    return `A SEFAZ recusou os dados do DARE (HTTP ${status}): ${trecho}. Confira código de serviço, referência, `
      + 'vencimento e os campos linha06/linha08 exigidos pela receita.';
  }
  return `Falha na API DARE (HTTP ${status}): ${trecho}`;
}

async function chamar(caminho, { metodo = 'GET', corpo = null, ambiente = AMBIENTE_PADRAO } = {}) {
  const amb = resolverAmbiente(ambiente);
  const apiKey = await obterApiKey(amb.nome);
  const url = `${amb.baseUrl}${caminho}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, {
      method: metodo,
      headers: {
        'api-key': apiKey,
        Accept: 'application/json',
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new Error(`A API DARE não respondeu em ${Math.round(TIMEOUT_MS / 1000)}s (${amb.nome}). Tente de novo; se persistir, emita pelo portal.`);
    }
    throw new Error(`Não consegui falar com a API DARE (${amb.nome}): ${e.message}`);
  }
  clearTimeout(timer);

  const bruto = await resp.text();
  let dados = null;
  try { dados = bruto ? JSON.parse(bruto) : null; } catch { dados = bruto; }

  if (!resp.ok) {
    const erro = new Error(traduzirErroDare(resp.status, dados));
    erro.httpStatus = resp.status;
    erro.corpo = dados;
    throw erro;
  }
  return dados;
}

/** Lista as receitas/serviços aceitos pela API no ambiente. Também serve de
 *  teste de fumaça da credencial (é GET, não emite nada). */
export async function listarReceitas({ ambiente = AMBIENTE_PADRAO } = {}) {
  return chamar('/receitas', { metodo: 'GET', ambiente });
}

/**
 * Monta o objeto de um DARE no formato da API (DareApiDTO).
 * PURO — separado da chamada pra ser conferido no preview antes de emitir.
 */
export function montarDareApiDTO({
  cnpj, codigoServico, referencia, valor, dataVencimento, linha06, linha08, gerarPDF = true,
}) {
  const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
  const servico = normalizarCodigoServico(codigoServico);
  const extra = validarCamposExtra({ codigoServico: servico, linha06, linha08 });
  if (!extra.ok) {
    const erro = new Error(extra.erros.join(' '));
    erro.camposInvalidos = extra.erros;
    throw erro;
  }
  return {
    cnpj: cnpjLimpo,
    codigoServico: servico,
    referencia,          // 'MM/AAAA'
    dataVencimento,      // 'AAAA-MM-DD'
    valor: Number(valor),
    gerarPDF: gerarPDF !== false,
    ...extra.campos,     // linha06/linha08 só quando a receita usa
  };
}

/** Emite UM DARE. Devolve o retorno cru da SEFAZ (número, barras, PDF). */
export async function emitirDareUnitario(dto, { ambiente = AMBIENTE_PADRAO } = {}) {
  return chamar('/dare-unitario/emitir', { metodo: 'POST', corpo: dto, ambiente });
}

/**
 * Emite um LOTE de DAREs.
 * ATENÇÃO (regra da SEFAZ): o `gerarPDF` do PRIMEIRO item vale para o lote
 * inteiro — normalizamos para evitar lote com metade sem PDF.
 */
export async function emitirDareLote(dtos, { ambiente = AMBIENTE_PADRAO } = {}) {
  if (!Array.isArray(dtos) || dtos.length === 0) {
    throw new Error('Lote vazio: informe ao menos um DARE.');
  }
  const gerarPDF = dtos[0].gerarPDF !== false;
  const itens = dtos.map((d) => ({ ...d, gerarPDF }));
  return chamar('/dare-lote/emitir', { metodo: 'POST', corpo: itens, ambiente });
}
