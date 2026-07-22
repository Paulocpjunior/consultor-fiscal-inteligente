/**
 * DctfwebHub — funde num só card tudo de DCTFWeb, que vivia em 3 abas-raiz
 * do mesmo gênero:
 *   - DCTFWeb (dashboard de transmissão/declaração)
 *   - EFD-Reinf × DCTFWeb (conferência cruzada)
 *   - Cobertura DCTFWeb (quais empresas têm DCTFWeb cobrindo cada competência)
 *
 * Motivação (Paulo): abas do mesmo grupo espalhadas confundem. Aglutinadas
 * em sub-abas, o colaborador acha tudo de DCTFWeb num lugar só.
 *
 * Reusa os painéis existentes — sem mudança de lógica.
 */
import React, { lazy, Suspense, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import ErrorBoundary from '../ErrorBoundary';
import type { User } from '../../types';

const DCTFWebDashboard = lazy(() => import('./index'));
const ConferirReinfDctfweb = lazy(() => import('../EfdReinf/ConferirReinfDctfweb'));
const CoberturaDctfwebPanel = lazy(() => import('./CoberturaDctfwebPanel'));
const TrimestraisDoMesPanel = lazy(() => import('./TrimestraisDoMesPanel'));
const IpiVarreduraPanel = lazy(() => import('./IpiVarreduraPanel'));

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

type SubTab = 'painel' | 'trimestrais' | 'cobertura' | 'ipi' | 'reinf';

const SUBTABS: Array<{ id: SubTab; label: string }> = [
    { id: 'painel', label: '📊 Painel DCTFWeb' },
    { id: 'trimestrais', label: '📅 Trimestrais do mês' },
    { id: 'cobertura', label: '🛡️ Cobertura' },
    { id: 'ipi', label: '🏭 Varredura IPI' },
    { id: 'reinf', label: '🔀 EFD-Reinf × DCTFWeb' },
];

const DctfwebHub: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [sub, setSub] = useState<SubTab>('painel');

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
                    {sub === 'painel' && <DCTFWebDashboard currentUser={currentUser} onShowToast={onShowToast} />}
                    {sub === 'trimestrais' && <TrimestraisDoMesPanel currentUser={currentUser} onShowToast={onShowToast} />}
                    {sub === 'cobertura' && <CoberturaDctfwebPanel onShowToast={onShowToast} />}
                    {sub === 'ipi' && <IpiVarreduraPanel onShowToast={onShowToast} />}
                    {sub === 'reinf' && <ConferirReinfDctfweb onShowToast={onShowToast} />}
                </Suspense>
            </ErrorBoundary>
        </div>
    );
};

export default DctfwebHub;
