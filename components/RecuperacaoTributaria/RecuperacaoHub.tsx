/**
 * RecuperacaoHub — funde num só card o gênero "Recuperação":
 *   - Recuperação Tributária (créditos a recuperar)
 *   - Prazos de Prescrição (janela de 5 anos pra recuperar — CTN art. 168)
 *
 * São o mesmo grupo: o que dá pra recuperar e até quando. Reusa os painéis
 * existentes — sem mudança de lógica.
 */
import React, { lazy, Suspense, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import ErrorBoundary from '../ErrorBoundary';
import type { User } from '../../types';

const RecuperacaoTributaria = lazy(() => import('./index'));
const PrazosPrescricaoPanel = lazy(() => import('./PrazosPrescricaoPanel'));

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

type SubTab = 'recuperacao' | 'prazos';

const SUBTABS: Array<{ id: SubTab; label: string }> = [
    { id: 'recuperacao', label: '⚖️ Recuperação Tributária' },
    { id: 'prazos', label: '⏳ Prazos de Prescrição' },
];

const RecuperacaoHub: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [sub, setSub] = useState<SubTab>('recuperacao');
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
            <ErrorBoundary modulo="RecuperacaoHub">
                <Suspense fallback={<LoadingSpinner />}>
                    {sub === 'recuperacao' && <RecuperacaoTributaria currentUser={currentUser ?? null} onShowToast={onShowToast} />}
                    {sub === 'prazos' && <PrazosPrescricaoPanel onShowToast={onShowToast} />}
                </Suspense>
            </ErrorBoundary>
        </div>
    );
};

export default RecuperacaoHub;
