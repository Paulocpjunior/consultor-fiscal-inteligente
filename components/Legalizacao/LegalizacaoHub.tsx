/**
 * LegalizacaoHub — app do departamento de Legalização num só card:
 *   - Painel: farol de vencimentos (certificados, certidões, parcelamentos,
 *     procurações) alimentado pelo sync dos formulários Jotform.
 *   - Vencimentos: lista completa com filtros por categoria/farol/busca.
 *   - Processos: aberturas, alterações contratuais, encerramentos, contratos,
 *     cadastros, permissões especiais, regularizações (CRUD da equipe).
 *   - Integração: status Jotform/Graph + disparo manual do sync (admin).
 *
 * Mesmo padrão do DctfwebHub (sub-abas internas, painéis lazy).
 */
import React, { lazy, Suspense, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import ErrorBoundary from '../ErrorBoundary';
import type { User } from '../../types';

const PainelPanel = lazy(() => import('./PainelPanel'));
const VencimentosPanel = lazy(() => import('./VencimentosPanel'));
const ProcessosPanel = lazy(() => import('./ProcessosPanel'));
const ConfigPanel = lazy(() => import('./ConfigPanel'));

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

type SubTab = 'painel' | 'vencimentos' | 'processos' | 'config';

const SUBTABS: Array<{ id: SubTab; label: string; adminOnly?: boolean }> = [
    { id: 'painel', label: '📊 Painel' },
    { id: 'vencimentos', label: '📅 Vencimentos' },
    { id: 'processos', label: '🗂️ Processos' },
    { id: 'config', label: '🔗 Integração Jotform', adminOnly: true },
];

const LegalizacaoHub: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [sub, setSub] = useState<SubTab>('painel');
    const abas = SUBTABS.filter(t => !t.adminOnly || currentUser.role === 'admin');

    return (
        <div className="space-y-4 animate-fade-in">
            <div className="flex gap-1 overflow-x-auto p-1 rounded-lg" style={{ background: 'var(--bg-card)' }}>
                {abas.map(t => (
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
                    {sub === 'painel' && <PainelPanel currentUser={currentUser} onShowToast={onShowToast} />}
                    {sub === 'vencimentos' && <VencimentosPanel currentUser={currentUser} onShowToast={onShowToast} />}
                    {sub === 'processos' && <ProcessosPanel currentUser={currentUser} onShowToast={onShowToast} />}
                    {sub === 'config' && <ConfigPanel currentUser={currentUser} onShowToast={onShowToast} />}
                </Suspense>
            </ErrorBoundary>
        </div>
    );
};

export default LegalizacaoHub;
