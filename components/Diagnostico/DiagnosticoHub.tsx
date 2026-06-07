/**
 * DiagnosticoHub — funde num só lugar as 6 abas de diagnóstico que antes
 * viviam soltas no menu raiz (Saúde Geral, Docs Fiscais, Cadastros,
 * Certificados, Configurações, Anomalias). Mesmo padrão da Central de
 * Documentos: 1 card no menu → sub-abas internas.
 *
 * Motivação (Paulo): as abas de diagnóstico tinham praticamente a mesma
 * função e poluíam o grid raiz. Aglutinadas por gênero, o layout respira.
 *
 * A Saúde Geral é a landing (rollup); o drill-down "Ver detalhes →" dela
 * agora troca a SUB-ABA interna em vez de navegar no menu raiz.
 */
import React, { lazy, Suspense, useState } from 'react';
import type { User } from '../../types';
import { SearchType } from '../../types';

const SaudeGeralPanel = lazy(() => import('../Saude/SaudeGeralPanel'));
const DiagnosticoDocsFiscaisPanel = lazy(() => import('./DocsFiscaisPanel'));
const CadastrosPanel = lazy(() => import('./CadastrosPanel'));
const CertMonitorPanel = lazy(() => import('../CertMonitor/CertMonitorPanel'));
const ConfigPanel = lazy(() => import('./ConfigPanel'));
const AnomaliasView = lazy(() => import('../Anomalias'));

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

type SubTab = 'saude' | 'docs' | 'cadastros' | 'certificados' | 'config' | 'anomalias';

const SUBTABS: Array<{ id: SubTab; label: string }> = [
    { id: 'saude', label: '🩺 Saúde Geral' },
    { id: 'docs', label: '📄 Docs Fiscais' },
    { id: 'cadastros', label: '📋 Cadastros Incompletos' },
    { id: 'certificados', label: '🔐 Certificados Digitais' },
    { id: 'config', label: '⚙ Configurações Operacionais' },
    { id: 'anomalias', label: '🚨 Detector de Anomalias' },
];

// Mapeia o destino do drill-down da Saúde Geral (que usa SearchType) pra
// sub-aba interna. Sem isso o "Ver detalhes →" não teria pra onde ir agora
// que as abas viraram internas.
const SEARCHTYPE_TO_SUBTAB: Partial<Record<SearchType, SubTab>> = {
    [SearchType.DIAGNOSTICO_DOCS]: 'docs',
    [SearchType.DIAGNOSTICO_CADASTROS]: 'cadastros',
    [SearchType.CERT_MONITOR]: 'certificados',
    [SearchType.DIAGNOSTICO_CONFIG]: 'config',
    [SearchType.SAUDE_GERAL]: 'saude',
    [SearchType.ANOMALIAS]: 'anomalias',
};

const DiagnosticoHub: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [sub, setSub] = useState<SubTab>('saude');

    const irPara = (destino: SearchType) => {
        const alvo = SEARCHTYPE_TO_SUBTAB[destino];
        if (alvo) {
            setSub(alvo);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    return (
        <div className="space-y-4 animate-fade-in">
            {/* Sub-navegação interna */}
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

            <Suspense fallback={<p className="text-center text-xs py-6" style={{ color: 'var(--text-muted)' }}>Carregando…</p>}>
                {sub === 'saude' && <SaudeGeralPanel onShowToast={onShowToast} onNavegar={irPara} />}
                {sub === 'docs' && <DiagnosticoDocsFiscaisPanel onShowToast={onShowToast} />}
                {sub === 'cadastros' && <CadastrosPanel onShowToast={onShowToast} />}
                {sub === 'certificados' && <CertMonitorPanel onShowToast={onShowToast} />}
                {sub === 'config' && <ConfigPanel onShowToast={onShowToast} />}
                {sub === 'anomalias' && <AnomaliasView currentUser={currentUser ?? null} onShowToast={onShowToast} />}
            </Suspense>
        </div>
    );
};

export default DiagnosticoHub;
