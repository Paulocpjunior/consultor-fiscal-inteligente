/**
 * CaixaPostalHub — funde num só card o gênero "Caixa Postal / e-CAC":
 *   - Caixa Postal (mensagens da caixa postal e-CAC)
 *   - Radar fiscal (e-CAC) (radar de mensagens críticas)
 *
 * Mesma fonte (e-CAC), visões complementares. Reusa os painéis existentes.
 */
import React, { lazy, Suspense, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import ErrorBoundary from '../ErrorBoundary';
import type { User } from '../../types';

const CaixaPostalDashboard = lazy(() => import('./index'));
const RadarCriticasPanel = lazy(() => import('./RadarCriticasPanel'));

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

type SubTab = 'caixa' | 'radar';

const SUBTABS: Array<{ id: SubTab; label: string }> = [
    { id: 'caixa', label: '📬 Caixa Postal' },
    { id: 'radar', label: '📡 Radar fiscal (e-CAC)' },
];

const CaixaPostalHub: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [sub, setSub] = useState<SubTab>('caixa');
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
            <ErrorBoundary modulo="CaixaPostalHub">
                <Suspense fallback={<LoadingSpinner />}>
                    {sub === 'caixa' && <CaixaPostalDashboard currentUser={currentUser} onShowToast={onShowToast} />}
                    {sub === 'radar' && <RadarCriticasPanel onShowToast={onShowToast} />}
                </Suspense>
            </ErrorBoundary>
        </div>
    );
};

export default CaixaPostalHub;
