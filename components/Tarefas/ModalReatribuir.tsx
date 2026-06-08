/**
 * components/Tarefas/ModalReatribuir.tsx
 *
 * Modal de reatribuicao de tarefa a outro colaborador (ou remover dono).
 * Recebe os colaboradores da carteira; clique escolhe quem vira responsavel.
 */
import React from 'react';
import type { Tarefa } from '../../services/tarefasService';

interface Props {
    tarefa: Tarefa;
    colaboradores: { uid: string; nome: string }[];
    onFechar: () => void;
    onAtribuir: (uid: string | null, nome: string | null) => void;
}

const ModalReatribuir: React.FC<Props> = ({ tarefa, colaboradores, onFechar, onAtribuir }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100">Reatribuir tarefa</h3>
                <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-2">
                <p className="text-xs text-gray-500">{tarefa.titulo} · {tarefa.empresaNome}</p>
                <button onClick={() => onAtribuir(null, null)}
                    className="w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-50 dark:hover:bg-gray-700">
                    ⬜ Remover responsável (sem dono)
                </button>
                {colaboradores.length === 0 && (
                    <p className="text-xs text-gray-400 italic px-3">Nenhum colaborador na carteira.</p>
                )}
                {colaboradores.map(c => (
                    <button key={c.uid} onClick={() => onAtribuir(c.uid, c.nome)}
                        className="w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-50 dark:hover:bg-gray-700">
                        👤 {c.nome}
                    </button>
                ))}
            </div>
        </div>
    </div>
);

export default ModalReatribuir;
