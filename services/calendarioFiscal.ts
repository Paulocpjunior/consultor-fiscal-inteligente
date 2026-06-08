/**
 * calendarioFiscal — datas e regras das obrigacoes acessorias por regime.
 *
 * Define quais obrigacoes cada regime tem e quando vencem.
 * Eh usado pelo cron mensal pra criar as tarefas automaticas.
 *
 * Regras de vencimento (mensais):
 *   - DAS (Simples)        -> dia 20 do mes seguinte (LC 123/06 art. 21)
 *   - DCTFWeb              -> dia 15 do mes seguinte (IN RFB 2.005/21)
 *   - FGTS Digital         -> dia 20 do mes seguinte (Portaria MTE 3.872/23)
 *   - INSS-CPP             -> dia 20 do mes seguinte (Lei 8.212/91 art. 30)
 *   - PIS/COFINS           -> dia 25 do mes seguinte (Lei 11.933/09)
 *   - EFD-Contribuicoes    -> dia 14 do 2o mes seguinte (IN RFB 2.005/21 art. 4)
 *   - SPED Fiscal (EFD)    -> dia 25 do 2o mes seguinte
 *
 * Trimestrais (LP/LR):
 *   - IRPJ trimestral      -> ultimo dia util do mes seguinte ao trim (Lei 9.430/96 art. 5)
 *   - CSLL trimestral      -> idem IRPJ
 *
 * Anuais:
 *   - DEFIS (Simples)      -> 31/03 do ano seguinte (Res. CGSN 140 art. 72)
 *   - ECF (LP/LR)          -> ultimo dia util de julho (IN RFB 2.039/21)
 *   - ECD (LP/LR)          -> ultimo dia util de junho (IN RFB 2.003/21)
 *
 * Se cair em sabado/domingo/feriado nacional, PRORROGA para o proximo
 * dia util (regra CGSN/RFB - LC 123/2006, IN RFB 2.005/2021).
 */

import type { RegimeSugerido } from './xmlFiscalService';
import { prorrogarParaDiaUtil, ehDiaUtil } from './feriadosNacionais';

export type Obrigacao =
    | 'DAS'
    | 'DCTFWEB'
    | 'FGTS'
    | 'SPED'
    | 'INSS_CPP'
    | 'PIS_COFINS'
    | 'EFD_CONTRIB'
    | 'IRPJ_TRIM'
    | 'CSLL_TRIM'
    | 'DEFIS'
    | 'ECF'
    | 'ECD';

export interface RegraObrigacao {
    obrigacao: Obrigacao;
    diaVencimento: number;
    mesesApos: number;          // 1 = mes seguinte; 2 = segundo mes
    label: string;              // ex: "DAS" — usado no titulo da tarefa

    /**
     * Frequencia da obrigacao. 'mensal' (default) gera tarefa todo mes.
     * 'trimestral' so gera nos meses que fecham trimestre (mar/jun/set/dez).
     * 'anual' so gera no mes 12 (competencia = dezembro).
     */
    frequencia?: 'mensal' | 'trimestral' | 'anual';

    /**
     * Se true, ignora `diaVencimento` e usa o ULTIMO dia util do mes-alvo
     * (mes da competencia + mesesApos). Usado em IRPJ/CSLL trimestral
     * (Lei 9.430/96 art. 5o) e em ECF/ECD/DEFIS anuais.
     */
    ultimoDiaUtilDoMes?: boolean;
}

/**
 * Obrigacoes por regime — mensais + trimestrais + anuais juntas.
 * O cron mensal decide quais disparam no mes corrente via `frequencia`.
 */
export const OBRIGACOES_POR_REGIME: Record<string, RegraObrigacao[]> = {
    SIMPLES: [
        { obrigacao: 'DAS',     diaVencimento: 20, mesesApos: 1, label: 'DAS', frequencia: 'mensal' },
        { obrigacao: 'FGTS',    diaVencimento: 20, mesesApos: 1, label: 'FGTS Digital', frequencia: 'mensal' },
        // DEFIS: competencia = dezembro/ano-base, vence ate 31/03 do ano seguinte.
        // Modelado como "mes 3 do ano seguinte (mesesApos=3), ultimo dia util".
        { obrigacao: 'DEFIS',   diaVencimento: 31, mesesApos: 3, label: 'DEFIS', frequencia: 'anual', ultimoDiaUtilDoMes: true },
    ],
    LUCRO_PRESUMIDO: [
        { obrigacao: 'DCTFWEB',    diaVencimento: 15, mesesApos: 1, label: 'DCTFWeb', frequencia: 'mensal' },
        { obrigacao: 'FGTS',       diaVencimento: 20, mesesApos: 1, label: 'FGTS Digital', frequencia: 'mensal' },
        { obrigacao: 'INSS_CPP',   diaVencimento: 20, mesesApos: 1, label: 'INSS Patronal', frequencia: 'mensal' },
        { obrigacao: 'PIS_COFINS', diaVencimento: 25, mesesApos: 1, label: 'PIS/COFINS', frequencia: 'mensal' },
        { obrigacao: 'EFD_CONTRIB',diaVencimento: 14, mesesApos: 2, label: 'EFD-Contribuicoes', frequencia: 'mensal' },
        { obrigacao: 'SPED',       diaVencimento: 25, mesesApos: 2, label: 'SPED Fiscal', frequencia: 'mensal' },
        // IRPJ/CSLL trimestral: gera so quando competencia fecha trimestre (mar/jun/set/dez).
        // Vence no ultimo dia util do mes seguinte (Lei 9.430/96 art. 5o).
        { obrigacao: 'IRPJ_TRIM',  diaVencimento: 0, mesesApos: 1, label: 'IRPJ Trimestral', frequencia: 'trimestral', ultimoDiaUtilDoMes: true },
        { obrigacao: 'CSLL_TRIM',  diaVencimento: 0, mesesApos: 1, label: 'CSLL Trimestral', frequencia: 'trimestral', ultimoDiaUtilDoMes: true },
        // Anuais
        { obrigacao: 'ECF',        diaVencimento: 31, mesesApos: 7, label: 'ECF', frequencia: 'anual', ultimoDiaUtilDoMes: true },
        { obrigacao: 'ECD',        diaVencimento: 30, mesesApos: 6, label: 'ECD', frequencia: 'anual', ultimoDiaUtilDoMes: true },
    ],
    LUCRO_REAL: [
        { obrigacao: 'DCTFWEB',    diaVencimento: 15, mesesApos: 1, label: 'DCTFWeb', frequencia: 'mensal' },
        { obrigacao: 'FGTS',       diaVencimento: 20, mesesApos: 1, label: 'FGTS Digital', frequencia: 'mensal' },
        { obrigacao: 'INSS_CPP',   diaVencimento: 20, mesesApos: 1, label: 'INSS Patronal', frequencia: 'mensal' },
        { obrigacao: 'PIS_COFINS', diaVencimento: 25, mesesApos: 1, label: 'PIS/COFINS', frequencia: 'mensal' },
        { obrigacao: 'EFD_CONTRIB',diaVencimento: 14, mesesApos: 2, label: 'EFD-Contribuicoes', frequencia: 'mensal' },
        { obrigacao: 'SPED',       diaVencimento: 25, mesesApos: 2, label: 'SPED Fiscal', frequencia: 'mensal' },
        { obrigacao: 'IRPJ_TRIM',  diaVencimento: 0, mesesApos: 1, label: 'IRPJ Trimestral', frequencia: 'trimestral', ultimoDiaUtilDoMes: true },
        { obrigacao: 'CSLL_TRIM',  diaVencimento: 0, mesesApos: 1, label: 'CSLL Trimestral', frequencia: 'trimestral', ultimoDiaUtilDoMes: true },
        { obrigacao: 'ECF',        diaVencimento: 31, mesesApos: 7, label: 'ECF', frequencia: 'anual', ultimoDiaUtilDoMes: true },
        { obrigacao: 'ECD',        diaVencimento: 30, mesesApos: 6, label: 'ECD', frequencia: 'anual', ultimoDiaUtilDoMes: true },
    ],
};

/**
 * Calcula a data de vencimento real de uma obrigacao para uma competencia.
 * Se cair em fim de semana ou feriado nacional, PRORROGA para proximo dia util.
 *
 * Suporta `ultimoDiaUtilDoMes`: pula `diaVencimento` e calcula o ultimo dia
 * util do mes-alvo (mes da competencia + mesesApos). Usado em IRPJ/CSLL
 * trimestrais e em ECF/ECD/DEFIS anuais.
 *
 * @param competencia string MM/AAAA (ex: "04/2026")
 * @param regra regra do calendario
 * @returns Date com horario 00:00:00 local
 */
export function calcularVencimento(competencia: string, regra: RegraObrigacao): Date {
    const [mesStr, anoStr] = competencia.split('/');
    const mes = parseInt(mesStr || '', 10);   // 1..12
    const ano = parseInt(anoStr || '', 10);
    if (isNaN(mes) || isNaN(ano)) {
        throw new Error(`competencia invalida: "${competencia}"`);
    }

    // mes-alvo (1..12) e ano-alvo, ajustado por mesesApos com transbordo
    const mesAjustado = mes - 1 + regra.mesesApos;   // 0..23+ (base 0)
    const anoAlvo = ano + Math.floor(mesAjustado / 12);
    const mesAlvo = mesAjustado % 12;                 // 0..11

    let dataBase: Date;
    if (regra.ultimoDiaUtilDoMes) {
        // Ultimo dia do mes = dia 0 do mes seguinte
        dataBase = new Date(anoAlvo, mesAlvo + 1, 0);
        // Recua ate dia util — prorrogar daria mes seguinte (errado).
        while (!ehDiaUtil(dataBase)) {
            dataBase.setDate(dataBase.getDate() - 1);
        }
        return dataBase;
    }
    dataBase = new Date(anoAlvo, mesAlvo, regra.diaVencimento);
    return prorrogarParaDiaUtil(dataBase);
}

/**
 * Verifica se uma competencia (MM/AAAA) fecha um trimestre.
 * Trimestres: 1T=03, 2T=06, 3T=09, 4T=12.
 */
export function competenciaFechaTrimestre(competencia: string): boolean {
    const mes = parseInt(competencia.split('/')[0] || '', 10);
    return mes === 3 || mes === 6 || mes === 9 || mes === 12;
}

/**
 * Verifica se uma competencia fecha o ano (mes 12). Usado pelo cron mensal
 * pra decidir disparo de obrigacoes anuais (ECF, ECD, DEFIS).
 */
export function competenciaFechaAno(competencia: string): boolean {
    return parseInt(competencia.split('/')[0] || '', 10) === 12;
}

/**
 * Filtra as obrigacoes do regime aplicaveis a uma competencia.
 * - 'mensal'      -> todo mes
 * - 'trimestral'  -> mar/jun/set/dez
 * - 'anual'       -> dezembro (ano-base)
 */
export function obrigacoesAplicaveis(
    regime: RegimeSugerido | null | undefined,
    competencia: string,
): RegraObrigacao[] {
    if (!regime) return [];
    const todas = OBRIGACOES_POR_REGIME[regime] || [];
    return todas.filter(r => {
        const f = r.frequencia ?? 'mensal';
        if (f === 'mensal') return true;
        if (f === 'trimestral') return competenciaFechaTrimestre(competencia);
        if (f === 'anual') return competenciaFechaAno(competencia);
        return false;
    });
}

/**
 * Retorna TODAS as obrigacoes do regime (sem filtrar por competencia).
 * Mantido para compat com codigo existente.
 */
export function obrigacoesDoRegime(regime: RegimeSugerido | null | undefined): RegraObrigacao[] {
    if (!regime) return [];
    return OBRIGACOES_POR_REGIME[regime] || [];
}
