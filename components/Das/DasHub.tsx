/**
 * DasHub — funde num só card o gênero "DAS / Simples":
 *   - DAS Simples Nacional (painel de apuração/emissão)
 *   - Cobertura PGDAS-D (quais empresas têm PGDAS por competência)
 *   - Sublimite Simples (monitor do teto R$ 3,6M ICMS/ISS)
 *
 * Reusa os painéis existentes — sem mudança de lógica.
 */
import React, { lazy, Suspense, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import ErrorBoundary from '../ErrorBoundary';
import type { User } from '../../types';

const DasDashboard = lazy(() => import('./index'));
const CoberturaPgdasPanel = lazy(() => import('./CoberturaPgdasPanel'));
const SublimitePanel = lazy(() => import('../SimplesSublimite/SublimitePanel'));

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

type SubTab = 'painel' | 'cobertura' | 'sublimite';

const SUBTABS: Array<{ id: SubTab; label: string }> = [
    { id: 'painel', label: '📊 Painel DAS' },
    { id: 'cobertura', label: '🛡️ Cobertura PGDAS-D' },
    { id: 'sublimite', label: '📈 Sublimite' },
];

const DasHub: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [sub, setSub] = useState<SubTab>('painel');
    return (
        <div className="space-y-4 animate-fade-in">
            <div className="flex gap-1 overflow-x-auto p-1 rounded-lg" style={{ background: 'var(--bg-card)' }}>
                {SUBTABS.map(t => (
                    <button key={t.id} onClick={() => setSub(t.id)}
                        className="px-3 py-1.5 text-xs font-bold whitespace-nowrap rounded-md transition-colors"
                        style={{ background: sub === t.id ? 'var(--accent)' : 'transparent', color: sub === t.id ? '#fff' : 'var(--text-muted)' }}>
                        {t.label}
                    </button>
                ))}
            </div>
            <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner />}>
                    {sub === 'painel' && <DasDashboard currentUser={currentUser} onShowToast={onShowToast} />}
                    {sub === 'cobertura' && <CoberturaPgdasPanel onShowToast={onShowToast} />}
                    {sub === 'sublimite' && <SublimitePanel onShowToast={onShowToast} />}
                </Suspense>
            </ErrorBoundary>
        </div>
    );
};

export default DasHub;
