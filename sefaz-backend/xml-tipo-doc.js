// ============================================================================
// xml-tipo-doc.js
//
// Classificacao do tipo de DF-e a partir do schema (procNFe_v4.00.xsd etc) e,
// como reforco, do MODELO codificado na chave de 44 digitos (posicoes 21-22):
//   55 -> NFe         65 -> NFCe         57 -> CTe         58 -> MDFe
//
// Modulo PURO (sem firebase, sem io) — testavel direto em jest.
// Extraido de xml-importer.js pra cobrir o gap real:
// ANTES o backend so reconhecia procNFe/resNFe/proc(CTe|MDFe). NFCe (modelo
// 65, schema procNFCe) era classificada como 'desconhecido' e ficava no
// limbo quando alguma empresa-cliente que vende no varejo recebia o XML
// via DistDFe (cenario B2B varejo com CNPJ no destinatario).
//
// Returns { tipoDoc, tipoNormalizado } onde:
//   - tipoDoc: rotulo interno, distingue resumo do completo (resNFe x NFe)
//             e eventos (eventoNFe etc). Usado pra logica de upgrade
//             resumo->completa do importer.
//   - tipoNormalizado: rotulo do frontend (XmlTipoDocumento) — agrupa
//             resumo+completa+evento sob a mesma "familia" (NFe, NFCe,
//             CTe, MDFe). E o que vai pra coluna "Tipo" da UI.
// ============================================================================

/**
 * @param {string|null|undefined} schema  Ex: 'procNFe_v4.00.xsd', 'resNFCe_v1.01.xsd'
 * @param {string|null|undefined} chave   44 digitos (com ou sem nao-digitos)
 * @returns {{ tipoDoc: string, tipoNormalizado: string }}
 */
export function classificarTipoDoc(schema, chave) {
  const s = String(schema || '');
  const chaveLimpa = String(chave || '').replace(/\D/g, '');
  // Modelo na chave (posicoes 21-22, 0-indexed 20-22). So confiavel pra
  // chave de 44 digitos. Outras (eventos com Id de 54+) tem chave embutida.
  const modelo = chaveLimpa.length === 44 ? chaveLimpa.substring(20, 22) : '';

  // ── 1) Por SCHEMA (caminho preferido — mais explicito) ────────────────
  if (s.startsWith('procNFCe'))        return { tipoDoc: 'NFCe',        tipoNormalizado: 'NFCe' };
  if (s.startsWith('resNFCe'))         return { tipoDoc: 'resNFCe',     tipoNormalizado: 'NFCe' };
  if (s.startsWith('procEventoNFCe'))  return { tipoDoc: 'eventoNFCe',  tipoNormalizado: 'NFCe' };
  if (s.startsWith('procNFe'))         return { tipoDoc: 'NFe',         tipoNormalizado: 'NFe'  };
  if (s.startsWith('resNFe')) {
    // resNFe (resumo) tecnicamente pode ser de modelo 55 OU 65. Se a chave
    // mostrar 65, classifica como NFCe — mantem o agrupamento correto na UI
    // (clientes varejistas veem suas NFCe na coluna NFCe, nao NFe).
    if (modelo === '65') return { tipoDoc: 'resNFCe', tipoNormalizado: 'NFCe' };
    return { tipoDoc: 'resNFe', tipoNormalizado: 'NFe' };
  }
  if (s.startsWith('procCTe'))         return { tipoDoc: 'CTe',         tipoNormalizado: 'CTe'  };
  if (s.startsWith('resCTe'))          return { tipoDoc: 'resCTe',      tipoNormalizado: 'CTe'  };
  if (s.startsWith('procMDFe'))        return { tipoDoc: 'MDFe',        tipoNormalizado: 'MDFe' };
  if (s.startsWith('resMDFe'))         return { tipoDoc: 'resMDFe',     tipoNormalizado: 'MDFe' };
  if (s.startsWith('procEPEC'))        return { tipoDoc: 'EPEC',        tipoNormalizado: 'NFe'  };
  if (s.startsWith('procEventoNFe')) {
    // Evento de NFe — mas se a chave referenciada tem modelo 65, na verdade
    // e evento de NFCe (cancelamento de NFCe e o caso comum).
    if (modelo === '65') return { tipoDoc: 'eventoNFCe', tipoNormalizado: 'NFCe' };
    return { tipoDoc: 'eventoNFe', tipoNormalizado: 'NFe' };
  }
  if (s.startsWith('procEventoCTe'))   return { tipoDoc: 'eventoCTe',   tipoNormalizado: 'CTe'  };
  if (s.startsWith('procEventoMDFe'))  return { tipoDoc: 'eventoMDFe',  tipoNormalizado: 'MDFe' };
  if (s.startsWith('resEvento')) {
    if (modelo === '65') return { tipoDoc: 'eventoNFCe', tipoNormalizado: 'NFCe' };
    return { tipoDoc: 'resEvento', tipoNormalizado: 'NFe' };
  }

  // ── 2) Fallback por MODELO da chave (quando schema vier malformado ou
  // ausente, ainda salvamos algo classificado em vez de 'desconhecido') ──
  if (modelo === '65') return { tipoDoc: 'NFCe', tipoNormalizado: 'NFCe' };
  if (modelo === '55') return { tipoDoc: 'NFe',  tipoNormalizado: 'NFe'  };
  if (modelo === '57') return { tipoDoc: 'CTe',  tipoNormalizado: 'CTe'  };
  if (modelo === '58') return { tipoDoc: 'MDFe', tipoNormalizado: 'MDFe' };

  return { tipoDoc: 'desconhecido', tipoNormalizado: 'desconhecido' };
}
