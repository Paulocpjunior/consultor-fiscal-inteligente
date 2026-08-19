// ============================================================================
// gravacao-nfe-regua.js  (PURO — sem Firebase, sem Storage, sem rede)
// ----------------------------------------------------------------------------
// A régua que decide o que acontece quando um XML chega e a CHAVE JÁ EXISTE:
// duplicado, upgrade (resumo/incompleto/digitada → completa) ou merge.
//
// Ela nasceu dentro de `xml-importer.js` e SAIU de lá por uma razão só: o
// importer puxa firebase-admin e @google-cloud/storage, então nenhum código de
// NAVEGADOR conseguia importá-lo — e a importação manual (frontend) ficou sem
// a régua, recusando como "duplicado" o XML completo de uma nota que estava na
// base como RESUMO (caso PWR, 19/08: 4 notas sem nº/itens/CST porque o
// resumo nunca foi completado, e a colaboradora tentando importar a completa
// levava "já importado"). Duas leituras do mesmo fato divergindo — a armadilha
// de sempre — se resolve com UM módulo, não consertando a cópia.
//
// `xml-importer.js` importa daqui e RE-EXPORTA `decidirGravacaoNFe`, então
// quem já importava do importer continua funcionando.
// ============================================================================

// resNFe (resumo, ~531 bytes, SEM itens/valor) x procNFe (NFe COMPLETA). Vale
// tambem pra NFCe (modelo 65). O DistDFe entrega PRIMEIRO o resumo; a completa
// vem depois da Ciencia. Na base, resumo se reconhece pelo schema/tipoDoc ou
// por temItens=false num modelo que TEM itens (57/58 nunca tem).
export const isResumoSchema = (sch) => /^res(NFe|NFCe|CTe|MDFe)/.test(String(sch || ''));
export const isResumoTipoDoc = (td) => td === 'resNFe' || td === 'resNFCe' || td === 'resCTe' || td === 'resMDFe';

// 57 (CTe)/58 (MDFe) NUNCA tem itens. Por isso temItens=false so indica "resumo"
// nos modelos que teriam itens (55/65).
export const modeloComItens = (ch) => { const m = String(ch || '').slice(20, 22); return m === '55' || m === '65'; };

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
  // NOTA DIGITADA: lançada à mão, sem XML (15/08 — "importação automática ou
  // manual tem a mesma finalidade"). Ela é o RETRATO que a pessoa fez do
  // documento; o XML é o documento. Quando o XML chega, ele SUBSTITUI — sem
  // isto, a digitada de hoje travaria como "duplicado" o XML verdadeiro de
  // amanhã, a mesma família da lápide que travava a reimportação (14/08).
  // Resumo não rebaixa digitada: resumo tem MENOS que o lançamento completo.
  const exDigitada = exists && exData.origem === 'digitada';
  // Upgrade = a base tem menos do que está chegando. Nunca o contrário: o
  // `!incomingResumo` impede que um resumo rebaixe uma nota completa.
  const upgrade = exists && (exResumo || exIncompleto || exDigitada) && !incomingResumo;
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
