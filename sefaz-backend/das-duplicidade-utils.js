// ============================================================================
// das-duplicidade-utils.js
// Regras puras para evitar duplicidade de DAS avulso.
// ============================================================================

import { normalizarValorDas } from './das-valor-utils.js';
import { normalizarCompetencia } from './competencia.js';

function isStatusAtivo(status) {
    return !status || status === 'pendente' || status === 'vencido';
}

function mesmoValor(a, b) {
    return Math.abs(normalizarValorDas(a) - normalizarValorDas(b)) <= 0.01;
}

/**
 * A MESMA competência, em qualquer das quatro formas. Comparar `!==` cru era
 * a armadilha das duas formas na trava que impede a segunda guia: um DAS
 * gravado como `2026-05` e o pedido chegando `05/2026` nunca se encontravam,
 * e a duplicata passava. Ilegível de um dos lados NÃO é "igual" — é uma
 * competência que não se sabe qual é.
 */
function mesmaCompetencia(a, b) {
    const na = normalizarCompetencia(a);
    const nb = normalizarCompetencia(b);
    return na !== null && nb !== null && na === nb;
}

export function encontrarConflitoDasAvulso(existentes = [], req = {}) {
    const valor = normalizarValorDas(req.valor);
    return existentes.find((doc) => {
        if (!doc || !mesmaCompetencia(doc.competencia, req.competencia)) return false;

        const tipo = String(doc.tipo || '').toLowerCase();
        const status = doc.statusPagamento || 'pendente';
        const valorIgual = mesmoValor(doc.valor, valor);

        if (tipo === 'regular' && isStatusAtivo(status)) return true;
        if (tipo === 'regular' && valorIgual) return true;
        if (tipo === 'avulso' && isStatusAtivo(status) && valorIgual) return true;
        return false;
    }) || null;
}

export function criarErroDuplicidadeDas(conflito) {
    const tipo = conflito?.tipo === 'regular' ? 'regular' : 'avulso';
    const status = conflito?.statusPagamento || 'pendente';
    const err = new Error(
        `Ja existe DAS ${tipo} ${status} para esta empresa e competencia. ` +
        'Abra a guia existente no Painel DAS em vez de emitir outra avulsa.'
    );
    err.code = 'DAS_DUPLICADO';
    err.httpStatus = 409;
    err.dasExistenteId = conflito?.id || '';
    err.dasExistenteTipo = tipo;
    err.dasExistenteStatus = status;
    return err;
}
