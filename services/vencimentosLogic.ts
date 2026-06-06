/**
 * vencimentosLogic.ts — classificação pura de obrigações fiscais por
 * urgência. Separado do painel pra testar fronteiras (≤3 dias, ≤7 dias).
 *
 * As fronteiras são definitivas — mudá-las muda o que aparece na tela
 * "vencimentos da semana" e potencialmente o que NÃO é alertado.
 */

export type Urg = 'atrasada' | 'hoje' | 'amanha' | '3d' | '7d' | 'futura';

/**
 * Classifica uma obrigação fiscal pelo número de dias até o vencimento.
 *
 *   atrasada  dias < 0  (já venceu)
 *   hoje      dias = 0
 *   amanha    dias = 1
 *   3d        dias = 2 ou 3
 *   7d        dias = 4..7
 *   futura    dias > 7  (fora do horizonte da semana)
 */
export function classificarUrgenciaVencimento(dias: number): Urg {
    if (!Number.isFinite(dias)) return 'futura';
    if (dias < 0) return 'atrasada';
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'amanha';
    if (dias <= 3) return '3d';
    if (dias <= 7) return '7d';
    return 'futura';
}

export const URG_LABEL: Record<Urg, string> = {
    atrasada: 'ATRASADA',
    hoje: 'VENCE HOJE',
    amanha: 'VENCE AMANHÃ',
    '3d': 'EM 3 DIAS',
    '7d': 'EM 7 DIAS',
    futura: 'FUTURA',
};
