/**
 * Tipos do módulo puro `urgencia-vencimento.js` — a régua ÚNICA de prazo.
 *
 * As fronteiras (atrasada / hoje / amanhã / ≤3d / ≤7d) já divergiram entre
 * `vencimentosLogic.ts` e o `vencimentos-orchestrator.js` (07/08) e voltaram a
 * ser copiadas no `FiscalObligationsDashboard.tsx` (12/08). Quem precisa
 * classificar prazo IMPORTA daqui.
 */
export type Urgencia = 'atrasada' | 'hoje' | 'amanha' | '3d' | '7d' | 'futura';

/** Classifica pela quantidade de DIAS de calendário até o vencimento. */
export function classificarUrgencia(dias: number | null | undefined): Urgencia;

export const URGENCIAS: Urgencia[];
export const URGENCIA_LABEL: Record<Urgencia, string>;
export const URGENCIA_FAROL: Record<Urgencia, string>;
