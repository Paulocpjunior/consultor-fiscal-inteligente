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

/**
 * Falha de REDE numa emissão é ambígua: a conexão pode ter caído DEPOIS de a
 * SEFAZ criar a guia. Por isso nunca reenviamos POST sozinhos (duplicaria
 * DARE) — sinalizamos `indeterminado` e mandamos conferir antes de reemitir.
 * GET (/receitas) é idempotente: esse sim tenta de novo.
 */
function erroDeRede(e) {
  const m = String(e?.message || e || '').toLowerCase();
  return e?.name === 'AbortError' || m.includes('fetch failed') || m.includes('econnreset')
    || m.includes('etimedout') || m.includes('enotfound') || m.includes('socket') || m.includes('network');
}

async function chamar(caminho, { metodo = 'GET', corpo = null, ambiente = AMBIENTE_PADRAO, tentativas = 1 } = {}) {
  const amb = resolverAmbiente(ambiente);
  const apiKey = await obterApiKey(amb.nome);
  const url = `${amb.baseUrl}${caminho}`;

  let resp;
  let ultimoErro = null;
  for (let n = 1; n <= tentativas; n++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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
      clearTimeout(timer);
      ultimoErro = null;
      break;
    } catch (e) {
      clearTimeout(timer);
      ultimoErro = e;
      if (n < tentativas && erroDeRede(e)) {
        await new Promise((r) => setTimeout(r, 1500 * n));
        continue;
      }
      break;
    }
  }

  if (ultimoErro) {
    const e = ultimoErro;
    const ehPost = metodo === 'POST';
    const base = e.name === 'AbortError'
      ? `A API DARE da SEFAZ não respondeu em ${Math.round(TIMEOUT_MS / 1000)}s (${amb.nome})`
      : `A conexão com a API DARE da SEFAZ falhou (${amb.nome}): ${e.message}`;
    const erro = new Error(ehPost
      ? `${base}. ATENÇÃO: a guia PODE ter sido emitida mesmo assim — confira antes de emitir de novo, `
        + 'para não gerar DARE duplicado. O registro ficou marcado como indeterminado na auditoria.'
      : `${base}. Tente de novo em instantes.`);
    erro.erroDeRede = true;
    erro.indeterminado = ehPost;
    throw erro;
  }

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
  // GET é idempotente: 3 tentativas com espera crescente absorvem a queda de
  // rede intermitente do gateway (fetch failed visto em 27/07).
  return chamar('/receitas', { metodo: 'GET', ambiente, tentativas: 3 });
}

/**
 * 'AAAA-MM-DD' → 'AAAA-MM-DDT00:00:00'. O Swagger declara dataVencimento como
 * date-time; mandar só a data é convite a 400 (ou a fuso comendo um dia).
 */
export function paraDataHora(data) {
  const s = String(data || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00`;
  return s;
}

/**
 * Monta o DareApiDTO no formato REAL do Swagger (conferido em 27/07/2026).
 * PURO — separado da chamada pra ser conferido no preview antes de emitir.
 *
 * Atenção ao que o Swagger revelou: NÃO existe campo `codigoServico` solto —
 * o serviço vai dentro do objeto `receita` (ReceitaApiDTO.codigoServicoDARE,
 * que é INTEIRO). Mandar como estava daria 400 em toda emissão.
 */
export function montarDareApiDTO({
  cnpj, razaoSocial, codigoServico, codigoReceita, referencia, valor, dataVencimento,
  linha06, linha08, gerarPDF = true,
}) {
  const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
  const servico = normalizarCodigoServico(codigoServico);
  const extra = validarCamposExtra({ codigoServico: servico, linha06, linha08 });
  if (!extra.ok) {
    const erro = new Error(extra.erros.join(' '));
    erro.camposInvalidos = extra.erros;
    throw erro;
  }
  const receita = { codigoServicoDARE: Number(servico) };
  // `codigo` é o código de receita impresso no DARE ('046-2'); mandamos quando
  // conhecemos, porque é o que o operador confere no documento.
  if (codigoReceita) receita.codigo = String(codigoReceita);

  return {
    cnpj: cnpjLimpo,
    razaoSocial: razaoSocial ? String(razaoSocial).slice(0, 120) : undefined,
    receita,
    referencia,                             // 'MM/AAAA'
    dataVencimento: paraDataHora(dataVencimento),
    valor: Number(valor),
    gerarPDF: gerarPDF !== false,
    ...extra.campos,                        // linha06/linha08 só quando a receita usa
  };
}

/**
 * A API responde 200 mesmo quando REJEITA: o motivo vem em
 * `erro: { estaOk: false, mensagens: [...] }`. Tratar 200 como sucesso cego
 * daria "DARE emitido" sem número nenhum — verde mentiroso.
 * @returns {string|null} mensagem de recusa, ou null se está tudo certo.
 */
export function extrairRecusa(resposta) {
  if (!resposta || typeof resposta !== 'object') return null;
  const erros = [];
  const coletar = (e) => {
    if (!e || typeof e !== 'object') return;
    if (e.estaOk === false || (Array.isArray(e.mensagens) && e.mensagens.length > 0)) {
      const msgs = (e.mensagens || []).filter(Boolean);
      if (e.estaOk === false || msgs.length) erros.push(msgs.join(' · ') || 'recusado sem detalhe');
    }
  };
  coletar(resposta.erro);
  for (const item of resposta.itensParaGeracao || []) coletar(item.erro);
  if (erros.length === 0) return null;
  return `A SEFAZ recusou a emissão: ${[...new Set(erros)].join(' | ')}`;
}

/**
 * Extrai o que interessa do retorno: é o comprovante (número, barras, Pix).
 * O PDF (documentoImpressao, base64) sai separado — não cabe no Firestore.
 */
export function resumirRetornoDare(resposta) {
  const item = resposta?.itensParaGeracao?.[0] || resposta || {};
  return {
    numeroControle: item.numeroControleDarePrincipal ?? null,
    codigoBarra44: item.codigoBarra44 ?? null,
    codigoBarra48: item.codigoBarra48 ?? null,
    pixCopiaCola: item.pixCopiaCola ?? null,
    valorTotal: item.valorTotal ?? item.valor ?? null,
    valorJuros: item.valorJuros ?? null,
    valorMulta: item.valorMulta ?? null,
    temPdf: !!item.documentoImpressao,
    zipLote: !!resposta?.zipDownload,
  };
}

/** Emite UM DARE. Devolve o retorno cru da SEFAZ (número, barras, Pix, PDF). */
export async function emitirDareUnitario(dto, { ambiente = AMBIENTE_PADRAO } = {}) {
  const resposta = await chamar('/dare-unitario/emitir', { metodo: 'POST', corpo: dto, ambiente });
  const recusa = extrairRecusa(resposta);
  if (recusa) {
    const erro = new Error(recusa);
    erro.recusadoPelaSefaz = true;
    erro.corpo = resposta;
    throw erro;
  }
  return resposta;
}

/**
 * Emite um LOTE de DAREs.
 *
 * O Swagger mostrou que o corpo NÃO é um array: é o DareLoteApiDTO, com os
 * DAREs em `itensParaGeracao` (e o ZIP dos documentos volta em zipDownload).
 * Regra da SEFAZ: o `gerarPDF` do PRIMEIRO item vale para o lote inteiro —
 * normalizamos para não sair lote com metade sem PDF.
 */
export async function emitirDareLote(dtos, { ambiente = AMBIENTE_PADRAO } = {}) {
  if (!Array.isArray(dtos) || dtos.length === 0) {
    throw new Error('Lote vazio: informe ao menos um DARE.');
  }
  const gerarPDF = dtos[0].gerarPDF !== false;
  const corpo = { itensParaGeracao: dtos.map((d) => ({ ...d, gerarPDF })) };
  const resposta = await chamar('/dare-lote/emitir', { metodo: 'POST', corpo, ambiente });
  const recusa = extrairRecusa(resposta);
  if (recusa) {
    const erro = new Error(recusa);
    erro.recusadoPelaSefaz = true;
    erro.corpo = resposta;
    throw erro;
  }
  return resposta;
}
