/**
 * calendarioFiscal — PORTA do catálogo único para o front.
 *
 * ATENÇÃO: este arquivo NÃO tem mais catálogo próprio. Ele era a 2ª de TRÊS
 * listas de obrigação por regime que não concordavam entre si — e o comentário
 * do backend jurava que a dele era "o mesmo mapa, mantido em sync manual".
 * Não era: o cron que CRIA as tarefas do mês não conhecia Lucro Presumido, e
 * por isso PIS/COFINS, EFD-Contribuições e IRPJ/CSLL trimestral nunca viravam
 * tarefa, nunca apareciam em Vencimentos e nunca chegavam ao Guia do mês.
 *
 * A fonte agora é `sefaz-backend/catalogo-obrigacoes.js` (puro, testado), e o
 * front importa DELE — mesmo padrão de `urgencia-vencimento.js`. Regra do
 * escopo do mês fiscal: UM catálogo só. Não recriar lista aqui.
 *
 * O que este arquivo ainda faz: preservar a API que as telas já usam
 * (`OBRIGACOES_POR_REGIME`, `calcularVencimento`, `obrigacoesAplicaveis`,
 * `obrigacoesDoRegime`) e os tipos TS.
 */

import type { RegimeSugerido } from './xmlFiscalService';
import {
    CATALOGO,
    calcularVencimento as calcularVencimentoNucleo,
    obrigacoesAplicaveis as obrigacoesAplicaveisNucleo,
    competenciaFechaTrimestre as competenciaFechaTrimestreNucleo,
    competenciaFechaAno as competenciaFechaAnoNucleo,
} from '../sefaz-backend/catalogo-obrigacoes.js';

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
    mesesApos: number;
    label: string;
    frequencia?: 'mensal' | 'trimestral' | 'anual';
    ultimoDiaUtilDoMes?: boolean;
    /**
     * Direção do ajuste quando o vencimento cai em dia não útil.
     * 'prorroga' = próximo dia útil · 'antecipa' = dia útil anterior.
     * ISTO NÃO É DETALHE: as duas listas antigas ajustavam em direções OPOSTAS,
     * então a mesma obrigação tinha datas diferentes na tarefa e na tela.
     */
    ajusteDiaNaoUtil?: 'prorroga' | 'antecipa';
    /** 'ativa' gera tarefa; 'proposta' depende de condição que o app não avalia. */
    status?: 'ativa' | 'proposta';
    dependeDe?: string;
    baseLegal?: string;
}

/**
 * Obrigações por regime — do catálogo único.
 * Inclui LUCRO_PRESUMIDO, que é o que o cron não tinha.
 */
export const OBRIGACOES_POR_REGIME: Record<string, RegraObrigacao[]> =
    CATALOGO as unknown as Record<string, RegraObrigacao[]>;

/**
 * Data de vencimento real de uma obrigação numa competência (MM/AAAA).
 * O ajuste de dia não útil segue a DIREÇÃO declarada pela obrigação.
 */
export function calcularVencimento(competencia: string, regra: RegraObrigacao): Date {
    return calcularVencimentoNucleo(competencia, regra);
}

export function competenciaFechaTrimestre(competencia: string): boolean {
    return competenciaFechaTrimestreNucleo(competencia);
}

export function competenciaFechaAno(competencia: string): boolean {
    return competenciaFechaAnoNucleo(competencia);
}

/**
 * Obrigações do regime aplicáveis à competência.
 *
 * `incluirPropostas` (default false) — as telas passam `true` pra MOSTRAR o que
 * depende de condição não avaliável (ex.: INSS patronal, que exige folha) em vez
 * de escondê-lo; a geração automática usa o default, porque criar tarefa que não
 * se aplica produz "atrasada" falsa todo mês.
 */
export function obrigacoesAplicaveis(
    regime: RegimeSugerido | null | undefined,
    competencia: string,
    opts?: { incluirPropostas?: boolean },
): RegraObrigacao[] {
    if (!regime) return [];
    return obrigacoesAplicaveisNucleo(regime, competencia, opts || {}) as RegraObrigacao[];
}

/**
 * TODAS as obrigações do regime (sem filtrar por competência).
 * Mantido para compat com código existente.
 */
export function obrigacoesDoRegime(regime: RegimeSugerido | null | undefined): RegraObrigacao[] {
    if (!regime) return [];
    return (OBRIGACOES_POR_REGIME[regime] || []) as RegraObrigacao[];
}
