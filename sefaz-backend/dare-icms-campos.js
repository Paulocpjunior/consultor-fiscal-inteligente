// ============================================================================
// sefaz-backend/dare-icms-campos.js  (PURO — sem rede, testável)
// ----------------------------------------------------------------------------
// Campos adicionais da Web API DARE-ICMS da SEFAZ-SP (credenciamento recebido
// em 27/07/2026). Algumas receitas exigem informação extra que o DARE imprime
// nas linhas 06 e 08 do documento:
//
//   Serviço  Receita  linha06                          linha08
//   08101    081-4    —                                Nº Parcelamento (9 dígitos)
//   1044     104-1    —                                Nº Parcelamento (9 dígitos)
//   06305    063-2    Lote (1-10 caracteres)           Edital (1-35 caracteres)
//   89202    892-8    Nº Reclamação/Operação (2-10)    —
//   24701    247-1    Nº da Nota Fiscal (até 35)       —
//   04603    046-2    Nº da Nota Fiscal (até 35)       —
//   14604    146-6    Nº da Nota Fiscal (até 35)       —
//   06307    063-2    Nº da Nota Fiscal (até 35)       —
//   06308    063-2    Nº da Nota Fiscal (até 35)       —
//
// Mandar o DARE sem o campo exigido volta erro do gateway DEPOIS de gastar a
// chamada; validar aqui devolve a instrução em português ANTES de emitir.
// ============================================================================

/**
 * Exigências por código de serviço. `regex` é a validação publicada pela
 * SEFAZ; `rotulo` é o nome que aparece no DARE (é o que o operador procura).
 */
export const CAMPOS_EXTRA_POR_SERVICO = {
  '08101': {
    linha08: { rotulo: 'Nº do Parcelamento', regex: /^[0-9]{9}$/, ajuda: 'nove dígitos, só números' },
  },
  '1044': {
    linha08: { rotulo: 'Nº do Parcelamento', regex: /^[0-9]{9}$/, ajuda: 'nove dígitos, só números' },
  },
  '06305': {
    linha06: { rotulo: 'Lote', regex: /^.{1,10}$/, ajuda: 'de 1 a 10 caracteres' },
    linha08: { rotulo: 'Edital', regex: /^.{1,35}$/, ajuda: 'de 1 a 35 caracteres' },
  },
  '89202': {
    linha06: { rotulo: 'Nº da Reclamação (ou Operação)', regex: /^[0-9]{2,10}$/, ajuda: 'de 2 a 10 dígitos, só números' },
  },
  '24701': {
    linha06: { rotulo: 'Número da Nota Fiscal', regex: /^[0-9]{1,35}$/, ajuda: 'até 35 dígitos, só números' },
  },
  '04603': {
    linha06: { rotulo: 'Número da Nota Fiscal', regex: /^[0-9]{1,35}$/, ajuda: 'até 35 dígitos, só números' },
  },
  '14604': {
    linha06: { rotulo: 'Número da Nota Fiscal', regex: /^[0-9]{1,35}$/, ajuda: 'até 35 dígitos, só números' },
  },
  '06307': {
    linha06: { rotulo: 'Número da Nota Fiscal', regex: /^[0-9]{1,35}$/, ajuda: 'até 35 dígitos, só números' },
  },
  '06308': {
    linha06: { rotulo: 'Número da Nota Fiscal', regex: /^[0-9]{1,35}$/, ajuda: 'até 35 dígitos, só números' },
  },
};

/** Normaliza o código de serviço (a SEFAZ mistura '4601' e '04601'). */
export function normalizarCodigoServico(codigo) {
  const s = String(codigo || '').replace(/\D/g, '');
  if (!s) return '';
  // '1044' (FECOEP) tem 4 dígitos de verdade; os demais são de 5.
  if (s === '1044') return s;
  return s.length === 4 ? `0${s}` : s;
}

/** O que este serviço exige? {} quando não exige nada. */
export function exigenciasDoServico(codigoServico) {
  return CAMPOS_EXTRA_POR_SERVICO[normalizarCodigoServico(codigoServico)] || {};
}

/**
 * Valida os campos extras de um DARE.
 *
 * @returns {{ ok: boolean, erros: string[], campos: {linha06?: string, linha08?: string} }}
 *   `campos` sai limpo (trim) e só com o que o serviço aceita — mandar
 *   linha06 numa receita que não usa é ruído que o gateway pode recusar.
 */
export function validarCamposExtra({ codigoServico, linha06, linha08 } = {}) {
  const exig = exigenciasDoServico(codigoServico);
  const erros = [];
  const campos = {};

  for (const chave of ['linha06', 'linha08']) {
    const regra = exig[chave];
    const bruto = chave === 'linha06' ? linha06 : linha08;
    const valor = bruto == null ? '' : String(bruto).trim();

    if (!regra) {
      if (valor) {
        erros.push(`O serviço ${normalizarCodigoServico(codigoServico)} não usa o campo ${chave} — remova "${valor.slice(0, 20)}" antes de emitir.`);
      }
      continue;
    }
    if (!valor) {
      erros.push(`Informe ${regra.rotulo} (${chave} do DARE): ${regra.ajuda}.`);
      continue;
    }
    if (!regra.regex.test(valor)) {
      erros.push(`${regra.rotulo} inválido ("${valor.slice(0, 40)}") — o formato aceito é: ${regra.ajuda}.`);
      continue;
    }
    campos[chave] = valor;
  }

  return { ok: erros.length === 0, erros, campos };
}
