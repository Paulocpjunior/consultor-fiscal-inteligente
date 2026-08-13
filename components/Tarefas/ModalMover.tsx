/**
 * components/Tarefas/ModalMover.tsx
 *
 * Modal "Mover tarefa" -- fallback mobile pro drag-and-drop do Kanban.
 * Usuario escolhe entre a_fazer/em_andamento/concluida/cancelada (sem
 * permitir mover pra o status atual).
 */
import React from 'react';
import type { Tarefa, StatusTarefa } from '../../services/tarefasService';
import { STATUS_LABEL, STATUS_COR } from './_common';

interface Props {
    tarefa: Tarefa;
    onFechar: () => void;
    onMover: (novoStatus: StatusTarefa) => void;
}

const ModalMover: React.FC<Props> = ({ tarefa, onFechar, onMover }) => (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-[80] overflow-y-auto" onClick={onFechar}>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-sm w-full p-5 my-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-1">Mover tarefa</h3>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-3 truncate" title={tarefa.titulo}>
                {tarefa.titulo}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                De <span className="font-semibold">{STATUS_LABEL[tarefa.status]}</span> para:
            </div>
            <div className="space-y-2">
                {(['a_fazer', 'em_andamento', 'concluida', 'cancelada'] as StatusTarefa[]).map(s => {
                    const eAtual = s === tarefa.status;
                    return (
                        <button
                            key={s}
                            disabled={eAtual}
                            onClick={() => onMover(s)}
                            className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                                eAtual
                                    ? 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-800 dark:text-gray-200'
                            }`}
                        >
                            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COR[s]} mr-2`}>
                                {STATUS_LABEL[s]}
                            </span>
                            {eAtual && <span className="text-[10px] text-gray-400">(atual)</span>}
                        </button>
                    );
                })}
            </div>
            <div className="mt-4 flex justify-end">
                <button onClick={onFechar} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                    Cancelar
                </button>
            </div>
        </div>
    </div>
);

export default ModalMover;
