/**
 * caixaPostalRadarLogic.ts — funções PURAS de classificação e risco.
 *
 * Separado do service de I/O (caixaPostalRadarService.ts) pra ser testável
 * sem mockar fetch/auth. As regras (categorias críticas, score 0-100) são
 * fiscais e merecem captura de regressão.
 */

export type Urgencia = 'critica' | 'alta' | 'media' | 'baixa';

// Categorias que exigem AÇÃO/RESPOSTA (não meros informativos).
// CRITICAS: intimações da Receita, malha fiscal, exclusão Simples,
// autos de infração DET, citações judiciais — todas com prazo legal.
export const CRITICAS = new Set([
    'intimacao', 'malha', 'exclusao', 'det_auto_infracao', 'dje_citacao',
]);
// ALTAS: requerem ação mas com prazo mais flexível.
export const ALTAS = new Set([
    'dec_intimacao', 'dje_intimacao', 'emac_notificacao', 'prefeitura_sp_iss',
]);
// MEDIAS: notificação simples DET (requer ciência).
export const MEDIAS = new Set(['det_notificacao']);
// BAIXAS (implícita): informativo, dec_comunicado, prefeitura_sp_nfse,
// prefeitura_sp_comunicado — meros comunicados.

/** Classifica uma categoria de mensagem em urgência. */
export function classificarUrgencia(cat: string): Urgencia {
    if (CRITICAS.has(cat)) return 'critica';
    if (ALTAS.has(cat)) return 'alta';
    if (MEDIAS.has(cat)) return 'media';
    return 'baixa';
}

/**
 * Score 0-100 da mensagem. Quanto MAIOR, mais urgente:
 *   base por urgência (60/40/20/5) +
 *   idade (dias parado, cap em 30) +
 *   bônus prazo (+50 vencido, +30 em 24h, +15 em 5d).
 */
export function calcularRisco(args: {
    urgencia: Urgencia;
    diasParado: number;
    diasParaPrazo: number | null;
}): number {
    const baseUrg = { critica: 60, alta: 40, media: 20, baixa: 5 }[args.urgencia];
    const idade = Math.max(0, Math.min(args.diasParado, 30));
    let prazoBonus = 0;
    if (args.diasParaPrazo != null) {
        if (args.diasParaPrazo < 0) prazoBonus = 50;
        else if (args.diasParaPrazo <= 1) prazoBonus = 30;
        else if (args.diasParaPrazo <= 5) prazoBonus = 15;
    }
    return Math.min(100, baseUrg + idade + prazoBonus);
}

/**
 * Diferença em dias inteiros: do início (a) até depois (b). Retorna `b - a`,
 * então `diasEntre(dataEnvio, hoje)` = dias passados desde envio (positivo).
 */
export function diasEntre(a: Date, b: Date): number {
    return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/** Parse defensivo de ISO date string. */
export function parseDate(s: string | null | undefined): Date | null {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}
