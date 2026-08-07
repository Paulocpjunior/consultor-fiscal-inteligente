// ============================================================================
// sefaz-backend/urgencia-vencimento.js  (PURO — testável)
// ----------------------------------------------------------------------------
// A RÉGUA DE PRAZO, num lugar só.
//
// As fronteiras (atrasada / hoje / amanhã / ≤3d / ≤7d) já existiam em DOIS
// lugares escritos à mão: `services/vencimentosLogic.ts` e o `forEach` do
// `vencimentos-orchestrator.js`. Duas cópias da mesma régua é uma divergência
// esperando acontecer — mexer numa e esquecer a outra faz a tela dizer "vence
// em 3 dias" enquanto o resumo diário conta como "7 dias", e ninguém percebe
// porque as duas telas parecem certas sozinhas.
//
// Agora o guia do mês da carteira vira o TERCEIRO consumidor. Antes de somar
// uma terceira cópia, a régua virou módulo — e é este que os três leem.
//
// A COR faz parte da régua, não da tela: farol que cada painel pinta do seu
// jeito é a mesma divergência, só que visual. Vermelho é atraso, âmbar é
// "hoje/amanhã", e daí pra frente esfria.
// ============================================================================

/** @typedef {'atrasada'|'hoje'|'amanha'|'3d'|'7d'|'futura'} Urgencia */

/**
 * Urgência pelo número de dias até o vencimento.
 *
 *   atrasada  dias < 0   (já venceu)
 *   hoje      dias = 0
 *   amanha    dias = 1
 *   3d        dias 2..3
 *   7d        dias 4..7
 *   futura    dias > 7
 *
 * Dia não numérico vira 'futura' de propósito: sem data não se inventa
 * urgência, e alarme sem data seria alarme que ninguém consegue fechar.
 */
export function classificarUrgencia(dias) {
    if (!Number.isFinite(dias)) return 'futura';
    if (dias < 0) return 'atrasada';
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'amanha';
    if (dias <= 3) return '3d';
    if (dias <= 7) return '7d';
    return 'futura';
}

export const URGENCIAS = ['atrasada', 'hoje', 'amanha', '3d', '7d', 'futura'];

export const URGENCIA_LABEL = {
    atrasada: 'ATRASADA',
    hoje: 'VENCE HOJE',
    amanha: 'VENCE AMANHÃ',
    '3d': 'EM 3 DIAS',
    '7d': 'EM 7 DIAS',
    futura: 'FUTURA',
};

/** Farol da urgência. Só 'futura' é verde — o resto pede olho. */
export const URGENCIA_FAROL = {
    atrasada: 'vermelho',
    hoje: 'vermelho',
    amanha: 'ambar',
    '3d': 'ambar',
    '7d': 'ambar',
    futura: 'verde',
};

/** Peso pra ordenar: quem está mais apertado primeiro. */
const PESO = Object.fromEntries(URGENCIAS.map((u, i) => [u, i]));

/** A urgência MAIS APERTADA de uma lista. Lista vazia = null, nunca 'futura'. */
export function urgenciaDominante(urgencias) {
    const validas = (urgencias || []).filter((u) => PESO[u] !== undefined);
    if (!validas.length) return null;
    return validas.sort((a, b) => PESO[a] - PESO[b])[0];
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Dias entre hoje e um vencimento, em dias de CALENDÁRIO (não em horas).
 *
 * Vencimento é dia, não instante: uma obrigação que vence hoje às 23h não está
 * "a 0,04 dias" — está vencendo HOJE. Comparar por instante faria a mesma
 * tarefa mudar de faixa ao longo do dia.
 *
 * @param {Date|{toDate?:()=>Date}|string|number} vencimento
 * @param {number} agoraMs
 * @returns {number|null} null quando não há data legível — ausente ≠ futura.
 */
export function diasAteVencimento(vencimento, agoraMs = Date.now()) {
    const d = paraData(vencimento);
    if (!d) return null;
    const meiaNoite = (x) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
    return Math.round((meiaNoite(d) - meiaNoite(new Date(agoraMs))) / DIA_MS);
}

function paraData(v) {
    if (!v) return null;
    if (typeof v?.toDate === 'function') {
        try { return v.toDate(); } catch { return null; }
    }
    const d = v instanceof Date ? v : new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
}
