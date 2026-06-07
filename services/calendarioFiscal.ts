/**
 * calendarioFiscal — datas e regras das obrigacoes acessorias por regime.
 *
 * Define quais obrigacoes cada regime tem e quando vencem.
 * Eh usado pelo cron mensal pra criar as tarefas automaticas.
 *
 * Regras de vencimento:
 *   - DAS (Simples)     -> dia 20 do mes seguinte ao periodo
 *   - DCTFWeb           -> dia 15 do mes seguinte
 *   - FGTS Digital      -> dia 20 do mes seguinte
 *   - SPED Fiscal (EFD) -> dia 25 do SEGUNDO mes seguinte
 *
 * Se vencer em sabado/domingo, antecipa pra sexta. Feriado nacional nao
 * eh detectado (raro precisar pra essas obrigacoes mensais).
 */

import type { RegimeSugerido } from './xmlFiscalService';

export type Obrigacao = 'DAS' | 'DCTFWEB' | 'FGTS' | 'SPED';

export interface RegraObrigacao {
    obrigacao: Obrigacao;
    diaVencimento: number;
    mesesApos: number;          // 1 = mes seguinte; 2 = segundo mes
    label: string;              // ex: "DAS" — usado no titulo da tarefa
}

/**
 * Obrigacoes mensais por regime.
 * Anuais (DEFIS, ECD, ECF) ficam pra v2 — focamos nas 4 primarias.
 */
export const OBRIGACOES_POR_REGIME: Record<string, RegraObrigacao[]> = {
    SIMPLES: [
        { obrigacao: 'DAS',     diaVencimento: 20, mesesApos: 1, label: 'DAS' },
        { obrigacao: 'FGTS',    diaVencimento: 20, mesesApos: 1, label: 'FGTS Digital' },
    ],
    LUCRO_PRESUMIDO: [
        { obrigacao: 'DCTFWEB', diaVencimento: 15, mesesApos: 1, label: 'DCTFWeb' },
        { obrigacao: 'FGTS',    diaVencimento: 20, mesesApos: 1, label: 'FGTS Digital' },
        { obrigacao: 'SPED',    diaVencimento: 25, mesesApos: 2, label: 'SPED Fiscal' },
    ],
    LUCRO_REAL: [
        { obrigacao: 'DCTFWEB', diaVencimento: 15, mesesApos: 1, label: 'DCTFWeb' },
        { obrigacao: 'FGTS',    diaVencimento: 20, mesesApos: 1, label: 'FGTS Digital' },
        { obrigacao: 'SPED',    diaVencimento: 25, mesesApos: 2, label: 'SPED Fiscal' },
    ],
};

/**
 * Antecipa data pra sexta se cair sabado/domingo.
 * 0 = domingo, 6 = sabado.
 */
function anteciparFimDeSemana(d: Date): Date {
    const dia = d.getDay();
    if (dia === 6) d.setDate(d.getDate() - 1);       // sabado -> sexta
    else if (dia === 0) d.setDate(d.getDate() - 2);  // domingo -> sexta
    return d;
}

/**
 * Calcula a data de vencimento real de uma obrigacao para uma competencia.
 *
 * @param competencia string MM/AAAA (ex: "04/2026")
 * @param regra regra do calendario (mesesApos + diaVencimento)
 * @returns Date com horario 00:00:00 local
 */
export function calcularVencimento(competencia: string, regra: RegraObrigacao): Date {
    const [mesStr, anoStr] = competencia.split('/');
    const mes = parseInt(mesStr || '', 10);   // 1..12
    const ano = parseInt(anoStr || '', 10);
    if (isNaN(mes) || isNaN(ano)) {
        throw new Error(`competencia invalida: "${competencia}"`);
    }

    // mes do vencimento = mes da competencia + mesesApos
    // (em JS, Date usa mes 0..11; ajuste)
    const dataBase = new Date(ano, mes - 1 + regra.mesesApos, regra.diaVencimento);
    return anteciparFimDeSemana(dataBase);
}

/**
 * Retorna as obrigacoes do regime, ou array vazio se regime desconhecido.
 */
export function obrigacoesDoRegime(regime: RegimeSugerido | null | undefined): RegraObrigacao[] {
    if (!regime) return [];
    return OBRIGACOES_POR_REGIME[regime] || [];
}
