import React, { useState } from 'react';
import type { User, DocumentoFiscal } from '../../types';
import { isFirebaseConfigured, isFirebaseStorageConfigured } from '../../services/firebaseConfig';
import XmlDashboard from './XmlDashboard';
import XmlImportacaoManual from './XmlImportacaoManual';
import NfsePdfImportacao from './NfsePdfImportacao';
import XmlDocumentosList from './XmlDocumentosList';
import XmlDocumentoDetalhe from './XmlDocumentoDetalhe';
import XmlEmpresasMonitoradas from './XmlEmpresasMonitoradas';
import XmlErros from './XmlErros';
import XmlRelatorios from './XmlRelatorios';
import XmlSharePoint from './XmlSharePoint';
import XmlConfiguracoes from './XmlConfiguracoes';

type TabId =
    | 'dashboard'
    | 'documentos'
    | 'importacao'
    | 'empresas'
    | 'sharepoint'
    | 'erros'
    | 'relatorios'
    | 'config'
    | 'nfse_pdf';

const TABS: Array<{ id: TabId; label: string }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'documentos', label: 'XMLs Capturados' },
    { id: 'importacao', label: 'Importação Manual' },
    { id: 'empresas', label: 'Empresas Monitoradas' },
    { id: 'sharepoint', label: 'SharePoint' },
    { id: 'erros', label: 'Erros & Logs' },
    { id: 'relatorios', label: 'Relatórios' },
    { id: 'nfse_pdf', label: 'Importar NFSe (PDF)' },
    { id: 'config', label: 'Configurações' },
];

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const CentralDocumentosFiscais: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [tab, setTab] = useState<TabId>('dashboard');
    const [refreshKey, setRefreshKey] = useState(0);
    const [selectedDoc, setSelectedDoc] = useState<DocumentoFiscal | null>(null);

    if (!currentUser) {
        return <p className="text-center text-xs text-slate-400 py-6">Faça login para acessar a Central de Documentos Fiscais.</p>;
    }

    if (!isFirebaseConfigured) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
                <h2 className="text-base font-bold text-red-700 dark:text-red-300 mb-2">Módulo bloqueado</h2>
                <p className="text-sm text-red-600 dark:text-red-400">
                    A Central de Documentos Fiscais exige Firebase configurado (Auth + Firestore + Storage).
                </p>
                <p className="text-xs text-red-500 mt-2">
                    Configure as variáveis VITE_FIREBASE_* no ambiente para habilitar este módulo.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4 animate-fade-in">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-5 rounded-xl text-white">
                <div className="flex items-center gap-3">
                    <div className="bg-white/20 p-2.5 rounded-lg">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold">Central de Documentos Fiscais</h2>
                        <p className="text-emerald-100 text-sm">
                            Importação, captura, dashboards e relatórios de XMLs fiscais.
                        </p>
                    </div>
                </div>
            </div>

            {!isFirebaseStorageConfigured && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                        ⚠️ Firebase Storage não está configurado. A importação manual está desabilitada
                        até que <code>VITE_FIREBASE_STORAGE_BUCKET</code> seja preenchido.
                    </p>
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 overflow-x-auto bg-slate-100 dark:bg-slate-800/60 p-1 rounded-lg">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        onClick={() => { setTab(t.id); setSelectedDoc(null); }}
                        className={`px-3 py-1.5 text-xs font-bold whitespace-nowrap rounded-md transition-colors ${
                            tab === t.id
                                ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-300 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div>
                {tab === 'dashboard' && (
                    <XmlDashboard currentUser={currentUser} refreshKey={refreshKey} />
                )}
                {tab === 'documentos' && (
                    <>
                        <XmlDocumentosList
                            currentUser={currentUser}
                            onSelect={setSelectedDoc}
                            refreshKey={refreshKey}
                        />
                        {selectedDoc && (
                            <div className="mt-4">
                                <XmlDocumentoDetalhe documento={selectedDoc} onClose={() => setSelectedDoc(null)} />
                            </div>
                        )}
                    </>
                )}
                {tab === 'importacao' && (
                    <XmlImportacaoManual
                        currentUser={currentUser}
                        onShowToast={onShowToast}
                        onImported={() => setRefreshKey(k => k + 1)}
                    />
                )}
                {tab === 'empresas' && (
                    <XmlEmpresasMonitoradas currentUser={currentUser} />
                )}
                {tab === 'sharepoint' && (
                    <XmlSharePoint />
                )}
                {tab === 'erros' && (
                    <XmlErros currentUser={currentUser} refreshKey={refreshKey} />
                )}
                {tab === 'relatorios' && (
                    <XmlRelatorios currentUser={currentUser} refreshKey={refreshKey} onShowToast={onShowToast} />
                )}
                {tab === 'nfse_pdf' && (
                    <NfsePdfImportacao
                        currentUser={currentUser}
                        onShowToast={onShowToast}
                        onImported={() => setRefreshKey(k => k + 1)}
                    />
                )}
                {tab === 'config' && (
                    <XmlConfiguracoes currentUser={currentUser} />
                )}
            </div>
        </div>
    );
};

export default CentralDocumentosFiscais;
