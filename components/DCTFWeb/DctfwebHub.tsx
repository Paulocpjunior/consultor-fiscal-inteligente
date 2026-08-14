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
const FechamentoReinfPanel = lazy(() => import('../EfdReinf/FechamentoReinfPanel'));
const QuotasDoMesPanel = lazy(() => import('./QuotasDoMesPanel'));
const ServicosTomadosPanel = lazy(() => import('../EfdReinf/ServicosTomadosPanel'));

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

type SubTab = 'painel' | 'trimestrais' | 'quotas' | 'cobertura' | 'ipi' | 'reinf' | 'servicos-tomados' | 'fechamento';

const SUBTABS: Array<{ id: SubTab; label: string }> = [
    { id: 'painel', label: '📊 Painel DCTFWeb' },
    { id: 'trimestrais', label: '📅 Trimestrais do mês' },
    { id: 'quotas', label: '🧮 Cotas do mês' },
    { id: 'cobertura', label: '🛡️ Cobertura' },
    { id: 'ipi', label: '🏭 Varredura IPI' },
    { id: 'reinf', label: '🔀 EFD-Reinf × DCTFWeb' },
    { id: 'servicos-tomados', label: '🧰 R-2010 serviços tomados' },
    { id: 'fechamento', label: '🧾 Fechamento EFD-Reinf' },
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

            {/* A DCTFWeb é UMA declaração do CNPJ e TRÊS departamentos a
                alimentam — é aqui que a ordem morde, então o manual fica na
                porta. Sem ele, "transmitir para conseguir a guia" continua
                parecendo razoável (e fecha a competência dos outros dois). */}
            <div className="flex items-center justify-between gap-2 flex-wrap rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/20 px-3 py-2">
                <p className="text-[11px] text-sky-900 dark:text-sky-200">
                    <strong>Guia sai sem transmitir.</strong> Transmitir FECHA a competência para o Contábil e o
                    Pessoal — só o Fiscal transmite, e só depois de encerrar o MIT.
                </p>
                <a
                    href="/guia-ordem-do-mes.html"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 font-semibold hover:bg-sky-100 dark:hover:bg-slate-700 whitespace-nowrap"
                >
                    📘 Manual do mês
                </a>
            </div>

            <ErrorBoundary modulo="DctfwebHub">
                <Suspense fallback={<LoadingSpinner />}>
                    {sub === 'painel' && <DCTFWebDashboard currentUser={currentUser} onShowToast={onShowToast} />}
                    {sub === 'trimestrais' && <TrimestraisDoMesPanel currentUser={currentUser} onShowToast={onShowToast} />}
                    {sub === 'quotas' && <QuotasDoMesPanel currentUser={currentUser} onShowToast={onShowToast} />}
                    {sub === 'cobertura' && <CoberturaDctfwebPanel onShowToast={onShowToast} />}
                    {sub === 'ipi' && <IpiVarreduraPanel onShowToast={onShowToast} />}
                    {sub === 'reinf' && <ConferirReinfDctfweb onShowToast={onShowToast} />}
                    {sub === 'servicos-tomados' && <ServicosTomadosPanel onShowToast={onShowToast} />}
                    {sub === 'fechamento' && <FechamentoReinfPanel onShowToast={onShowToast} />}
                </Suspense>
            </ErrorBoundary>
        </div>
    );
};

export default DctfwebHub;
