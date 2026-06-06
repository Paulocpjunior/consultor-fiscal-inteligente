/**
 * prescricaoLogic.ts — funções PURAS de prescrição tributária (CTN art 168).
 *
 * Recuperação tributária expira em 5 anos a partir do "fato gerador" — aqui
 * adotamos o último dia da competência como marco. Errar UM dia pode dizer
 * a uma empresa que perdeu R$ X que ela ainda tem; ou pior, vice-versa.
 *
 * Separado do componente UI pra ter captura de regressão.
 */

export type SeveridadePrescricao = 'expirado' | 'urgente' | 'alerta' | 'ok';

const ANOS_PRESCRICAO = 5;

/**
 * Último dia da competência YYYY-MM. Retorna Date (local time) representando
 * 00:00 do dia 1 do mês SEGUINTE menos 1ms — efetivamente "último ms do mês".
 * Para comparações por dia, basta usar a data como referência.
 *
 * Implementação: `new Date(ano, mes, 0)` retorna o dia 0 do mês `mes`, que é
 * o último dia do mês ANTERIOR. Com mes em base 1, isso vira último dia da
 * competência informada.
 */
export function ultimoDiaCompetencia(comp: string): Date | null {
    const m = /^(\d{4})-(\d{2})$/.exec(comp);
    if (!m) return null;
    const ano = Number(m[1]);
    const mes = Number(m[2]);
    if (mes < 1 || mes > 12) return null;
    return new Date(ano, mes, 0);
}

/**
 * Data limite da prescrição: último dia da competência + 5 anos (CTN art 168).
 * Retorna null se a competência for inválida.
 */
export function dataLimitePrescricao(comp: string): Date | null {
    const fim = ultimoDiaCompetencia(comp);
    if (!fim) return null;
    return new Date(fim.getFullYear() + ANOS_PRESCRICAO, fim.getMonth(), fim.getDate());
}

/**
 * Dias restantes até a prescrição (negativo = já passou).
 * @param comp YYYY-MM
 * @param agora data de referência (default = new Date())
 */
export function diasAteExpirar(comp: string, agora: Date = new Date()): number | null {
    const fim = dataLimitePrescricao(comp);
    if (!fim) return null;
    const MS_DIA = 1000 * 60 * 60 * 24;
    return Math.floor((fim.getTime() - agora.getTime()) / MS_DIA);
}

/**
 * Classifica a urgência de uma recuperação pela data restante:
 *   EXPIRADO  — já passou (não dá pra recuperar)
 *   URGENTE   — ≤90 dias
 *   ALERTA    — ≤1 ano
 *   OK        — >1 ano
 */
export function classificarPrescricao(diasRestantes: number): SeveridadePrescricao {
    if (diasRestantes < 0) return 'expirado';
    if (diasRestantes <= 90) return 'urgente';
    if (diasRestantes <= 365) return 'alerta';
    return 'ok';
}

export const _constantes = { ANOS_PRESCRICAO };
