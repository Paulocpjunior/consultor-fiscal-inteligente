/**
 * components/ObrigacoesETarefas.tsx
 *
 * Wrapper que unifica 3 visualizações das obrigações fiscais num único menu:
 *   - Dashboard (agregado executivo)  ← padrão
 *   - Kanban (operacional do colaborador)
 *   - Calendário (timeline de vencimentos)
 *
 * Reaproveita os componentes existentes (FiscalObligationsDashboard,
 * Tarefas, CalendarioFiscal). Reduz a poluição do menu lateral.
 */
import React, { useState, lazy, Suspense } from 'react';
import LoadingSpinner from './LoadingSpinner';
import ErrorBoundary from './ErrorBoundary';
import type { User } from '../types';

const FiscalObligationsDashboard = lazy(() => import('./FiscalObligationsDashboard'));
const Tarefas = lazy(() => import('./Tarefas'));
const CalendarioFiscal = lazy(() => import('./CalendarioFiscal'));
// Farol do rito de envio (#293) — mora aqui porque é nesta tela que a BAIXA
// da obrigação acontece; o painel mostra quais envios não completaram o ciclo.
const EnviosImpostoPainel = lazy(() => import('./EnviosImpostoPainel'));

type Modo = 'dashboard' | 'kanban' | 'calendario' | 'envios';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const ABAS: { id: Modo; label: string; emoji: string }[] = [
    { id: 'dashboard', label: 'Dashboard', emoji: '📊' },
    { id: 'kanban', label: 'Kanban (Tarefas)', emoji: '📋' },
    { id: 'calendario', label: 'Calendário', emoji: '📅' },
    { id: 'envios', label: 'Envios (rito)', emoji: '📤' },
];

const ObrigacoesETarefas: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [modo, setModo] = useState<Modo>('dashboard');

    return (
        <div>
            <div className="flex gap-2 mb-4 border-b border-slate-200 dark:border-slate-700">
                {ABAS.map(a => (
                    <button
                        key={a.id}
                        onClick={() => setModo(a.id)}
                        className={`px-4 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px ${
                            modo === a.id
                                ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        {a.emoji} {a.label}
                    </button>
                ))}
            </div>

            <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner />}>
                    {modo === 'dashboard' && <FiscalObligationsDashboard />}
                    {modo === 'kanban' && <Tarefas currentUser={currentUser} />}
                    {modo === 'calendario' && (
                        <CalendarioFiscal currentUser={currentUser} onShowToast={onShowToast || (() => {})} />
                    )}
                    {modo === 'envios' && <EnviosImpostoPainel />}
                </Suspense>
            </ErrorBoundary>
        </div>
    );
};

export default ObrigacoesETarefas;
