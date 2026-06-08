/**
 * components/Tarefas/KanbanColuna.tsx
 *
 * Coluna do Kanban (A Fazer / Em Andamento / Concluida) + Card de tarefa
 * embutido. Drag-and-drop via HTML5 (drop area aceita drag de outras
 * colunas e marca dragOver visual). Cada card tem acoes compactas:
 * mover (modal mobile), reatribuir, pegar pra mim, excluir.
 */
import React, { useState } from 'react';
import type { Tarefa } from '../../services/tarefasService';
import { OBRIGACAO_LABEL, OBRIGACAO_COR } from './_common';

type Coluna = 'a_fazer' | 'em_andamento' | 'concluida';

const COLUNA_VISUAL: Record<Coluna, { titulo: string; icone: string; cor: string }> = {
    a_fazer:      { titulo: 'A Fazer',       icone: '⚪', cor: 'border-gray-300 dark:border-gray-600' },
    em_andamento: { titulo: 'Em Andamento',  icone: '🔵', cor: 'border-blue-300 dark:border-blue-700' },
    concluida:    { titulo: 'Concluída',     icone: '✅', cor: 'border-green-300 dark:border-green-700' },
};

interface KanbanColunaProps {
    coluna: Coluna;
    tarefas: Tarefa[];
    arrastando: Tarefa | null;
    atualizandoStatus: string | null;
    formataData: (d: Date | undefined) => string;
    tarefaAtrasada: (t: Tarefa) => boolean;
    onDragStart: (t: Tarefa) => void;
    onDragEnd: () => void;
    onDrop: (t: Tarefa) => void;
    onMover: (t: Tarefa) => void;
    onReatribuir: (t: Tarefa) => void;
    onPegarPraMim: (t: Tarefa) => void;
    onExcluir: (t: Tarefa) => void;
    myUid: string | null;
    isAdmin: boolean;
}

const KanbanColuna: React.FC<KanbanColunaProps> = ({
    coluna, tarefas, arrastando, atualizandoStatus,
    formataData, tarefaAtrasada,
    onDragStart, onDragEnd, onDrop, onMover, onReatribuir, onPegarPraMim, onExcluir,
    myUid, isAdmin,
}) => {
    const [dragOver, setDragOver] = useState(false);
    const visual = COLUNA_VISUAL[coluna];
    const podeDropar = arrastando && arrastando.status !== coluna;

    return (
        <div
            onDragOver={(e) => { if (podeDropar) { e.preventDefault(); setDragOver(true); } }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (arrastando && arrastando.status !== coluna) onDrop(arrastando);
            }}
            className={`bg-gray-50 dark:bg-gray-900/40 rounded-2xl border-2 ${
                dragOver ? 'border-teal-400 dark:border-teal-500 bg-teal-50/40 dark:bg-teal-900/10' : visual.cor
            } transition-colors flex flex-col min-h-[300px] max-h-[80vh]`}
        >
            <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-gray-50 dark:bg-gray-900/60 rounded-t-2xl z-10">
                <div className="flex items-center gap-2 font-semibold text-sm text-gray-800 dark:text-gray-100">
                    <span>{visual.icone}</span>
                    <span>{visual.titulo}</span>
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 px-2 py-0.5 rounded-full font-mono">
                    {tarefas.length}
                </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {tarefas.length === 0 ? (
                    <div className="text-center text-xs text-gray-400 dark:text-gray-500 py-8 italic">
                        {dragOver ? 'Solte aqui' : 'Sem tarefas'}
                    </div>
                ) : (
                    tarefas.map(t => (
                        <CardKanban
                            key={t.id}
                            tarefa={t}
                            atualizando={atualizandoStatus === t.id}
                            formataData={formataData}
                            atrasada={tarefaAtrasada(t)}
                            onDragStart={() => onDragStart(t)}
                            onDragEnd={onDragEnd}
                            onMover={() => onMover(t)}
                            onReatribuir={() => onReatribuir(t)}
                            onPegarPraMim={() => onPegarPraMim(t)}
                            onExcluir={() => onExcluir(t)}
                            myUid={myUid}
                            isAdmin={isAdmin}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

// ─── Card de tarefa (interno da coluna) ───────────────────────────────────

interface CardKanbanProps {
    tarefa: Tarefa;
    atualizando: boolean;
    atrasada: boolean;
    formataData: (d: Date | undefined) => string;
    onDragStart: () => void;
    onDragEnd: () => void;
    onMover: () => void;
    onReatribuir: () => void;
    onPegarPraMim: () => void;
    onExcluir: () => void;
    myUid: string | null;
    isAdmin: boolean;
}

const CardKanban: React.FC<CardKanbanProps> = ({
    tarefa, atualizando, atrasada, formataData,
    onDragStart, onDragEnd, onMover, onReatribuir, onPegarPraMim, onExcluir,
    myUid, isAdmin,
}) => {
    const semDono = !tarefa.responsavel;
    const minhaTarefa = tarefa.responsavel === myUid;
    return (
        <div
            draggable
            onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                onDragStart();
            }}
            onDragEnd={onDragEnd}
            className={`bg-white dark:bg-gray-800 rounded-lg p-2.5 shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md cursor-grab active:cursor-grabbing transition-all ${
                atualizando ? 'opacity-50' : ''
            } ${atrasada ? 'border-l-4 border-l-red-500 dark:border-l-red-400' : ''}`}
        >
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                {tarefa.obrigacao && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${OBRIGACAO_COR[tarefa.obrigacao] || OBRIGACAO_COR.OUTRA}`}>
                        {OBRIGACAO_LABEL[tarefa.obrigacao] || tarefa.obrigacao}
                    </span>
                )}
                {tarefa.competencia && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">
                        {tarefa.competencia}
                    </span>
                )}
            </div>

            <div className="text-xs text-gray-600 dark:text-gray-400 mb-1 truncate" title={tarefa.empresaNome}>
                {tarefa.empresaNome || '—'}
            </div>

            <div className="text-sm font-medium text-gray-800 dark:text-gray-100 mb-2 line-clamp-2" title={tarefa.titulo}>
                {tarefa.titulo}
            </div>

            <div className="flex items-center justify-between gap-2 mb-2">
                <div className={`text-[11px] ${atrasada ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-500 dark:text-gray-400'}`}>
                    📅 {formataData(tarefa.vencimento)}
                    {atrasada && ' (atrasada)'}
                </div>
            </div>

            <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-gray-600 dark:text-gray-400 truncate" title={tarefa.responsavelNome || ''}>
                    {semDono ? (
                        <span className="text-amber-700 dark:text-amber-400 italic">sem dono</span>
                    ) : (
                        <>👤 {tarefa.responsavelNome || tarefa.responsavel}</>
                    )}
                </div>

                <div className="flex items-center gap-1">
                    <button onClick={onMover} className="text-[11px] text-gray-500 hover:text-teal-600 dark:hover:text-teal-400 p-0.5" title="Mover para outra coluna">➡️</button>
                    {semDono && myUid && (
                        <button onClick={onPegarPraMim} className="text-[11px] text-amber-600 hover:text-amber-800 dark:hover:text-amber-400 p-0.5" title="Pegar pra mim">✋</button>
                    )}
                    {(isAdmin || minhaTarefa) && (
                        <button onClick={onReatribuir} className="text-[11px] text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 p-0.5" title="Reatribuir">🔄</button>
                    )}
                    {isAdmin && (
                        <button onClick={onExcluir} className="text-[11px] text-gray-500 hover:text-red-600 dark:hover:text-red-400 p-0.5" title="Excluir">🗑️</button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default KanbanColuna;
