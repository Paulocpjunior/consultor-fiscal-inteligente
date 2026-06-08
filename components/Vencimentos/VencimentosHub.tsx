/**
 * VencimentosHub — funde num só lugar TUDO sobre vencimentos/prazos, que antes
 * vivia espalhado em 3 abas-raiz com a mesma função:
 *   - Obrigações & Tarefas
 *   - Minha Agenda Fiscal
 *   - Vencimentos da Semana
 *
 * Motivação (Paulo): as três são do mesmo grupo (vencimentos) e devem mostrar,
 * de forma unificada, os vencimentos de obrigações + impostos derivados da
 * TRIBUTAÇÃO e CADASTRO de cada empresa. O motor que deriva isso já existe
 * (services/calendarioFiscal.ts: OBRIGACOES_POR_REGIME + calcularVencimento;
 * o cron cria as tarefas automáticas por regime). Aqui só damos UMA porta.
 *
 * Sub-abas (todas leem dados derivados do regime — nenhuma é lista fixa):
 *   ⏰ Próximos   → o que vence agora, por urgência (atrasada/hoje/7d)
 *   🏢 Por Empresa → score + gaps (PGDAS/DCTFWeb/e-CAC) por empresa
 *   📋 Tarefas     → Kanban operacional (auto + manuais)
 *   📅 Calendário  → timeline mensal de vencimentos
 *
 * Removido de propósito: o antigo FiscalObligationsDashboard (lista fixa de
 * ~25 obrigações que ignorava o regime da empresa — fonte de confusão).
 */
import React, { lazy, Suspense, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import ErrorBoundary from '../ErrorBoundary';
import type { User } from '../../types';

const VencimentosSemanaPanel = lazy(() => import('./VencimentosSemanaPanel'));
const MinhaAgendaPanel = lazy(() => import('../MinhaAgenda/MinhaAgendaPanel'));
const Tarefas = lazy(() => import('../Tarefas'));
const CalendarioFiscal = lazy(() => import('../CalendarioFiscal'));

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

type SubTab = 'proximos' | 'empresa' | 'tarefas' | 'calendario';

const SUBTABS: Array<{ id: SubTab; label: string }> = [
    { id: 'proximos', label: '⏰ Próximos Vencimentos' },
    { id: 'empresa', label: '🏢 Por Empresa' },
    { id: 'tarefas', label: '📋 Tarefas (Kanban)' },
    { id: 'calendario', label: '📅 Calendário' },
];

const VencimentosHub: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [sub, setSub] = useState<SubTab>('proximos');

    return (
        <div className="space-y-4 animate-fade-in">
            <div className="flex gap-1 overflow-x-auto p-1 rounded-lg" style={{ background: 'var(--bg-card)' }}>
                {SUBTABS.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setSub(t.id)}
                        className="px-3 py-1.5 text-xs font-bold whitespace-nowrap rounded-md transition-colors"
                        style={{
                            background: sub === t.id ? 'var(--accent)' : 'transparent',
                            color: sub === t.id ? '#fff' : 'var(--text-muted)',
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner />}>
                    {sub === 'proximos' && <VencimentosSemanaPanel onShowToast={onShowToast} />}
                    {sub === 'empresa' && <MinhaAgendaPanel onShowToast={onShowToast} />}
                    {sub === 'tarefas' && <Tarefas currentUser={currentUser} />}
                    {sub === 'calendario' && (
                        <CalendarioFiscal currentUser={currentUser} onShowToast={onShowToast || (() => {})} />
                    )}
                </Suspense>
            </ErrorBoundary>
        </div>
    );
};

export default VencimentosHub;
