/**
 * NfseNacionalHub — funde num só card o gênero "NFS-e Nacional":
 *   - NFS-e Nacional (painel de emissão/captura ADN)
 *   - Cobertura ADN (quais empresas têm NFS-e Nacional ativa por competência)
 *
 * Reusa os painéis existentes — sem mudança de lógica.
 */
import React, { lazy, Suspense, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import ErrorBoundary from '../ErrorBoundary';
import type { User } from '../../types';

const NfseNacionalDashboard = lazy(() => import('./index'));
const CoberturaAdnPanel = lazy(() => import('./CoberturaAdnPanel'));

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

type SubTab = 'painel' | 'cobertura';

const SUBTABS: Array<{ id: SubTab; label: string }> = [
    { id: 'painel', label: '📊 Painel NFS-e Nacional' },
    { id: 'cobertura', label: '🛡️ Cobertura ADN' },
];

const NfseNacionalHub: React.FC<Props> = ({ currentUser, onShowToast }) => {
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
                    {sub === 'painel' && <NfseNacionalDashboard currentUser={currentUser} onShowToast={onShowToast} />}
                    {sub === 'cobertura' && <CoberturaAdnPanel onShowToast={onShowToast} />}
                </Suspense>
            </ErrorBoundary>
        </div>
    );
};

export default NfseNacionalHub;
