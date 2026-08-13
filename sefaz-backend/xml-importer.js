// ============================================================================
// sefaz-backend/xml-importer.js  (ESM) — v2 com suporte a eventos NFe
// Pipeline: parse XML, sha256, upload Storage, set/update Firestore.
// Diferencial v2: eventos (cancelamento, CC-e) são ANEXADOS à NFe original
// em vez de criados como docs órfãos.
// ============================================================================

import crypto from 'crypto';
import admin from 'firebase-admin';
import { Storage } from '@google-cloud/storage';
import { classificarTipoDoc } from './xml-tipo-doc.js';
import { competenciaFromDhEmi, extrairParticipantesNfe, extrairAutXml, docCancelado, CSTAT_EVENTO_CANCELAMENTO } from './xml-metadata-helper.js';
import { decidirDonoPorParticipantes } from './atribuicao-participantes.js';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'consultorfiscalapp';
// CNPJ do escritório — é ele que o cliente põe no autXML da nota dele.
const CNPJ_ESCRITORIO_DIGITOS = String(process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const storage = new Storage();

function fa() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

// ── Decisao de gravacao (NFe/NFCe/CTe/MDFe, caminho nao-evento) ─────────────
// resNFe (resumo, ~531 bytes, SEM itens/valor) x procNFe (NFe COMPLETA). Vale
// tambem pra NFCe (modelo 65). O DistDFe entrega PRIMEIRO o resumo; a completa
// so e liberada apos a Manifestacao e chega numa DistDFe posterior — quando a
// chave JA EXISTE (gravada como resumo). Se o que esta na base e RESUMO e o que
// chega e COMPLETA, faz UPGRADE (sobrescreve com itens/totais, preservando
// eventos ja anexados via merge).
const isResumoSchema = (sch) => /^res(NFe|NFCe|CTe|MDFe)/.test(String(sch || ''));
const isResumoTipoDoc = (td) => td === 'resNFe' || td === 'resNFCe' || td === 'resCTe' || td === 'resMDFe';
// Modelo da chave (posicoes 20-21). Modelos 55/65 tem <det> quando COMPLETOS;
// 57 (CTe)/58 (MDFe) NUNCA tem itens. Por isso temItens=false so indica "resumo"
// para 55/65 — senao um resCTe de 531 bytes "atualizaria" uma CTe COMPLETA.
const modeloComItens = (ch) => { const m = String(ch || '').slice(20, 22); return m === '55' || m === '65'; };

// Decide, a partir do doc existente e do que esta chegando, se e duplicado,
// upgrade resumo->completa, e se a escrita deve ser merge (preserva eventos).
// Funcao PURA — reutilizada no fast-path (get pre-storage) E dentro da transacao
// de escrita, garantindo que a decisao final seja atomica mesmo com captura
// concorrente (DistDFe + autXML + SharePoint podem tocar a mesma chave juntos).
export function decidirGravacaoNFe({ existingData, tipoDoc, schema, chave }) {
  const incomingResumo = isResumoTipoDoc(tipoDoc) || isResumoSchema(schema);
  const exData = existingData || null;
  const exResumo = exData
    ? (isResumoSchema(exData.schema) || isResumoTipoDoc(exData.tipoDoc) ||
       (exData.temItens === false && modeloComItens(chave)))
    : false;
  const exists = !!exData;
  // Doc INCOMPLETO: existe na base mas sem os campos que o painel usa pra
  // achar a nota — sem competência, sem data de emissão ou sem valor. É uma
  // casca: aparece na contagem, some de qualquer filtro. Caso GUARANI 27/07 —
  // 30 das 36 notas do ZIP estavam assim e o importer as chamava de
  // "duplicadas", recusando-se a completá-las com o XML inteiro em mãos.
  const exIncompleto = exists && (!exData.competencia || !exData.dhEmi || exData.valorTotal == null);
  // Upgrade = a base tem menos do que está chegando. Nunca o contrário: o
  // `!incomingResumo` impede que um resumo rebaixe uma nota completa.
  const upgrade = exists && (exResumo || exIncompleto) && !incomingResumo;
  return {
    exists,
    upgrade,
    incompleto: exIncompleto,
    // Duplicidade só quando NÃO é stub-de-evento E NÃO é upgrade
    // (resumo→completa ou incompleto→completa).
    duplicado: exists && !exData.eventosBeforeNFe && !upgrade,
    // Merge preserva o array de eventos quando já existia stub OU no upgrade.
    merge: exists && (exData.eventosBeforeNFe || upgrade),
  };
}

function pickTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function pickAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}\\s+[^>]*${attr}="([^"]+)"`, 'i'));
  return m ? m[1] : null;
}

// Mapeamento de tpEvento (Manual NFe v2.0)
function classificarEvento(tpEvento) {
  const map = {
    '110110': { tipo: 'cce', descricao: 'Carta de Correção Eletrônica' },
    '110111': { tipo: 'cancelamento', descricao: 'Cancelamento de NF-e' },
    '210200': { tipo: 'manifestacao_confirmacao', descricao: 'Confirmação da Operação' },
    '210210': { tipo: 'manifestacao_ciencia', descricao: 'Ciência da Operação' },
    '210220': { tipo: 'manifestacao_desconhecimento', descricao: 'Desconhecimento da Operação' },
    '210240': { tipo: 'manifestacao_nao_realizada', descricao: 'Operação não Realizada' },
    '110140': { tipo: 'epec', descricao: 'EPEC (emergência)' },
  };
  return map[tpEvento] || { tipo: 'outro', descricao: `Evento ${tpEvento}` };
}

// ============================================================================
// 23/05 — Helpers de extracao detalhada (itens, totais, direcao, status)
// Espelham services/xmlParserService.ts (parser manual) em regex puro.
// ============================================================================

function pickAllBlocks(xml, openTag) {
  const re = new RegExp(`<${openTag}\\b[^>]*>([\\s\\S]*?)<\\/${openTag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push({ inner: m[1], attrs: m[0].slice(0, m[0].indexOf('>')) });
  }
  return out;
}

function pickFirstBlock(xml, openTag) {
  const all = pickAllBlocks(xml, openTag);
  return all.length ? all[0].inner : '';
}

function num(v) {
  if (v == null || v === '') return 0;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/**
 * Extrai todos os itens (<det>) de uma NFe completa.
 * Retorna [] se o XML for resumo (resNFe) ou nao tiver <det>.
 */
export function extrairItens(xml) {
  const dets = pickAllBlocks(xml, 'det');
  const itens = [];

  for (let i = 0; i < dets.length; i++) {
    const det = dets[i];
    const nItem = (det.attrs.match(/nItem="([^"]+)"/) || [])[1] || String(i + 1);
    const prod = pickFirstBlock(det.inner, 'prod');
    const icms = pickFirstBlock(det.inner, 'ICMS');
    const ipi = pickFirstBlock(det.inner, 'IPI');
    const pis = pickFirstBlock(det.inner, 'PIS');
    const cofins = pickFirstBlock(det.inner, 'COFINS');

    // Bloco interno do ICMS (ICMS00, ICMS10, ..., ICMSSN102, etc.)
    const icmsInnerMatch = icms.match(/<(ICMS\w+)\b[^>]*>([\s\S]*?)<\/\1>/);
    const icmsInner = icmsInnerMatch ? icmsInnerMatch[2] : '';
    const cst = pickTag(icmsInner, 'CST') || pickTag(icmsInner, 'CSOSN');
    const orig = pickTag(icmsInner, 'orig');

    // IPI tem IPITrib aninhado
    const ipiTribInner = pickFirstBlock(ipi, 'IPITrib');
    // CST do IPI para o E510 (consolidação por CFOP+CST_IPI). Pode vir em
    // IPITrib (tributado: 50/99) OU IPINT (não-tributado/isento/imune:
    // 01-05/51-55) — e o não-tributado TAMBÉM entra no E510, por isso lê os
    // dois. Ausente = null (item sem IPI), NUNCA "0" (regra: campo fiscal não
    // recebe default). cEnq é o código de enquadramento legal do IPI.
    const ipiNtInner = pickFirstBlock(ipi, 'IPINT');
    const cstIpi = pickTag(ipiTribInner, 'CST') || pickTag(ipiNtInner, 'CST') || null;
    const cEnqIpi = pickTag(ipi, 'cEnq') || null;
    // Base do IPI (VL_BC_IPI do E510). Só existe no IPITrib (tributado); item
    // não-tributado (IPINT) tem base 0 — e nesse caso 0 É a resposta, não
    // "não sei" (o E510 do arquivo real traz VL_BC=0 pra CST 05/49/55).
    const vBcIpi = num(pickTag(ipiTribInner, 'vBC'));

    // PIS: primeiro filho (PISAliq, PISNT, PISOutr, etc.)
    const pisInnerMatch = pis.match(/<(PIS\w+)\b[^>]*>([\s\S]*?)<\/\1>/);
    const pisInner = pisInnerMatch ? pisInnerMatch[2] : '';

    const cofinsInnerMatch = cofins.match(/<(COFINS\w+)\b[^>]*>([\s\S]*?)<\/\1>/);
    const cofinsInner = cofinsInnerMatch ? cofinsInnerMatch[2] : '';

    // CST de PIS e de COFINS — o campo que decide se a ENTRADA gera crédito no
    // regime não-cumulativo (Lei 10.637/02 art. 3º e Lei 10.833/03 art. 3º):
    // 50-56 dão direito, 70-75 não dão, 98/99 são "outras operações".
    // Estava no XML e o importer só lia valor e alíquota — a MESMA armadilha do
    // CST do IPI (#563), que fez o de-para jurar por meses que "o CST não é
    // capturado". Sem ele, a base de crédito do PIS/COFINS só pode ser digitada
    // à mão, e é por isso que a apuração vive em Excel.
    // Ausente = null (item sem o bloco), NUNCA '0': campo fiscal não recebe
    // default, e "sem CST" é diferente de "CST zero".
    const cstPis = pickTag(pisInner, 'CST') || null;
    const cstCofins = pickTag(cofinsInner, 'CST') || null;

    itens.push({
      nItem,
      cProd: pickTag(prod, 'cProd'),
      xProd: pickTag(prod, 'xProd'),
      ncm: pickTag(prod, 'NCM'),
      cest: pickTag(prod, 'CEST') || null,
      cfop: pickTag(prod, 'CFOP'),
      uCom: pickTag(prod, 'uCom'),
      qCom: num(pickTag(prod, 'qCom')),
      vUnCom: num(pickTag(prod, 'vUnCom')),
      vProd: num(pickTag(prod, 'vProd')),
      vDesc: num(pickTag(prod, 'vDesc')) || null,
      // Encargos POR ITEM (a NF-e traz em <prod>). Sem eles, o VA do art.
      // 426-A precisa ratear o total — estimativa, não o que está na nota.
      vFrete: num(pickTag(prod, 'vFrete')),
      vSeg: num(pickTag(prod, 'vSeg')),
      vOutro: num(pickTag(prod, 'vOutro')),
      vBC: num(pickTag(icmsInner, 'vBC')),
      aliqIcms: num(pickTag(icmsInner, 'pICMS')),
      vICMS: num(pickTag(icmsInner, 'vICMS')),
      vBCST: num(pickTag(icmsInner, 'vBCST')),
      aliqST: num(pickTag(icmsInner, 'pICMSST')),
      vICMSST: num(pickTag(icmsInner, 'vICMSST')),
      modBC: pickTag(icmsInner, 'modBC'),
      pRedBC: num(pickTag(icmsInner, 'pRedBC')),
      vIPI: num(pickTag(ipiTribInner, 'vIPI')),
      aliqIPI: num(pickTag(ipiTribInner, 'pIPI')),
      cstIpi,
      cEnqIpi,
      vBcIpi,
      vPIS: num(pickTag(pisInner, 'vPIS')),
      aliqPIS: num(pickTag(pisInner, 'pPIS')),
      cstPis,
      vBcPis: num(pickTag(pisInner, 'vBC')),
      vCOFINS: num(pickTag(cofinsInner, 'vCOFINS')),
      aliqCOFINS: num(pickTag(cofinsInner, 'pCOFINS')),
      cstCofins,
      vBcCofins: num(pickTag(cofinsInner, 'vBC')),
      cst,
      orig,
    });
  }
  return itens;
}

/**
 * Extrai totais do bloco <total>/<ICMSTot>. Retorna null se nao tiver.
 */
function extrairTotais(xml) {
  const icmsTot = pickFirstBlock(xml, 'ICMSTot');
  if (!icmsTot) return null;
  return {
    vBC: num(pickTag(icmsTot, 'vBC')),
    vICMS: num(pickTag(icmsTot, 'vICMS')),
    vICMSDeson: num(pickTag(icmsTot, 'vICMSDeson')),
    vFCP: num(pickTag(icmsTot, 'vFCP')),
    vBCST: num(pickTag(icmsTot, 'vBCST')),
    vST: num(pickTag(icmsTot, 'vST')),
    vFCPST: num(pickTag(icmsTot, 'vFCPST')),
    vProd: num(pickTag(icmsTot, 'vProd')),
    vFrete: num(pickTag(icmsTot, 'vFrete')),
    vSeg: num(pickTag(icmsTot, 'vSeg')),
    vDesc: num(pickTag(icmsTot, 'vDesc')),
    vII: num(pickTag(icmsTot, 'vII')),
    vIPI: num(pickTag(icmsTot, 'vIPI')),
    vIPIDevol: num(pickTag(icmsTot, 'vIPIDevol')),
    vPIS: num(pickTag(icmsTot, 'vPIS')),
    vCOFINS: num(pickTag(icmsTot, 'vCOFINS')),
    vOutro: num(pickTag(icmsTot, 'vOutro')),
    vNF: num(pickTag(icmsTot, 'vNF')),
  };
}

/**
 * Mapeia cStat do infProt para status do XmlStatusDocumento do frontend.
 */
function statusFromCStat(xml) {
  const infProt = pickFirstBlock(xml, 'infProt');
  const cStat = pickTag(infProt, 'cStat');
  if (cStat === '100') return 'autorizado';
  if (cStat === '101') return 'cancelado';
  if (cStat === '110') return 'denegado';
  if (cStat === '102') return 'inutilizado';
  if (!cStat) return 'desconhecido';
  return 'rejeitado';
}

/**
 * Decide direcao=entrada|saida comparando emit/dest com empresa-cliente.
 *
 * tpNF é decisivo quando a EMPRESA é a emitente: nota própria de ENTRADA
 * (tpNF=0, RICMS/SP art. 136 — o caso clássico é compra de produtor rural PF,
 * que não emite NF-e) tem emit=empresa mas é ENTRADA de mercadoria. Sem olhar
 * o tpNF, essas notas viravam "saída", o Exportar SAGE recusava o CFOP 1xxx/2xxx
 * ("CFOP inválido para nota de saída") e a DIPAM não as via (31/07, caso
 * EDUARDO GUERRA).
 */
function decidirDirecao(cnpjEmit, cnpjDest, empresaCnpj, tpNF) {
  const norm = c => String(c || '').replace(/\D/g, '');
  const emi = norm(cnpjEmit);
  const dest = norm(cnpjDest);
  const emp = norm(empresaCnpj);
  if (!emp) return 'desconhecida';
  if (emi === emp) return String(tpNF ?? '') === '0' ? 'entrada' : 'saida';
  if (dest === emp) return 'entrada';
  return 'desconhecida';
}

export function extrairMetadados(xml, schema) {
  // Chave: cada modelo de DFe tem seu container raiz.
  //   NFe/NFCe -> <infNFe Id="NFe...">  ou <chNFe>
  //   CTe      -> <infCte Id="CTe...">  ou <chCTe>
  //   MDFe     -> <infMDFe Id="MDFe..."> ou <chMDFe>
  //   Eventos  -> <infEvento Id="ID...">
  // Antes so extraia infNFe/infEvento/chNFe — CTe e MDFe vinham com chave=null
  // e eram REJEITADOS no import ('Chave da NFe nao encontrada'), apesar de
  // serem baixados normalmente pelo DistDFe. Por isso CT-e nunca aparecia.
  let chave = pickAttr(xml, 'infNFe', 'Id') ||
              pickAttr(xml, 'infCte', 'Id') ||
              pickAttr(xml, 'infMDFe', 'Id') ||
              pickAttr(xml, 'infEvento', 'Id') ||
              pickTag(xml, 'chNFe') ||
              pickTag(xml, 'chCTe') ||
              pickTag(xml, 'chMDFe') ||
              null;
  // Remove prefixos de letra (NFe/CTe/MDFe/ID) e qualquer nao-digito.
  // O \D final ja tira as letras, mas o replace explicito documenta a intencao.
  if (chave) chave = chave.replace(/^(NFe|CTe|MDFe|ID)/i, '').replace(/\D/g, '');

  const participantes = extrairParticipantesNfe(xml);
  const cnpjEmit = participantes.emitente.cnpj || pickTag(xml, 'CNPJEmit') || pickTag(xml, 'CNPJ') || null;
  const cnpjDest = participantes.destinatario.cnpj || pickTag(xml, 'CNPJDest') || null;

  const xNome = participantes.emitente.nome || pickTag(xml, 'xNome') || null;
  const dhEmi = pickTag(xml, 'dhEmi') || pickTag(xml, 'dEmi') || pickTag(xml, 'dhEvento') || null;
  // Valor: NFe usa <vNF>; CTe usa <vTPrest> (valor total da prestacao);
  // MDFe nao tem valor financeiro (so carga). Sem o fallback, CT-e capturado
  // aparecia com valor R$ 0,00.
  const vNF = pickTag(xml, 'vNF') || pickTag(xml, 'vTPrest') || pickTag(xml, 'vRec') || null;
  const tpNF = pickTag(xml, 'tpNF') || null;

  // Classificacao em modulo PURO (testavel direto em jest). Cobre NFe, NFCe,
  // CTe, MDFe (proc/res), seus eventos, e fallback por modelo da chave quando
  // o schema vier malformado/ausente. Substituiu a if-chain inline antiga, que
  // ignorava NFCe (modelo 65) — clientes varejistas nao tinham captura.
  const { tipoDoc, tipoNormalizado } = classificarTipoDoc(schema, chave);

  // Para eventos, extrai metadados específicos
  let evento = null;
  if (tipoDoc === 'eventoNFe' || tipoDoc === 'eventoNFCe' || tipoDoc === 'eventoCTe' || tipoDoc === 'eventoMDFe' || tipoDoc === 'resEvento') {
    const tpEvento = pickTag(xml, 'tpEvento');
    const nSeqEvento = pickTag(xml, 'nSeqEvento');
    const dhEventoTag = pickTag(xml, 'dhEvento');
    const xCorrecao = pickTag(xml, 'xCorrecao');
    const xJust = pickTag(xml, 'xJust');
    const nProt = pickTag(xml, 'nProt');
    const cStat = pickTag(xml, 'cStat');
    const xMotivo = pickTag(xml, 'xMotivo');
    // chNFe pode estar em <chNFe> ou no Id do infEvento (formato ID + tpEvento + chave + nSeq)
    let chNFeRef = pickTag(xml, 'chNFe');
    if (!chNFeRef) {
      const idEvento = pickAttr(xml, 'infEvento', 'Id');
      // Formato: ID110111<44 dígitos><2 dígitos seq>
      if (idEvento && idEvento.length >= 50) {
        const limpo = idEvento.replace(/^ID/i, '');
        if (limpo.length >= 50) chNFeRef = limpo.substring(6, 50);
      }
    }
    // Última rede: a própria `chave` já é o Id do evento (tpEvento + chNFe +
    // seq) quando nada mais foi lido. Sem isto o evento CAI no caminho da NF-e
    // e vira um documento_fiscal fantasma, com 53 dígitos no campo chave e sem
    // participante nenhum — foi assim que 435 eventos apareceram como "notas
    // sem o fornecedor" na aba 🌾 (13/08).
    if (!chNFeRef && chave && chave.length > 44) chNFeRef = chave.substring(6, 50);
    const classif = tpEvento ? classificarEvento(tpEvento) : { tipo: 'desconhecido', descricao: 'Evento sem tpEvento' };
    // chNFeRef é SEMPRE 44 dígitos. Se pickTag retornou lixo grande
    // (XML com múltiplos eventos, envelope mal formado, etc), extrai apenas
    // a primeira sequência de 44 dígitos.
    let chNFeLimpa = null;
    if (chNFeRef) {
      const onlyDigits = chNFeRef.replace(/\D/g, '');
      const match = onlyDigits.match(/(\d{44})/);
      chNFeLimpa = match ? match[1] : null;
    }
    evento = {
      tpEvento, nSeqEvento, dhEvento: dhEventoTag,
      xCorrecao, xJust, nProt, cStat, xMotivo,
      chNFeRef: chNFeLimpa,
      tipo: classif.tipo, descricao: classif.descricao,
    };
  }

  // 23/05 — extracao expandida pra Frente 1 (NCM/CFOP/CST)
  const ide = pickFirstBlock(xml, 'ide');
  const numero = pickTag(ide, 'nNF') || null;
  const serie = pickTag(ide, 'serie') || null;
  const natOp = pickTag(ide, 'natOp') || null;
  const infProt = pickFirstBlock(xml, 'infProt');
  const cStat = pickTag(infProt, 'cStat') || null;

  return {
    chave, cnpjEmit, cnpjDest, xNome, dhEmi,
    vNF: vNF ? Number(vNF) : null,
    tpNF, tipoDoc, tipoNormalizado, schema, evento,
    numero, serie, natOp, cStat,
    // Endereço dos DOIS participantes. Vem daqui (e não de uma variável solta
    // no importer) porque `participantes` só existe NESTE escopo — usá-la lá
    // fora quebrou a captura inteira com "participantes is not defined"
    // (04/08, 25 falhas seguidas no cofre de e-mail).
    xNomeDest: participantes.destinatario.nome || null,
    ufDest: participantes.destinatario.uf || null,
    codMunDest: participantes.destinatario.codMunIBGE || null,
    ieDest: participantes.destinatario.ie || null,
    ufEmit: participantes.emitente.uf || null,
    codMunEmit: participantes.emitente.codMunIBGE || null,
    // PROVA de que o cliente autorizou o escritório no emissor dele.
    autXml: extrairAutXml(xml),
  };
}

function buildStoragePath(empresaId, chave, fallbackName) {
  const safeChave = (chave || '').replace(/\D+/g, '') || `manual-${Date.now()}`;
  const safeEmpresa = empresaId || 'sem-empresa';
  const fileBase = safeChave.length === 44
    ? safeChave
    : `${safeChave}-${(fallbackName || 'doc').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  return `xmls/${safeEmpresa}/${fileBase}.xml`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function anexarEventoNaNFe({ db, chaveNFe, empresaId, evento, storagePath, xmlHash, schema, nsu, capturadoPor, tipoDocNormalizado }) {
  // Persiste evento como subdoc/array dentro da NFe original.
  // Se a NFe original não existir ainda, cria um "stub" com status pendente.
  const docRef = db.collection('documentos_fiscais').doc(chaveNFe);
  const eventoData = {
    tpEvento: evento.tpEvento,
    tipo: evento.tipo,
    descricao: evento.descricao,
    nSeqEvento: evento.nSeqEvento,
    dhEvento: evento.dhEvento,
    nProt: evento.nProt,
    cStat: evento.cStat,
    xMotivo: evento.xMotivo,
    xCorrecao: evento.xCorrecao,
    xJust: evento.xJust,
    storagePath,
    xmlHash,
    schema,
    nsu,
    importadoEm: new Date().toISOString(),
    importadoPor: capturadoPor?.email || 'system',
  };
  // 23/05 FIX: serverTimestamp() nao funciona dentro de array do Firestore.
  // eventoData eh empurrado pro array 'eventos' abaixo, entao usamos ISO string.
  // Bug original causou 3630 NSUs perdidos em xml_erros.

  // Transação: a leitura-modificação-escrita do array 'eventos' precisa ser
  // atômica. Dois eventos concorrentes pro mesmo doc (ou evento + NFe completa)
  // liam o mesmo 'eventos=[E1]', ambos faziam append e um sobrescrevia o outro
  // — evento perdido (a classe do bug "3630 NSUs perdidos"). runTransaction
  // serializa por docId e re-tenta em conflito.
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (snap.exists) {
      // Anexa ao array de eventos (sem duplicar). Preferimos o nProt (chave
      // natural do protocolo); quando ausente, usamos tpEvento+nSeqEvento+
      // dhEvento como chave composta — senão o reprocessamento (ex.: reset NSU)
      // duplicaria eventos sem protocolo no array.
      const data = snap.data();
      const eventosExistentes = data.eventos || [];
      const jaExiste = eventoData.nProt
        ? eventosExistentes.some(e => e.nProt === eventoData.nProt)
        : eventosExistentes.some(e =>
            !e.nProt &&
            e.tpEvento === eventoData.tpEvento &&
            String(e.nSeqEvento ?? '') === String(eventoData.nSeqEvento ?? '') &&
            e.dhEvento === eventoData.dhEvento);
      if (jaExiste) {
        return { status: 'duplicado_evento', chave: chaveNFe, tipo: evento.tipo };
      }
      const updates = {
        eventos: [...eventosExistentes, eventoData],
      };
      // Se cancelamento REGISTRADO, atualiza status da NFe. 135 = registrado e
      // vinculado; 155 = homologado FORA DE PRAZO — cancelamento igual (o gate
      // só em '135' deixou cancelada de fora de prazo contando no Livro e no
      // fechamento; bug 11/08, MV LIDER 639).
      if (evento.tipo === 'cancelamento' && CSTAT_EVENTO_CANCELAMENTO.has(String(evento.cStat || ''))) {
        updates.status = 'cancelado';
        updates.canceladoEm = evento.dhEvento;
        updates.canceladoProtocolo = evento.nProt;
      }
      // 23/05 — defesa contra Update() requires...:
      // garante que todos os valores do updates sao definidos antes de chamar.
      for (const [k, v] of Object.entries(updates)) {
        if (v === undefined) {
          console.warn(`[xml-importer] anexarEventoNaNFe: campo ${k} undefined em updates, removendo`);
          delete updates[k];
        }
      }
      if (Object.keys(updates).length === 0) {
        console.warn('[xml-importer] anexarEventoNaNFe: updates vazio, pulando update');
        return { status: 'evento_skip_vazio', chave: chaveNFe };
      }
      tx.update(docRef, updates);
      return { status: 'evento_anexado', chave: chaveNFe, tipo: evento.tipo };
    }
    // Stub: cria um doc parcial pra quando o documento-pai chegar, ela faz merge.
    // 23/05 — adicionado defaults pra campos undefined (numero, serie, etc)
    // 02/06 — tipoDoc/tipo derivam do evento real (NFe/CTe/MDFe), nao hardcoded.
    const tipoFinal = tipoDocNormalizado || 'NFe';
    tx.set(docRef, {
      id: chaveNFe,
      chave: chaveNFe,
      empresaId,
      empresaCnpj: capturadoPor?.empresaCnpj?.replace(/\D/g, '') || null,
      tipoDoc: tipoFinal,
      tipo: tipoFinal,
      status: evento.tipo === 'cancelamento' && CSTAT_EVENTO_CANCELAMENTO.has(String(evento.cStat || '')) ? 'cancelado' : 'pendente',
      direcao: 'desconhecida', // sera atualizado quando NFe original chegar
      numero: null,
      serie: null,
      natOp: null,
      itens: [],
      totais: null,
      temItens: false,
      cStat: evento.cStat || null,
      schema: schema || null,
      eventos: [eventoData],
      origem: 'sefaz',
      eventosBeforeNFe: true,
      createdAt: fa().firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { status: 'evento_stub_criado', chave: chaveNFe, tipo: evento.tipo };
  });
}

// ── Lookup de empresa cadastrada por CNPJ (com cache) ───────────────────────
// Usado pela atribuição por participantes: quando a empresa sob a qual o doc
// chegou (ex.: escritório via autXML) não é emit nem dest, o dono real é a
// empresa CADASTRADA que aparece como emitente (saída) ou destinatário
// (entrada). Cache de 10 min evita 2 queries por documento numa paginação.
const cacheEmpresaPorCnpj = new Map(); // cnpj → { val: {empresaId,cnpj}|null, ts }
const CACHE_EMPRESA_TTL_MS = 10 * 60_000;

async function lookupEmpresaCadastrada(db, cnpj) {
  const c = String(cnpj || '').replace(/\D/g, '');
  if (c.length !== 14) return null;
  const hit = cacheEmpresaPorCnpj.get(c);
  if (hit && (Date.now() - hit.ts) < CACHE_EMPRESA_TTL_MS) return hit.val;
  let val = null;
  for (const col of ['simples_empresas', 'lucro_empresas']) {
    try {
      const snap = await db.collection(col).where('cnpj', '==', c).limit(1).get();
      if (!snap.empty) {
        const d = snap.docs[0].data() || {};
        // Lápides não recebem documentos (regra do soft-delete #290).
        if (!d._deleted && !d._merged_into) {
          val = { empresaId: snap.docs[0].id, cnpj: c };
          break;
        }
      }
    } catch (e) { /* coleção indisponível — tenta a próxima */ }
  }
  cacheEmpresaPorCnpj.set(c, { val, ts: Date.now() });
  return val;
}

// Resolve o dono real pelos participantes (emit → saída; dest → entrada).
// null = mantém a atribuição atual.
async function resolverDonoPorParticipantes(db, cnpjEmit, cnpjDest, empresaAtualCnpj, tpNF) {
  const empresasPorCnpj = new Map();
  const emp1 = await lookupEmpresaCadastrada(db, cnpjEmit);
  if (emp1) empresasPorCnpj.set(emp1.cnpj, emp1);
  // Só consulta o dest se o emit não resolveu (economiza leitura).
  let decisao = decidirDonoPorParticipantes({ cnpjEmit, cnpjDest, empresaAtualCnpj, empresasPorCnpj, tpNF });
  if (!decisao) {
    const emp2 = await lookupEmpresaCadastrada(db, cnpjDest);
    if (emp2) empresasPorCnpj.set(emp2.cnpj, emp2);
    decisao = decidirDonoPorParticipantes({ cnpjEmit, cnpjDest, empresaAtualCnpj, empresasPorCnpj, tpNF });
  }
  return decisao;
}

export async function importarXmlSefaz({ empresaId, empresaCnpj, xml, schema, nsu, capturadoPor, origem = 'sefaz' }) {
  if (!xml) return { status: 'erro', motivo: 'XML vazio' };

  const meta = extrairMetadados(xml, schema);
  if (!meta.chave) return { status: 'erro', motivo: `Chave do documento fiscal nao encontrada no XML (schema: ${schema || 'desconhecido'})` };

  const db = fa().firestore();
  const xmlHash = sha256(xml);

  // ── EVENTOS: caminho separado (anexa ao documento original) ─────────
  // Inclui eventos de NFe, NFCe, CTe e MDFe (cancelamento, CCe, etc).
  // chNFeRef e a chave do doc referenciado (44 digitos).
  if ((meta.tipoDoc === 'eventoNFe' || meta.tipoDoc === 'eventoNFCe' ||
       meta.tipoDoc === 'eventoCTe' || meta.tipoDoc === 'eventoMDFe' ||
       meta.tipoDoc === 'resEvento') && meta.evento?.chNFeRef) {
    // Sanitiza componentes do path pra não estourar limite de 1024 chars
    // do Firebase Storage. Chave NFe = 44 dígitos exatos; nProt/tpEvento ~15 chars.
    const chRefSafe = String(meta.evento.chNFeRef || '').replace(/\D/g, '').slice(0, 44);
    const idEventoSafe = String(meta.evento.nProt || meta.evento.tpEvento || Date.now())
      .replace(/[^a-zA-Z0-9]/g, '').slice(0, 30);
    const storagePathEvento = `xmls/${empresaId || 'sem-empresa'}/eventos/${chRefSafe || 'sem-chave'}-${idEventoSafe || 'sem-id'}.xml`;
    const bucket = storage.bucket(STORAGE_BUCKET);
    await bucket.file(storagePathEvento).save(xml, {
      contentType: 'application/xml',
      metadata: {
        cacheControl: 'private, max-age=3600',
        metadata: {
          chaveNFe: meta.evento.chNFeRef,
          tpEvento: meta.evento.tpEvento || '',
          empresaId,
          schema: schema || 'unknown',
          nsu: nsu || '',
          capturadoPor: capturadoPor?.email || 'system',
        },
      },
      resumable: false,
    });

    const result = await anexarEventoNaNFe({
      db,
      chaveNFe: meta.evento.chNFeRef,
      empresaId,
      evento: meta.evento,
      storagePath: storagePathEvento,
      xmlHash,
      schema,
      nsu,
      capturadoPor: { ...capturadoPor, empresaCnpj },
      tipoDocNormalizado: meta.tipoNormalizado,
    });

    // Auditoria
    try {
      await db.collection('xml_capturas').add({
        chave: meta.evento.chNFeRef,
        empresaId,
        empresaCnpj: empresaCnpj?.replace(/\D/g, '') || null,
        origem: 'sefaz',
        schema: meta.schema,
        nsu,
        tipoDoc: meta.tipoDoc,
        eventoTipo: meta.evento.tipo,
        eventoTpEvento: meta.evento.tpEvento,
        capturadoPor: capturadoPor || null,
        createdAt: fa().firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.warn('[xml-importer] falha auditoria evento:', e.message);
    }
    return result;
  }

  // ── TRAVA: documento fiscal tem chave de 44 dígitos ─────────────────
  //
  // Chegando aqui com mais que isso, o XML é um EVENTO cujo chNFe não foi lido
  // (envelope torto, captura por e-mail sem schema). Gravar assim cria um
  // documento fantasma: 53 dígitos no campo chave, sem emitente, sem
  // destinatário e sem valor — que depois aparece como "nota sem o fornecedor"
  // em toda varredura, mandando reler um XML que não tem participante nenhum.
  // Recusar deixa o caso VISÍVEL em Erros & Logs, que é onde ele se resolve.
  if (meta.chave.length > 44) {
    return {
      status: 'erro',
      motivo: `Chave com ${meta.chave.length} dígitos — isto é Id de EVENTO (tpEvento + chave + sequência), `
        + 'não um documento fiscal. O evento não pôde ser anexado porque a chave da nota referenciada não '
        + `foi lida do XML (schema: ${schema || 'desconhecido'}).`,
    };
  }

  // ── NFE / RESNFE: caminho original ──────────────────────────────────
  const docId = meta.chave;
  const storagePath = buildStoragePath(empresaId, meta.chave, meta.tipoDoc);
  const docRef = db.collection('documentos_fiscais').doc(docId);

  // Fast-path: lê o doc atual e, se for duplicado óbvio, sai SEM gravar storage
  // (economia). A decisão AUTORITATIVA é refeita dentro da transação de escrita
  // (decidirGravacaoNFe), pra que a corrida read-check-write seja atômica —
  // DistDFe + autXML + SharePoint podem importar a mesma chave concorrentemente.
  let existing = null;
  try {
    existing = await docRef.get();
  } catch (e) {
    console.warn('[xml-importer] erro lendo doc existente:', e.message);
  }
  const existingData = existing?.exists ? existing.data() : null;

  if (decidirGravacaoNFe({ existingData, tipoDoc: meta.tipoDoc, schema, chave: meta.chave }).duplicado) {
    // Duplicado SEM DONO (ou de outra empresa) ainda precisa ser reatribuído —
    // o fast-path saía antes da transação e engolia a reatribuição inteira
    // (caso GUARANI 27/07: "36 duplicadas · 0 reatribuídas" com as notas
    // invisíveis no filtro por empresa). Corrige aqui mesmo, sem regravar o
    // XML no Storage: o corpo da nota já está lá, só a posse estava errada.
    const donoNovo = empresaId || null;
    if (donoNovo && existingData && existingData.empresaId !== donoNovo) {
      const cnpjLimpo = empresaCnpj?.replace(/\D/g, '') || null;
      const direcaoNova = decidirDirecao(existingData.cnpjEmit || meta.cnpjEmit, existingData.cnpjDest || meta.cnpjDest, cnpjLimpo, existingData.tpNF ?? meta.tpNF);
      try {
        await docRef.update({
          empresaId: donoNovo,
          empresaCnpj: cnpjLimpo,
          direcao: direcaoNova !== 'desconhecida' ? direcaoNova : (existingData.direcao ?? null),
          reatribuidoEm: fa().firestore.FieldValue.serverTimestamp(),
          reatribuidoDe: existingData.empresaId || null,
        });
        return { status: 'reatribuido', chave: meta.chave, deEmpresaId: existingData.empresaId || null };
      } catch (e) {
        console.warn(`[xml-importer] falha reatribuindo ${meta.chave}: ${e.message}`);
      }
    }
    return { status: 'duplicado', chave: meta.chave };
  }

  const bucket = storage.bucket(STORAGE_BUCKET);
  const file = bucket.file(storagePath);
  await file.save(xml, {
    contentType: 'application/xml',
    metadata: {
      cacheControl: 'private, max-age=3600',
      metadata: {
        chave: meta.chave,
        empresaId,
        schema: schema || 'unknown',
        nsu: nsu || '',
        capturadoPor: capturadoPor?.email || 'system',
      },
    },
    resumable: false,
  });

  // 23/05 — extrai itens/totais/direcao/status para docData completo
  const itens = extrairItens(xml);
  const totais = extrairTotais(xml);
  let direcao = decidirDirecao(meta.cnpjEmit, meta.cnpjDest, empresaCnpj, meta.tpNF);
  const status = statusFromCStat(xml);
  const temItens = itens.length > 0;

  // 23/05 — resumo (resNFe/resNFCe) nao tem <dest> separado, so <CNPJ> do emit.
  // Resumo sempre chega pra DESTINATARIO (manifestacao ou recebimento). Logo:
  // se eh resumo e a empresa-cliente nao eh emit, entao eh entrada.
  const norm = c => String(c || '').replace(/\D/g, '');
  if (direcao === 'desconhecida' && isResumoTipoDoc(meta.tipoDoc) && meta.cnpjEmit) {
    if (norm(meta.cnpjEmit) !== norm(empresaCnpj)) {
      direcao = 'entrada';
    }
  }

  // autXML (caso Nova Era, 30/07): a empresa sob a qual o doc chegou (ex.:
  // ESCRITÓRIO via DistDFe) não é emit nem dest — o doc é de OUTRA empresa
  // cadastrada. Sem isto, a nota ficava empresaId=escritório com direção
  // 'desconhecida': invisível como saída do cliente na Cobertura de Saída,
  // fora do trilho autXML do painel e fora do filtro por empresa.
  //
  // Também roda quando NÃO há dono explícito (empresaId vazio) — caso
  // "Consultar + Importar": a rota mandava empresaCnpj = DESTINATÁRIO da
  // nota, e uma VENDA do cliente a terceiro era gravada como "entrada do
  // terceiro" (que nem é cliente) em vez de SAÍDA da empresa emitente. Sem
  // dono explícito, o cadastro decide (emitente → saída; dest → entrada).
  if ((direcao === 'desconhecida' || !empresaId) && (meta.cnpjEmit || meta.cnpjDest)) {
    try {
      const dono = await resolverDonoPorParticipantes(
        db, meta.cnpjEmit, meta.cnpjDest,
        // Com dono explícito, respeita quando ele é participante; sem dono,
        // ninguém tem prioridade — o cadastro decide.
        empresaId ? empresaCnpj : null,
        meta.tpNF,
      );
      if (dono) {
        empresaId = dono.empresaId;
        empresaCnpj = dono.empresaCnpj;
        direcao = dono.direcao;
      }
    } catch (e) {
      console.warn(`[xml-importer] atribuição por participantes falhou (${meta.chave}):`, e.message);
    }
  }

  // Para o frontend e manifestacao, agrupa resumo+completa sob a mesma "familia":
  //  - resNFe/procNFe   -> tipoDoc='NFe'   (manifesto-orchestrator filtra por isso)
  //  - resNFCe/procNFCe -> tipoDoc='NFCe'  (UI filtra por isso na coluna Tipo)
  // A distincao resumo x completa fica em temItens/schema.
  let tipoDocFinal = meta.tipoDoc;
  if (meta.tipoDoc === 'resNFe' || meta.tipoDoc === 'NFe')   tipoDocFinal = 'NFe';
  if (meta.tipoDoc === 'resNFCe' || meta.tipoDoc === 'NFCe') tipoDocFinal = 'NFCe';

  const docData = {
    id: docId,
    chave: meta.chave,
    empresaId,
    empresaCnpj: empresaCnpj?.replace(/\D/g, '') || null,
    cnpjEmit: meta.cnpjEmit?.replace(/\D/g, '') || null,
    cnpjDest: meta.cnpjDest?.replace(/\D/g, '') || null,
    xNomeEmit: meta.xNome,
    // Participante do lado do DESTINATÁRIO — sem isso o Exportar SAGE monta o
    // E010 das SAÍDAS com nome "CLIENTE" e UF em branco, e o E-Fiscal recusa
    // o cadastro (derrubando as notas atrás dele). Ver participanteDoDoc.
    xNomeDest: meta.xNomeDest,
    ufDest: meta.ufDest,
    codMunDest: meta.codMunDest,
    ieDest: meta.ieDest,
    ufEmit: meta.ufEmit,
    codMunEmit: meta.codMunEmit,
    // Lista de autorizados + o atalho que a Cobertura de Saída consulta.
    autXml: meta.autXml || [],
    autXmlEscritorio: (meta.autXml || []).includes(CNPJ_ESCRITORIO_DIGITOS),
    dhEmi: meta.dhEmi,
    competencia: competenciaFromDhEmi(meta.dhEmi),
    valorTotal: meta.vNF,
    tpNF: meta.tpNF,
    tipoDoc: tipoDocFinal,
    tipo: meta.tipoNormalizado,
    schema: meta.schema,
    nsu,
    storagePath,
    xmlHash,
    origem,
    // 23/05 campos novos:
    numero: meta.numero,
    serie: meta.serie,
    natOp: meta.natOp,
    status,
    direcao,
    itens,
    totais,
    temItens,
    cStat: meta.cStat,
    createdAt: fa().firestore.FieldValue.serverTimestamp(),
    createdBy: capturadoPor?.uid || null,
    capturadoPor: capturadoPor || null,
    eventosBeforeNFe: false,
  };
  // Escrita AUTORITATIVA em transação: re-lê o doc DENTRO da txn e decide
  // duplicado/upgrade/merge de forma atômica. Sem isso, um .set() não-merge
  // podia sobrescrever um stub de evento (eventos[]) que outro processo criou
  // entre o nosso get inicial e este write — evento perdido. Merge preserva o
  // array de eventos quando já existia stub OU no upgrade resumo→completa.
  const writeResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const dec = decidirGravacaoNFe({
      existingData: snap.exists ? snap.data() : null,
      tipoDoc: meta.tipoDoc,
      schema,
      chave: meta.chave,
    });
    if (dec.duplicado) {
      // Doc já existe, mas SEM dono (empresaId null — importações em lote
      // antigas gravavam assim e a nota sumia do filtro por empresa) ou com
      // dono diferente do CNPJ desta importação. Reatribui só os campos de
      // posse/direção — o corpo da nota fica intacto (nunca rebaixa completa
      // para resumo).
      const atual = snap.data() || {};
      const donoNovo = empresaId || null;
      const precisaDono = donoNovo && atual.empresaId !== donoNovo;
      if (precisaDono) {
        tx.update(docRef, {
          empresaId: donoNovo,
          empresaCnpj: docData.empresaCnpj ?? null,
          direcao: docData.direcao ?? atual.direcao ?? null,
          reatribuidoEm: fa().firestore.FieldValue.serverTimestamp(),
          reatribuidoDe: atual.empresaId || null,
        });
        return { status: 'reatribuido', chave: meta.chave, deEmpresaId: atual.empresaId || null };
      }
      return { status: 'duplicado', chave: meta.chave };
    }
    if (dec.merge) {
      // Nota que chega DEPOIS do cancelamento NÃO ressuscita: o merge preservava
      // os eventos[], mas o status 'autorizado' do protocolo da própria nota
      // atropelava o 'cancelado' do stub (o evento tinha chegado antes). A
      // cancelada voltava a contar no Livro e no fechamento (bug 11/08).
      const ex = snap.exists ? (snap.data() || {}) : {};
      if (docCancelado(ex)) {
        docData.status = 'cancelado';
        if (ex.canceladoEm !== undefined) docData.canceladoEm = ex.canceladoEm;
        if (ex.canceladoProtocolo !== undefined) docData.canceladoProtocolo = ex.canceladoProtocolo;
      }
      tx.set(docRef, docData, { merge: true });
    } else {
      tx.set(docRef, docData);
    }
    return {
      status: dec.upgrade ? 'atualizado' : 'ok',
      chave: meta.chave,
      tipoDoc: meta.tipoDoc,
      upgrade: dec.upgrade || undefined,
    };
  });

  // Auditoria só quando efetivamente gravou (não para duplicado detectado na txn
  // por corrida — o storage já foi salvo, mas não repetimos a linha de captura).
  if (writeResult.status !== 'duplicado') {
    try {
      await db.collection('xml_capturas').add({
        chave: meta.chave,
        empresaId,
        empresaCnpj: empresaCnpj?.replace(/\D/g, '') || null,
        origem: 'sefaz',
        schema: meta.schema,
        nsu,
        tipoDoc: meta.tipoDoc,
        capturadoPor: capturadoPor || null,
        createdAt: fa().firestore.FieldValue.serverTimestamp(),
        createdBy: capturadoPor?.uid || null,
      });
    } catch (e) {
      console.warn('[xml-importer] falha auditoria xml_capturas:', e.message);
    }
  }

  return writeResult;
}

/**
 * Backfill: reatribui documentos já gravados com direcao='desconhecida' cujo
 * emitente (→ saída) ou destinatário (→ entrada) é empresa cadastrada.
 * Cobre o histórico anterior à atribuição por participantes no import — ex.:
 * notas autXML que desceram pelo DistDFe do escritório e ficaram invisíveis.
 * Roda no fim do sync-cron (idempotente; docs corrigidos saem da query).
 */
export async function reatribuirDesconhecidas({ limit = 500 } = {}) {
  const db = fa().firestore();
  let examinadas = 0, reatribuidas = 0, semDono = 0;
  try {
    const snap = await db.collection('documentos_fiscais')
      .where('direcao', '==', 'desconhecida')
      .limit(limit)
      .get();
    for (const docSnap of snap.docs) {
      examinadas++;
      const d = docSnap.data() || {};
      // Stubs de evento (sem participantes) não têm como resolver — pula.
      if (!d.cnpjEmit && !d.cnpjDest) { semDono++; continue; }
      try {
        const dono = await resolverDonoPorParticipantes(db, d.cnpjEmit, d.cnpjDest, d.empresaCnpj, d.tpNF);
        if (!dono) { semDono++; continue; }
        if (d.empresaId === dono.empresaId && d.direcao === dono.direcao) continue;
        await docSnap.ref.update({
          empresaId: dono.empresaId,
          empresaCnpj: dono.empresaCnpj,
          direcao: dono.direcao,
          reatribuidoEm: fa().firestore.FieldValue.serverTimestamp(),
          reatribuidoDe: d.empresaId || null,
          reatribuidoMotivo: `auto-${dono.motivo}`,
        });
        reatribuidas++;
      } catch (e) {
        console.warn(`[reatribuirDesconhecidas] falha em ${docSnap.id}:`, e.message);
      }
    }
  } catch (e) {
    console.warn('[reatribuirDesconhecidas] query falhou:', e.message);
    return { examinadas, reatribuidas, semDono, erro: e.message };
  }
  return { examinadas, reatribuidas, semDono };
}

/**
 * Backfill: corrige docs já gravados como 'saida' que são NOTA PRÓPRIA DE
 * ENTRADA (tpNF=0 — compra de produtor rural PF, retorno etc.). O importer
 * antigo decidia só pelo CNPJ do emitente e errava a direção; o Exportar SAGE
 * recusava o CFOP e a DIPAM não via a compra (31/07, caso EDUARDO GUERRA).
 * Roda no fim do sync-cron (idempotente: corrigidos saem da query).
 */
export async function corrigirDirecaoEntradaPropria({ limit = 500 } = {}) {
  const db = fa().firestore();
  let examinadas = 0, corrigidas = 0;
  try {
    // Duas igualdades: sem índice composto (zigzag merge) e a query ENCOLHE a
    // cada rodada — doc corrigido sai do filtro, o backlog drena sozinho.
    const snap = await db.collection('documentos_fiscais')
      .where('tpNF', '==', '0')
      .where('direcao', '==', 'saida')
      .limit(limit)
      .get();
    for (const docSnap of snap.docs) {
      examinadas++;
      const d = docSnap.data() || {};
      // Só corrige quando a EMPRESA dona é mesmo a emitente (nota própria);
      // doc atribuído a terceiro não muda de direção por aqui.
      const norm = (c) => String(c || '').replace(/\D/g, '');
      if (norm(d.cnpjEmit) !== norm(d.empresaCnpj)) continue;
      try {
        await docSnap.ref.update({
          direcao: 'entrada',
          direcaoCorrigidaEm: fa().firestore.FieldValue.serverTimestamp(),
          direcaoCorrigidaMotivo: 'tpNF=0 (nota própria de entrada)',
        });
        corrigidas++;
      } catch (e) {
        console.warn(`[corrigirDirecaoEntradaPropria] falha em ${docSnap.id}:`, e.message);
      }
    }
  } catch (e) {
    console.warn('[corrigirDirecaoEntradaPropria] query falhou:', e.message);
    return { examinadas, corrigidas, erro: e.message };
  }
  return { examinadas, corrigidas };
}

/**
 * Backfill: corrige o STATUS de docs cujo cancelamento o app já capturou mas
 * não refletiu (bug 11/08, MV LIDER 639 — cancelada contada no Livro e no
 * fechamento). Duas origens do buraco: evento 155 (fora de prazo) não virava o
 * status, e o merge stub→nota atropelava o 'cancelado'. A prova do cancelamento
 * está no PRÓPRIO doc (eventos[]/cStat) — docCancelado decide; aqui só se grava.
 * Varre por competência (não dá pra consultar dentro de eventos[] no Firestore)
 * e é idempotente: corrigido deixa de casar com o predicado.
 */
export async function corrigirStatusCanceladoPorEvento({ competencias = [], maxDocs = 30000 } = {}) {
  const db = fa().firestore();
  const alvos = (competencias.length ? competencias : [new Date().toISOString().slice(0, 7)]);
  let examinadas = 0, corrigidas = 0;
  for (const competencia of alvos) {
    try {
      const snap = await db.collection('documentos_fiscais')
        .where('competencia', '==', competencia)
        .select('status', 'cStat', 'eventos')
        .limit(maxDocs)
        .get();
      for (const docSnap of snap.docs) {
        examinadas++;
        const d = docSnap.data() || {};
        const statusJaCancelado = ['cancelado', 'cancelada', 'denegado', 'inutilizado']
          .includes(String(d.status || '').toLowerCase());
        if (statusJaCancelado || !docCancelado(d)) continue;
        try {
          await docSnap.ref.update({
            status: 'cancelado',
            statusCorrigidoEm: fa().firestore.FieldValue.serverTimestamp(),
            statusCorrigidoMotivo: 'cancelamento capturado (evento 110111/cStat) sem refletir no status',
          });
          corrigidas++;
        } catch (e) {
          console.warn(`[corrigirStatusCancelado] falha em ${docSnap.id}:`, e.message);
        }
      }
    } catch (e) {
      console.warn(`[corrigirStatusCancelado] query ${competencia} falhou:`, e.message);
    }
  }
  return { examinadas, corrigidas };
}

/**
 * BACKFILL — endereço do participante nos docs capturados ANTES de 04/08.
 *
 * Até então o importer gravava só `cnpjDest`: nas SAÍDAS (onde o participante
 * do E-Fiscal É o destinatário) o Exportar SAGE montava o E010 com nome
 * "CLIENTE" e UF em branco, o E-Fiscal recusava o cadastro e TODAS as notas
 * atrás caíam em cascata. Caso real 04/08: 30 sem UF + 24 com código divergente
 * ⇒ 54 notas recusadas, e o log com 162 linhas.
 *
 * Relê o XML do Storage e preenche xNomeDest/ufDest/codMunDest/ieDest. É
 * idempotente e a query ENCOLHE a cada rodada (doc preenchido sai do filtro),
 * igual ao corrigirDirecaoEntradaPropria.
 */
export async function preencherEnderecoDestinatario(opts = {}) {
  return preencherEnderecoParticipantes({ ...opts, direcao: 'saida' });
}

/**
 * O MESMO backfill, agora também para ENTRADAS.
 *
 * Paulo, 12/08/2026: a aba 🌾 mostrou **323 pendências "nota sem código IBGE do
 * município de origem"** e a DIPAM 1.1 saiu R$ 0,00 — com o FUNRURAL calculado
 * do lado (ele não depende de município). O município ESTÁ no XML guardado no
 * Storage; o que faltava era o campo gravado no documento.
 *
 * E faltava porque este backfill só varria `direcao == 'saida'` — ele nasceu
 * pro Exportar SAGE, onde o participante é o destinatário. Compra de produtor
 * rural é ENTRADA, então nenhuma delas foi tocada.
 *
 * É a regra da casa: reler a FONTE quando o dado já existe nela é RECUPERAÇÃO,
 * não conserto de cadastro. Mandar o colaborador digitar o município de 323
 * produtores seria pedir trabalho por um dado que já está no arquivo.
 *
 * O campo-sentinela muda com a direção: na saída o participante é o
 * destinatário (`ufDest`), na entrada é o emitente (`ufEmit`). Usar o sentinela
 * errado faria o backfill reler os mesmos documentos pra sempre.
 */
export async function preencherEnderecoParticipantes({ limit = 200, empresaId = null, competencia = null, direcao = 'saida' } = {}) {
  const db = fa().firestore();
  let examinadas = 0, preenchidas = 0, semXml = 0, jaTinham = 0;
  try {
    // ARMADILHA DO FIRESTORE: `where('ufDest', '==', null)` NÃO devolve os
    // documentos em que o campo simplesmente NÃO EXISTE — e é esse o caso de
    // tudo que foi capturado antes de 04/08. A primeira versão deste backfill
    // rodava e não achava nada. Por isso a seleção é por direção (+ empresa e
    // competência no modo sob demanda) e o filtro do campo é EM MEMÓRIA.
    let q = db.collection('documentos_fiscais').where('direcao', '==', direcao);
    if (empresaId) q = q.where('empresaId', '==', String(empresaId));
    if (competencia) q = q.where('competencia', '==', String(competencia));

    const snap = await q.limit(empresaId || competencia ? Math.max(limit, 1000) : limit).get();

    const bucket = storage.bucket(STORAGE_BUCKET);
    for (const docSnap of snap.docs) {
      const d = docSnap.data() || {};
      // Já preenchido (inclusive com '' = "o XML não tinha") — não relê.
      // O sentinela é o do lado que INTERESSA naquela direção.
      const sentinela = direcao === 'entrada' ? d.ufEmit : d.ufDest;
      if (sentinela !== undefined && sentinela !== null) { jaTinham++; continue; }
      examinadas++;
      if (!d.storagePath) { semXml++; continue; }
      try {
        const [buf] = await bucket.file(d.storagePath).download();
        const p = extrairParticipantesNfe(buf.toString('utf8'));
        // Grava os DOIS lados: a nota própria de entrada (tpNF=0) tem o
        // produtor no bloco destinatário, e a compra normal tem no emitente.
        // Preencher só um lado deixaria metade das notas rurais sem município.
        //
        // BACKFILL NÃO APAGA. Campo que o XML não trouxe não pode sobrescrever
        // o que o importer já gravou — seria destruir dado bom pra "corrigir"
        // dado ausente. Só a UF do lado varrido recebe '' quando o XML não tem:
        // ela é o SENTINELA (sem ela o mesmo doc voltaria pra fila pra sempre).
        const patch = {};
        const por = (campo, valor) => { if (valor) patch[campo] = valor; };
        por('xNomeDest', p.destinatario.nome);
        por('codMunDest', p.destinatario.codMunIBGE);
        por('ieDest', p.destinatario.ie);
        por('xNomeEmit', p.emitente.nome);
        por('codMunEmit', p.emitente.codMunIBGE);
        por('ieEmit', p.emitente.ie);
        por(direcao === 'entrada' ? 'ufDest' : 'ufEmit', direcao === 'entrada' ? p.destinatario.uf : p.emitente.uf);
        patch[direcao === 'entrada' ? 'ufEmit' : 'ufDest'] = (direcao === 'entrada' ? p.emitente.uf : p.destinatario.uf) || '';
        await docSnap.ref.update(patch);
        const preencheu = direcao === 'entrada' ? p.emitente.uf : p.destinatario.uf;
        if (preencheu) preenchidas++;
      } catch (e) {
        console.warn(`[preencherEnderecoDestinatario] falha em ${docSnap.id}:`, e.message);
        semXml++;
      }
    }
  } catch (e) {
    console.warn('[preencherEnderecoDestinatario] query falhou:', e.message);
    return { examinadas, preenchidas, semXml, jaTinham, erro: e.message };
  }
  return { examinadas, preenchidas, semXml, jaTinham };
}

export async function registrarErroSefaz({ empresaId, empresaCnpj, motivo, contexto, capturadoPor }) {
  try {
    const db = fa().firestore();
    await db.collection('xml_erros').add({
      empresaId,
      empresaCnpj: empresaCnpj?.replace(/\D/g, '') || null,
      origem: 'sefaz',
      motivo,
      contexto: contexto || null,
      capturadoPor: capturadoPor || null,
      createdAt: fa().firestore.FieldValue.serverTimestamp(),
      createdBy: capturadoPor?.uid || null,
    });
  } catch (e) {
    console.error('[xml-importer] falha ao registrar erro:', e.message);
  }
}
