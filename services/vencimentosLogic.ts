/**
 * vencimentosLogic.ts — classificação de obrigações fiscais por urgência.
 *
 * As fronteiras (atrasada / hoje / amanhã / ≤3d / ≤7d) NÃO moram mais aqui:
 * elas estavam escritas à mão neste arquivo E no `forEach` do
 * `vencimentos-orchestrator.js`, e o guia do mês da carteira seria a terceira
 * cópia. Duas cópias da mesma régua é divergência esperando acontecer — mexer
 * numa e esquecer a outra faz a tela dizer "vence em 3 dias" enquanto o resumo
 * diário conta como "7 dias", e as duas parecem certas sozinhas.
 *
 * A régua agora vive em `sefaz-backend/urgencia-vencimento.js` (puro, sem io),
 * e este arquivo é só a porta TypeScript dela — mantida para não quebrar quem
 * já importa daqui.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { classificarUrgencia, URGENCIA_LABEL } from '../sefaz-backend/urgencia-vencimento.js';

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
    return classificarUrgencia(dias) as Urg;
}

export const URG_LABEL: Record<Urg, string> = URGENCIA_LABEL;
