/**
 * components/Tarefas/_common.ts
 *
 * Constantes compartilhadas entre Tarefas.tsx (lista + filtros) e seus
 * sub-componentes (ColunaKanban, CardKanban, ModalMover, etc).
 */
import type { StatusTarefa, ObrigacaoTarefa } from '../../services/tarefasService';

export const STATUS_LABEL: Record<StatusTarefa, string> = {
    a_fazer: 'A Fazer',
    em_andamento: 'Em Andamento',
    concluida: 'Concluída',
    cancelada: 'Cancelada',
};

export const STATUS_COR: Record<StatusTarefa, string> = {
    a_fazer:      'bg-gray-100  text-gray-800  dark:bg-gray-700/40  dark:text-gray-200',
    em_andamento: 'bg-blue-100  text-blue-800  dark:bg-blue-900/40  dark:text-blue-200',
    concluida:    'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    cancelada:    'bg-red-100   text-red-800   dark:bg-red-900/40   dark:text-red-200',
};

export const OBRIGACAO_LABEL: Record<ObrigacaoTarefa, string> = {
    DAS: 'DAS',
    DCTFWEB: 'DCTFWeb',
    FGTS: 'FGTS Digital',
    SPED: 'SPED Fiscal',
    INSS_CPP: 'INSS Patronal',
    PIS_COFINS: 'PIS/COFINS',
    EFD_CONTRIB: 'EFD-Contribuicoes',
    IRPJ_TRIM: 'IRPJ Trimestral',
    CSLL_TRIM: 'CSLL Trimestral',
    DEFIS: 'DEFIS',
    ECF: 'ECF',
    ECD: 'ECD',
    OUTRA: 'Outra',
};

export const OBRIGACAO_COR: Record<string, string> = {
    DAS: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
    DCTFWEB: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
    FGTS: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    SPED: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
    OUTRA: 'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300',
};
