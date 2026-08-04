// ============================================================================
// sefaz-backend/participante-doc-helper.js  (PURO — testável)
// ----------------------------------------------------------------------------
// RÉGUA ÚNICA pra ler o EMITENTE de um documento capturado.
//
// O mesmo defeito já mordeu três vezes (28/07 Exportar SAGE, 04/08 E010 sem UF,
// 04/08 DIFAL "0 clientes com compra interestadual"): a CAPTURA grava os campos
// ACHATADOS (`cnpjEmit`, `xNomeEmit`, `ufEmit`) e a IMPORTAÇÃO por XML monta os
// OBJETOS (`emitente.cnpjCpf`, `emitente.uf`). Quem lê só uma das formas
// descarta metade da base em silêncio — e "0 resultados" parece "não tem nada".
//
// A UF do EMITENTE tem uma terceira fonte que nunca falha: as duas primeiras
// posições da CHAVE de acesso são o código da UF (cUF). Documento capturado
// pela SEFAZ sempre tem chave. Por isso `ufEmitente` responde mesmo em doc
// antigo, sem depender do backfill.
// ============================================================================

const so = (v) => String(v || '').replace(/\D/g, '');

/** cUF (2 primeiras posições da chave) → sigla. */
export const UF_POR_CUF = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
    '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR',
    '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

/** UF pelo código IBGE do município (2 primeiros dígitos = cUF). */
export function ufDoMunicipioIBGE(codMunIBGE) {
    const d = so(codMunIBGE);
    return d.length === 7 ? (UF_POR_CUF[d.slice(0, 2)] || '') : '';
}

/** CNPJ/CPF do emitente, nas duas formas de gravação. */
export function cnpjEmitente(d) {
    return so(d?.emitente?.cnpjCpf || d?.emitente?.cnpj || d?.cnpjEmit);
}

/** Nome do emitente, nas duas formas. */
export function nomeEmitente(d) {
    return String(d?.emitente?.nome || d?.xNomeEmit || '').trim();
}

/**
 * UF do emitente: objeto → campo achatado → município IBGE → CHAVE (cUF).
 * A chave é a fonte que não falha em documento capturado da SEFAZ.
 */
export function ufEmitente(d) {
    const uf = String(
        d?.emitente?.uf
        || d?.ufEmit
        || d?.ufEmitente
        || '',
    ).toUpperCase();
    if (uf) return uf;

    const porMunicipio = ufDoMunicipioIBGE(d?.emitente?.codMunIBGE || d?.codMunEmit);
    if (porMunicipio) return porMunicipio;

    return UF_POR_CUF[String(d?.chave || '').slice(0, 2)] || '';
}

/** Modelo do documento: campo → chave (posições 21-22) → tipo. */
export function modeloDoDoc(d) {
    const direto = so(d?.modelo);
    if (direto) return direto;
    const daChave = String(d?.chave || '').slice(20, 22);
    if (/^\d{2}$/.test(daChave)) return daChave;
    return d?.tipo === 'NFCe' ? '65' : '55';
}

/**
 * CFOP na ÓTICA DE QUEM RECEBE.
 *
 * O XML traz o CFOP do EMITENTE: venda interestadual sai como 6xxx, e a mesma
 * operação, pra quem recebe, é 2xxx. Filtro de entrada que compara direto com
 * o CFOP do XML não acha nada (caso 04/08: NF 110497 RJ→SP com CFOP 6101 —
 * o painel dizia "0 clientes com compra interestadual").
 *
 * Só troca a FAIXA (1º dígito); os outros três são os mesmos nas duas óticas.
 * CFOP que já é de entrada (1/2/3) passa intacto.
 */
export function cfopNaOticaDeEntrada(cfop) {
    const c = so(cfop);
    if (c.length !== 4) return '';
    const faixa = c[0];
    if (faixa === '5') return `1${c.slice(1)}`;
    if (faixa === '6') return `2${c.slice(1)}`;
    if (faixa === '7') return `3${c.slice(1)}`;
    return c;
}
