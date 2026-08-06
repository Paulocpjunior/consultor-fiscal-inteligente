// ============================================================================
// sefaz-backend/manifesto-orchestrator.js  (ESM)
// Orquestrador de manifestação automática.
// ============================================================================

import admin from 'firebase-admin';
import { manifestarNFe, TIPOS_MANIFESTACAO } from './manifesto-client.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { loadCertEmpresa, loadCertEmpresaPorCnpjBase } from './cert-storage.js';
import { loadCertificate, extrairPem } from './secret-loader.js';
import { consultaNFePorChave } from './sefaz-client.js';
import { carregarFlagsEmpresa, CNPJ_ESCRITORIO } from './empresa-flags.js';
import { ehErroInfra, planejarLiberacao } from './manifesto-poison.js';

const TIPOS_QUE_BLOQUEIAM_NOVA_MANIFESTACAO = new Set([
  'manifestacao_ciencia',
  'manifestacao_confirmacao',
  'manifestacao_desconhecimento',
  'manifestacao_nao_realizada',
]);

const STATUS_QUE_BLOQUEIAM = new Set(['cancelado', 'denegado', 'inutilizado']);

// Prazo SEFAZ (Ajuste SINIEF 9/2007 Cláusula 21 + Manual ENT 6.0):
//   Ciência/Confirmação:        ate 180 dias da emissao (cienca automatica apos)
//   Desconhecimento:            ate 10 dias da ciencia (automatica ou manual)
//   Operacao Nao Realizada:     ate 10 dias da ciencia
//
// Como o app nem sempre tem registro da ciencia automatica, usamos a
// emissao como referencia. Como buffer conservador: 180 dias pra
// Ciencia/Confirmacao (regra geral) e 30 dias pra Desconhecimento/Nao
// Realizada (com aviso pro contador conferir manualmente o prazo).
const IDADE_MAX_DIAS_POR_TIPO = {
  ciencia: 180,
  confirmacao: 180,
  desconhecimento: 30,
  nao_realizada: 30,
};
const IDADE_MAX_PADRAO = 180;

function fa() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin;
}

function temManifestacao(doc) {
  const eventos = doc.eventos || [];
  return eventos.some(e => TIPOS_QUE_BLOQUEIAM_NOVA_MANIFESTACAO.has(e.tipo));
}

function ehElegivel(doc, tipoPretendido = 'ciencia') {
  if (doc.direcao !== 'entrada') return { ok: false, motivo: 'Não é entrada' };
  if (STATUS_QUE_BLOQUEIAM.has(doc.status)) return { ok: false, motivo: `status=${doc.status}` };
  if (temManifestacao(doc)) return { ok: false, motivo: 'Já manifestada' };
  if (doc.dhEmi) {
    const idadeDias = (Date.now() - new Date(doc.dhEmi).getTime()) / (1000 * 3600 * 24);
    const idadeMax = IDADE_MAX_DIAS_POR_TIPO[tipoPretendido] ?? IDADE_MAX_PADRAO;
    if (idadeDias > idadeMax) return { ok: false, motivo: `Emitida há ${Math.round(idadeDias)} dias (>${idadeMax} pra '${tipoPretendido}')` };
    if (idadeDias < 0) return { ok: false, motivo: 'dhEmi futuro?' };
  }
  if (!doc.empresaCnpj && !doc.cnpjDest) return { ok: false, motivo: 'Sem CNPJ destinatário' };
  return { ok: true };
}

// Vazão do lote (caso 22/07: 3.889 resumos presos com o cron "rodando"):
//  - COOLDOWN_FALHA_MS: chave que falhou espera antes de voltar ao lote —
//    sem isso as mesmas falhas re-ocupavam os 500 slots toda janela e o
//    resto da fila morria de fome.
//  - MAX_FALHAS: depois disso a chave sai do lote (poison) — continua visível
//    como pendente no Backlog de Entrada, mas não desperdiça mais slots.
const COOLDOWN_FALHA_MANIFESTACAO_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_FALHAS_MANIFESTACAO = 8;

// Intercala os docs por RAIZ de CNPJ (round-robin). PURO/testável. Sem isto,
// uma empresa com 500+ resumos (APATEL: 523) comia o lote inteiro martelando
// UMA raiz — que entrava em cStat 656 no meio — e as demais nunca chegavam
// ao lote. Intercalado, cada raiz recebe poucas chamadas por janela e o 656
// para de ser provocado pelo próprio lote.
export function intercalarPorRaiz(docs) {
  const filas = new Map(); // raiz -> fila de docs (ordem original preservada)
  for (const d of docs) {
    const raiz = String(d.empresaCnpj || d.cnpjDest || '').replace(/\D/g, '').slice(0, 8) || '?';
    if (!filas.has(raiz)) filas.set(raiz, []);
    filas.get(raiz).push(d);
  }
  const out = [];
  const chaves = [...filas.keys()];
  let restam = docs.length;
  while (restam > 0) {
    for (const raiz of chaves) {
      const fila = filas.get(raiz);
      if (fila.length === 0) continue;
      out.push(fila.shift());
      restam--;
    }
  }
  return out;
}

export async function listarElegiveis({ empresaId = null, limit = 50, tipo = 'ciencia' } = {}) {
  const db = fa().firestore();
  // 'in' inclui os RESUMOS (resNFe): sao exatamente eles que precisam de
  // Ciencia pra SEFAZ liberar a procNFe completa. O filtro antigo
  // tipoDoc=='NFe' manifestava so notas ja completas e deixava os resumos
  // presos como "Resumo/R$ sem itens" pra sempre.
  let baseQuery = db.collection('documentos_fiscais')
    .where('direcao', '==', 'entrada')
    .where('tipoDoc', 'in', ['resNFe', 'NFe']);
  if (empresaId) baseQuery = baseQuery.where('empresaId', '==', empresaId);

  // Pagina sem limite arbitrario; corta pela quantidade de elegiveis,
  // nao pela query bruta (antes truncava em 500 e podia faltar candidatos).
  const snapDocs = await fetchAllDocs(baseQuery, { label: 'documentos_fiscais/manifest-elegiveis' });
  const agora = Date.now();
  const elegiveis = [];
  for (const d of snapDocs) {
    const doc = { id: d.id, ...d.data() };
    const check = ehElegivel(doc, tipo);
    if (!check.ok) continue;
    // Poison/cooldown: não desperdiça slot com chave que acabou de falhar.
    const falhas = Number(doc.manifestacaoFalhas) || 0;
    if (falhas >= MAX_FALHAS_MANIFESTACAO) continue;
    const ultimaFalhaMs = Number(doc.ultimaFalhaManifestacaoMs) || 0;
    if (ultimaFalhaMs && (agora - ultimaFalhaMs) < COOLDOWN_FALHA_MANIFESTACAO_MS) continue;
    elegiveis.push(doc);
  }
  // Resumos primeiro (destravam XML completo); dentro disso, intercala por
  // raiz CNPJ pro lote não martelar uma raiz só (anti-656 + anti-fome).
  const resumos = elegiveis.filter((d) => d.tipoDoc === 'resNFe');
  const completas = elegiveis.filter((d) => d.tipoDoc !== 'resNFe');
  return [...intercalarPorRaiz(resumos), ...intercalarPorRaiz(completas)].slice(0, limit);
}

/**
 * Por que os resumos desta empresa NÃO estão sendo manifestados.
 *
 * Caso que motivou (KJM, 05/08): nota de 28/07 seguia como resumo — o
 * colaborador via "sem produto" e nenhuma explicação. O motivo SEMPRE existe
 * no documento (idade, cooldown, poison de falhas, status), mas morria dentro
 * do laço. Zero manifestada não pode sair como sucesso mudo.
 *
 * Devolve contagem por motivo + a última falha registrada, pra tela dizer se
 * é esperar ou escalar.
 */
export async function diagnosticarPendencias({ empresaId, tipo = 'ciencia' } = {}) {
  const db = fa().firestore();
  let q = db.collection('documentos_fiscais')
    .where('direcao', '==', 'entrada')
    .where('tipoDoc', 'in', ['resNFe', 'NFe']);
  if (empresaId) q = q.where('empresaId', '==', empresaId);

  const docs = await fetchAllDocs(q, { label: 'documentos_fiscais/manifest-diagnostico' });
  const agora = Date.now();
  const porMotivo = {};
  // Motivo TÉCNICO da recusa (rejeição da SEFAZ, certificado, TLS) — é o que
  // diz se dá pra resolver aqui ou se é problema do cliente. Fica separado da
  // contagem por SITUAÇÃO (poison/cooldown/idade), que só diz onde a chave
  // parou.
  const porMotivoFalha = {};
  let ultimaFalha = null;
  const conta = (motivo) => { porMotivo[motivo] = (porMotivo[motivo] || 0) + 1; };
  const contaFalha = (doc) => {
    // CAMPO CERTO: `ultimaFalhaManifestacaoMotivo` é o que carimbarFalha
    // grava. A 1ª versão deste diagnóstico lia `ultimoErroManifestacao`, que
    // não existe — então a tela dizia "6× Desistimos após 8 falhas" e ficava
    // muda justo sobre O QUE falhou (caso KJM, 05/08).
    const m = String(doc.ultimaFalhaManifestacaoMotivo || '').trim();
    if (!m) return;
    porMotivoFalha[m] = (porMotivoFalha[m] || 0) + 1;
    ultimaFalha = m.slice(0, 200);
  };

  for (const d of docs) {
    const doc = { id: d.id, ...d.data() };
    const check = ehElegivel(doc, tipo);
    if (!check.ok) { conta(check.motivo); continue; }
    const falhas = Number(doc.manifestacaoFalhas) || 0;
    if (falhas >= MAX_FALHAS_MANIFESTACAO) {
      conta(`Desistimos após ${falhas} falhas`);
      contaFalha(doc);
      continue;
    }
    const ultimaFalhaMs = Number(doc.ultimaFalhaManifestacaoMs) || 0;
    if (ultimaFalhaMs && (agora - ultimaFalhaMs) < COOLDOWN_FALHA_MANIFESTACAO_MS) {
      const horas = Math.ceil((COOLDOWN_FALHA_MANIFESTACAO_MS - (agora - ultimaFalhaMs)) / 3600000);
      conta(`Falhou há pouco — volta ao lote em ~${horas}h`);
      contaFalha(doc);
      continue;
    }
    conta('Elegível (deveria manifestar)');
  }
  return { porMotivo, porMotivoFalha, ultimaFalha, documentos: docs.length };
}

// Resolve o certificado A1 que ASSINA o evento. A SEFAZ exige que o autor do
// evento (CNPJ destinatário) tenha a mesma raiz CNPJ do certificado — o cert
// do escritório era usado pra todos e a manifestação de clientes voltava
// rejeitada (autor ≠ cert), deixando os resumos sem upgrade pra completa.
async function resolverCertDestinatario(cnpjDestinatario, empresaId = null) {
  const cnpjNum = String(cnpjDestinatario || '').replace(/\D/g, '');
  let cert = null;
  if (empresaId) {
    try {
      cert = await loadCertEmpresa(empresaId);
      const notAfterMs = cert?.notAfter ? Date.parse(cert.notAfter) : null;
      if (notAfterMs && notAfterMs <= Date.now()) {
        console.warn(`[manifesto] cert da empresa ${empresaId} vencido em ${cert.notAfter}; buscando A1 da mesma raiz`);
        cert = null;
      }
    } catch (e) {
      console.warn(`[manifesto] erro carregando cert empresa ${empresaId}:`, e.message);
    }
  }
  if (!cert && cnpjNum !== CNPJ_ESCRITORIO) {
    try {
      cert = await loadCertEmpresaPorCnpjBase(cnpjNum, empresaId);
    } catch (e) {
      console.warn(`[manifesto] erro buscando cert por raiz CNPJ ${cnpjNum}:`, e.message);
    }
  }
  if (cert) {
    const certBase = String(cert.cnpj || '').replace(/\D/g, '').slice(0, 8);
    if (certBase && certBase !== cnpjNum.slice(0, 8)) {
      console.warn(`[manifesto] cert encontrado tem raiz ${certBase}, esperado ${cnpjNum.slice(0, 8)} — ignorando`);
      cert = null;
    }
  }
  if (cert) {
    const pem = extrairPem(cert.pfxBuffer, cert.password);
    // pkcs12 + pfxBuffer: manifesto-client usa pkcs12 no mTLS; sefaz-client
    // (consChNFe do re-download) usa pfxBuffer. Mantém os dois preenchidos.
    return {
      pemKey: pem.pemKey, pemCert: pem.pemCert,
      pkcs12: cert.pfxBuffer, pfxBuffer: cert.pfxBuffer,
      password: cert.password, cnpj: cert.cnpj,
    };
  }
  // Escritório manifestando as próprias notas: cert global do Secret Manager.
  if (cnpjNum.slice(0, 8) === CNPJ_ESCRITORIO.slice(0, 8)) {
    return loadCertificate();
  }
  throw new Error(
    `Manifestação exige A1 da raiz CNPJ do destinatário (${cnpjNum}) e nenhum certificado válido foi encontrado. ` +
    `Envie o A1 da empresa — o certificado do escritório não pode assinar evento de cliente (SEFAZ rejeita autor de raiz diferente).`
  );
}

// Depois da Ciência/Confirmação aceita, a SEFAZ libera a procNFe completa.
// Antes o app esperava a completa "aparecer" num próximo DistDFe (que podia
// nunca reprocessá-la); agora busca na hora via consulta por chave e importa
// (o xml-importer faz o upgrade resumo→completa).
async function baixarCompletaAposManifestacao({ chNFe, cnpjDestinatario, empresaId, uf, certOverride, capturadoPor }) {
  try {
    if (!empresaId) return { ok: false, motivo: 'sem empresaId — completa virá no próximo DistDFe' };
    const ufFinal = uf || (await carregarFlagsEmpresa(empresaId, cnpjDestinatario)).uf;
    if (!ufFinal) return { ok: false, motivo: 'UF não cadastrada — completa virá no próximo DistDFe' };
    // SEFAZ leva alguns segundos pra propagar o evento antes de liberar o XML.
    await new Promise(r => setTimeout(r, 3000));
    const r = await consultaNFePorChave({ chave: chNFe, cnpjInteressado: cnpjDestinatario, uf: ufFinal, certOverride });
    if (r.rateLimited) return { ok: false, motivo: 'SEFAZ cStat 656 (rate limit)' };
    const { importarXmlSefaz } = await import('./xml-importer.js');
    let importados = 0;
    for (const doc of r.xmls || []) {
      if (!doc.xml) continue;
      const imp = await importarXmlSefaz({
        empresaId, empresaCnpj: cnpjDestinatario,
        xml: doc.xml, schema: doc.schema, nsu: doc.nsu,
        capturadoPor: { ...(capturadoPor || {}), motivo: 'redownload-pos-manifestacao' },
      });
      if (imp.status === 'ok' || imp.status === 'atualizado') importados++;
    }
    return { ok: true, cStat: r.cStat, docsRetornados: (r.xmls || []).length, importados };
  } catch (e) {
    console.warn(`[manifesto] re-download pós-manifestação ${chNFe} falhou:`, e.message);
    return { ok: false, motivo: e.message };
  }
}

// skipRedownload=true pula o consChNFe pós-ciência. IMPORTANTE em lote: o
// re-download bate no MESMO webservice NFeDistribuicaoDFe da captura — dezenas
// de consChNFe em rajada geram cStat=656 (Consumo Indevido) e DERRUBAM a
// paginação DistDFe da própria empresa (caso VINATEX: captura parava no meio,
// "faltavam notas" todo dia). A completa chega no próximo ciclo DistDFe.
export async function manifestarUma({ chNFe, cnpjDestinatario, tipo = 'ciencia', xJustificativa = null, dryRun = false, capturadoPor = null, empresaId = null, uf = null, skipRedownload = false }) {
  if (!TIPOS_MANIFESTACAO.includes(tipo)) {
    throw new Error(`Tipo inválido: ${tipo}. Use: ${TIPOS_MANIFESTACAO.join(', ')}`);
  }

  // Validacao fiscal — operacao IRREVERSIVEL na SEFAZ.
  // Manual ENT 6.0: operacao_nao_realizada exige justificativa 15-255 chars.
  // Desconhecimento aceita justificativa opcional. Ciencia/Confirmacao nao usam.
  if (tipo === 'operacao_nao_realizada' || tipo === 'nao_realizada') {
    const just = String(xJustificativa || '').trim();
    if (just.length < 15) {
      throw new Error(`Manifestacao 'operacao_nao_realizada' EXIGE xJustificativa com 15-255 caracteres (Manual SEFAZ ENT 6.0). Recebido: ${just.length} chars.`);
    }
    if (just.length > 255) {
      throw new Error(`xJustificativa deve ter no maximo 255 caracteres (Manual SEFAZ ENT 6.0). Recebido: ${just.length} chars.`);
    }
  }

  // Assina com o A1 da EMPRESA destinatária (nunca o do escritório pra cliente).
  const certOverride = await resolverCertDestinatario(cnpjDestinatario, empresaId);
  const result = await manifestarNFe({ chNFe, cnpjDestinatario, tipo, xJustificativa, dryRun, certOverride });

  const db = fa().firestore();
  const auditoria = {
    chNFe,
    cnpjDestinatario,
    tipo,
    dryRun,
    idAttr: result.idAttr,
    capturadoPor: capturadoPor || null,
    createdAt: fa().firestore.FieldValue.serverTimestamp(),
  };

  if (!dryRun && result.retorno) {
    auditoria.cStatLote = result.retorno.cStatLote;
    auditoria.xMotivoLote = result.retorno.xMotivoLote;
    auditoria.eventosRetornados = result.retorno.eventos;

    const evtAceito = result.retorno.eventos.find(e => ['135', '136'].includes(e.cStat));
    if (evtAceito) {
      const docRef = db.collection('documentos_fiscais').doc(chNFe);
      const snap = await docRef.get();
      if (snap.exists && !empresaId) empresaId = snap.data().empresaId || null;
      if (snap.exists) {
        const eventosExistentes = snap.data().eventos || [];
        const novoEvento = {
          tpEvento: evtAceito.tpEvento,
          tipo: `manifestacao_${tipo}`,
          descricao: tipo === 'ciencia' ? 'Ciência da Operação' :
                     tipo === 'confirmacao' ? 'Confirmação da Operação' :
                     tipo === 'desconhecimento' ? 'Desconhecimento da Operação' :
                     'Operação não Realizada',
          nSeqEvento: '1',
          dhEvento: evtAceito.dhRegEvento,
          nProt: evtAceito.nProt,
          cStat: evtAceito.cStat,
          xMotivo: evtAceito.xMotivo,
          importadoPor: capturadoPor?.email || 'manifesto-auto',
        };
        await docRef.update({ eventos: [...eventosExistentes, novoEvento] });
      }
      // Ciência/Confirmação aceita → busca a procNFe completa na hora.
      // Em lote (skipRedownload), adia: a completa vem no próximo DistDFe.
      if (tipo === 'ciencia' || tipo === 'confirmacao') {
        auditoria.baixaCompleta = skipRedownload
          ? { ok: false, adiada: true, motivo: 'lote — completa virá no próximo ciclo DistDFe' }
          : await baixarCompletaAposManifestacao({
              chNFe,
              cnpjDestinatario: String(cnpjDestinatario).replace(/\D/g, ''),
              empresaId, uf, certOverride, capturadoPor,
            });
      }
    }
  }

  await db.collection('manifestacoes_log').add(auditoria);
  return result;
}

// Detecta rate-limit (cStat 656 / Consumo Indevido) em qualquer forma que a
// falha apareça (cStat do evento, mensagem de erro, motivo do provider).
function ehRateLimit656(cStat, texto) {
  if (String(cStat) === '656') return true;
  return /656|consumo indevido/i.test(String(texto || ''));
}

// Falha de INFRA (TLS/rede/timeout) diz respeito ao AMBIENTE, não à chave —
// não pode envenenar o contador poison (MAX_FALHAS tirava a chave do lote
// PRA SEMPRE). Caso 24/07: host errado no manifesto-client gerou 486×
// "unable to get local issuer certificate" e envenenou lotes inteiros de
// chaves perfeitamente manifestáveis.
// A definição mora em manifesto-poison.js (puro); aqui só reexporta pra não
// quebrar quem já importava daqui.
export { ehErroInfra };

/**
 * Reseta o carimbo de falha das chaves cujo ÚLTIMO motivo foi erro de INFRA
 * (TLS/rede) — limpa o veneno deixado pelo bug do host (24/07: 486× TLS
 * incrementaram manifestacaoFalhas de chaves saudáveis; com >=8 elas saíam
 * do lote pra sempre). Zera contador + cooldown pra voltarem já na próxima
 * janela do cron. Idempotente.
 */
export async function resetarFalhasInfraManifestacao() {
  const db = fa().firestore();
  const snap = await db.collection('documentos_fiscais')
    .where('manifestacaoFalhas', '>=', 1).get();
  const r = { candidatos: 0, resetados: 0 };
  let batch = db.batch();
  let noBatch = 0;
  for (const d of snap.docs) {
    r.candidatos++;
    const doc = d.data() || {};
    if (!ehErroInfra(doc.ultimaFalhaManifestacaoMotivo)) continue;
    batch.update(d.ref, {
      manifestacaoFalhas: admin.firestore.FieldValue.delete(),
      ultimaFalhaManifestacaoMs: admin.firestore.FieldValue.delete(),
      ultimaFalhaManifestacaoMotivo: admin.firestore.FieldValue.delete(),
    });
    r.resetados++;
    noBatch++;
    if (noBatch >= 400) { await batch.commit(); batch = db.batch(); noBatch = 0; }
  }
  if (noBatch > 0) await batch.commit();
  console.log(`[manifesto] reset falhas infra: ${r.resetados}/${r.candidatos} chaves limpas`);
  return r;
}

/**
 * "Tentar de novo" depois de CORRIGIDA a causa: devolve ao lote as chaves que
 * bateram no teto de falhas (poison) de UMA empresa.
 *
 * Sem isso, o poison era definitivo: o colaborador via "6× Desistimos após 8
 * falhas", renovava o certificado, e nada voltava (caso KJM, 05/08). O reset
 * automático só cobre erro de INFRA — poison de causa humana/cadastral
 * precisava desta porta.
 *
 * `empresaId` é OBRIGATÓRIO de propósito: liberação global viraria "limpar
 * tudo" e devolveria ao lote chaves cuja causa ninguém tocou, queimando
 * requisição na SEFAZ e re-armando o mesmo poison.
 */
export async function liberarPoisonManifestacao({ empresaId, dryRun = false } = {}) {
  if (!empresaId) throw new Error('liberarPoisonManifestacao exige empresaId — liberação global não é permitida.');
  const db = fa().firestore();
  const q = db.collection('documentos_fiscais')
    .where('direcao', '==', 'entrada')
    .where('tipoDoc', 'in', ['resNFe', 'NFe'])
    .where('empresaId', '==', empresaId);
  const docs = await fetchAllDocs(q, { label: 'documentos_fiscais/manifest-liberar-poison' });

  const plano = planejarLiberacao(docs.map((d) => ({ id: d.id, ...d.data() })), { max: MAX_FALHAS_MANIFESTACAO });
  if (dryRun || plano.total === 0) {
    return { total: plano.total, porMotivo: plano.porMotivo, infra: plano.infra, dryRun };
  }

  let batch = db.batch();
  let noBatch = 0;
  for (const doc of plano.liberar) {
    batch.update(db.collection('documentos_fiscais').doc(doc.id), {
      manifestacaoFalhas: admin.firestore.FieldValue.delete(),
      // Cooldown também sai: a chave volta JÁ na próxima janela, senão o
      // colaborador clica, não acontece nada por 6h e conclui que não funcionou.
      ultimaFalhaManifestacaoMs: admin.firestore.FieldValue.delete(),
      // O MOTIVO fica gravado: é o histórico de por que ela estava fora, e é o
      // que a tela mostra pra pessoa conferir se corrigiu a coisa certa.
      poisonLiberadoEm: Date.now(),
    });
    noBatch++;
    if (noBatch >= 400) { await batch.commit(); batch = db.batch(); noBatch = 0; }
  }
  if (noBatch > 0) await batch.commit();
  console.log(`[manifesto] poison liberado: ${plano.total} chave(s) da empresa ${empresaId}`);
  return { total: plano.total, porMotivo: plano.porMotivo, infra: plano.infra, dryRun: false };
}

export async function manifestarPendentes({ empresaId = null, limit = 50, dryRun = false, tipo = 'ciencia', capturadoPor = null, skipRedownload = true } = {}) {
  const db = fa().firestore();
  const elegiveis = await listarElegiveis({ empresaId, limit, tipo });
  const resultado = { total: elegiveis.length, sucessos: 0, falhas: 0, puladas656: 0, detalhes: [] };
  // Circuit-breaker por RAIZ: primeiro 656 numa raiz → pula os demais docs da
  // mesma raiz NESTE run (insistir só re-arma o bloqueio; a raiz volta na
  // próxima janela do cron). O resto do lote (outras raízes) segue normal.
  const raizesBloqueadas = new Set();

  // Carimbo de falha no doc — alimenta o cooldown/poison do listarElegiveis.
  // Sem isto a mesma chave falha voltava em TODA janela e entupia o lote.
  // Falha de INFRA (TLS/rede) NÃO incrementa o poison: só carimba o cooldown
  // (evita martelar enquanto o ambiente está quebrado) — a chave volta
  // normal assim que a infra sara, em vez de sair do lote pra sempre.
  const carimbarFalha = async (doc, motivo) => {
    if (dryRun) return;
    try {
      const update = {
        ultimaFalhaManifestacaoMs: Date.now(),
        ultimaFalhaManifestacaoMotivo: String(motivo || 'desconhecido').slice(0, 200),
      };
      if (!ehErroInfra(motivo)) {
        update.manifestacaoFalhas = admin.firestore.FieldValue.increment(1);
      }
      await db.collection('documentos_fiscais').doc(doc.id).update(update);
    } catch (e) {
      console.warn(`[manifestarPendentes] falha carimbando ${doc.chave}:`, e.message);
    }
  };

  for (const doc of elegiveis) {
    const raiz = String(doc.empresaCnpj || doc.cnpjDest || '').replace(/\D/g, '').slice(0, 8);
    if (raizesBloqueadas.has(raiz)) {
      resultado.puladas656++;
      // NÃO carimba falha: a chave não tentou — volta normal na próxima janela.
      continue;
    }
    try {
      const r = await manifestarUma({
        chNFe: doc.chave,
        cnpjDestinatario: doc.empresaCnpj || doc.cnpjDest,
        tipo,
        dryRun,
        capturadoPor,
        empresaId: doc.empresaId || null,
        // Lote NUNCA re-baixa via consChNFe por padrão: até 100 consultas em
        // rajada no NFeDistribuicaoDFe = cStat 656 pra raiz inteira por 1h+.
        skipRedownload,
      });
      const cStat = r.retorno?.eventos?.[0]?.cStat;
      const xMotivo = r.retorno?.eventos?.[0]?.xMotivo;
      const aceito = ['135', '136'].includes(cStat);
      if (aceito || dryRun) {
        resultado.sucessos++;
      } else {
        resultado.falhas++;
        await carimbarFalha(doc, `cStat ${cStat}: ${xMotivo || ''}`);
        if (ehRateLimit656(cStat, xMotivo)) raizesBloqueadas.add(raiz);
      }
      resultado.detalhes.push({
        chNFe: doc.chave, empresaId: doc.empresaId, tipo, dryRun,
        cStat, xMotivo,
      });
    } catch (err) {
      resultado.falhas++;
      await carimbarFalha(doc, err.message);
      if (ehRateLimit656(null, err.message)) raizesBloqueadas.add(raiz);
      resultado.detalhes.push({
        chNFe: doc.chave, empresaId: doc.empresaId, tipo, dryRun,
        erro: err.message,
      });
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (resultado.puladas656 > 0) {
    console.warn(`[manifestarPendentes] ${resultado.puladas656} doc(s) pulados por 656 na(s) raiz(es): ${[...raizesBloqueadas].join(', ')}`);
  }
  return resultado;
}
