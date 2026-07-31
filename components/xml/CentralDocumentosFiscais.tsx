import React, { useState, lazy, Suspense } from 'react';
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
import XmlExportarIobSage from './XmlExportarIobSage';
import CapturaDiagnosticoPanel from '../CapturaDiagnosticoPanel';
import CronsHealthPanel from '../CronsHealthPanel';
import NfseCaminhoGuia from '../NfseCaminhoGuia';
import EmpresasStatusCapturaPanel from '../EmpresasStatusCapturaPanel';

const XmlNfseSpCsv = lazy(() => import('./XmlNfseSpCsv'));
const XmlNfseSpCapturadas = lazy(() => import('./XmlNfseSpCapturadas'));
const NfseSpSessaoCookies = lazy(() => import('../NfseSpSessaoCookies'));
const SaeNfceCaptura = lazy(() => import('./SaeNfceCaptura'));
const XmlImportacaoZip = lazy(() => import('./XmlImportacaoZip'));
const AutXmlHarvest = lazy(() => import('./AutXmlHarvest'));
const SistemaBancoPanel = lazy(() => import('../SistemaBancoPanel'));
const CofreEmailPanel = lazy(() => import('./CofreEmailPanel'));
const CofreControlePanel = lazy(() => import('./CofreControlePanel'));
const BacklogEntradaPanel = lazy(() => import('./BacklogEntradaPanel'));
const ProvaCapturaPanel = lazy(() => import('./ProvaCapturaPanel'));
const CofreChecklistPanel = lazy(() => import('./CofreChecklistPanel'));

type TabId =
    | 'dashboard'
    | 'captura-auto'
    | 'empresas-status'
    | 'backlog-entrada'
    | 'prova-captura'
    | 'documentos'
    | 'importacao'
    | 'empresas'
    | 'sharepoint'
    | 'exportar-iob'
    | 'erros'
    | 'relatorios'
    | 'config'
    | 'nfse_pdf'
    | 'nfse_sp_csv'
    | 'nfse_sp_captura'
    | 'sae_nfce';

// ── Consolidação 16 → 8 abas (aprovada pelo Paulo 24/07) ────────────────────
// As 16 telas continuam EXATAMENTE as mesmas (TabId preservado, zero mudança
// de lógica): mudou só a navegação — 8 grupos no topo, telas irmãs viram
// sub-abas (mesmo padrão do DctfwebHub). Motivo: função enterrada em aba
// invisível sem rolar a barra (casos 23-24/07: comunicado do mod 55,
// Checklist do Cofre, Exportar SAGE).
type GrupoId = 'dashboard' | 'captura' | 'documentos' | 'importar' | 'empresas' | 'integracoes' | 'relatorios' | 'config';

const GRUPOS: Array<{ id: GrupoId; label: string; subs: Array<{ id: TabId; label: string }> }> = [
    { id: 'dashboard', label: 'Dashboard', subs: [{ id: 'dashboard', label: 'Dashboard' }] },
    {
        id: 'captura', label: '🛰️ Captura', subs: [
            { id: 'captura-auto', label: '🛰️ Diagnóstico' },
            { id: 'empresas-status', label: '📋 Status por Empresa' },
            { id: 'prova-captura', label: '🔎 Prova de captura' },
            { id: 'backlog-entrada', label: '📥 Backlog Entrada' },
            { id: 'sae_nfce', label: '🧾 NFC-e Saída (SP)' },
            { id: 'nfse_sp_captura', label: '🛰️ Portal SP' },
        ],
    },
    { id: 'documentos', label: 'XMLs (Entrada/Saída)', subs: [{ id: 'documentos', label: 'XMLs' }] },
    {
        id: 'importar', label: '📥 Importar', subs: [
            { id: 'importacao', label: '📥 Manual & Cofre (saída 55)' },
            { id: 'nfse_pdf', label: 'NFSe (PDF)' },
            { id: 'nfse_sp_csv', label: 'NFSe SP (CSV)' },
        ],
    },
    { id: 'empresas', label: '🏢 Empresas', subs: [{ id: 'empresas', label: 'Empresas Monitoradas' }] },
    {
        // O nome do grupo diz o que tem DENTRO: depois da consolidação em 8
        // grupos (#277), "Exportar SAGE" ficou escondido atrás de "Integrações"
        // e a equipe achou que a função tinha sumido (Paulo, 28/07).
        id: 'integracoes', label: '🔗 Integrações (SharePoint · SAGE)', subs: [
            { id: 'sharepoint', label: 'SharePoint' },
            { id: 'exportar-iob', label: '📤 Exportar SAGE (IOB)' },
        ],
    },
    {
        id: 'relatorios', label: '📊 Relatórios & Logs', subs: [
            { id: 'relatorios', label: 'Relatórios' },
            { id: 'erros', label: 'Erros & Logs' },
        ],
    },
    { id: 'config', label: '⚙️ Configurações', subs: [{ id: 'config', label: 'Configurações' }] },
];

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const CentralDocumentosFiscais: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [grupo, setGrupo] = useState<GrupoId>('dashboard');
    // tab = a TELA ativa (mesmos 16 TabId de antes — conteúdo intocado).
    // Trocar de grupo cai na 1ª sub-aba dele; trocar de sub muda só a tela.
    const [tab, setTab] = useState<TabId>('dashboard');
    // CNPJ levado da lista de XMLs para a Prova de captura (um clique).
    const [cnpjProva, setCnpjProva] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);
    const [selectedDoc, setSelectedDoc] = useState<DocumentoFiscal | null>(null);

    const grupoAtivo = GRUPOS.find(g => g.id === grupo) ?? GRUPOS[0];
    const irParaGrupo = (g: (typeof GRUPOS)[number]) => {
        setGrupo(g.id);
        setTab(g.subs[0].id);
        setSelectedDoc(null);
    };

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

            {/* Navegação em 2 níveis: 8 grupos (cabem sem rolar) + sub-abas do
                grupo ativo. As 16 telas antigas continuam todas aqui — só a
                forma de chegar mudou (padrão DctfwebHub). */}
            <div className="flex gap-1 overflow-x-auto bg-slate-100 dark:bg-slate-800/60 p-1 rounded-lg">
                {GRUPOS.map(g => (
                    <button
                        key={g.id}
                        onClick={() => irParaGrupo(g)}
                        className={`px-3 py-1.5 text-xs font-bold whitespace-nowrap rounded-md transition-colors ${
                            grupo === g.id
                                ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-300 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                    >
                        {g.label}
                    </button>
                ))}
            </div>
            {grupoAtivo.subs.length > 1 && (
                <div className="flex gap-1 overflow-x-auto -mt-2 pl-1">
                    {grupoAtivo.subs.map(s => (
                        <button
                            key={s.id}
                            onClick={() => { setTab(s.id); setSelectedDoc(null); }}
                            className={`px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap rounded-md border transition-colors ${
                                tab === s.id
                                    ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                            }`}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Tab content */}
            <div>
                {tab === 'dashboard' && (
                    <>
                        {/* Mapa das funções: a consolidação em 8 grupos (#277)
                            deixou telas escondidas atrás do nome do grupo. Este
                            índice leva direto, sem caça ao tesouro. */}
                        <div className="mb-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">Onde está cada função</p>
                            <div className="flex flex-wrap gap-1.5">
                                {GRUPOS.filter(g => g.id !== 'dashboard').flatMap(g => g.subs.map(sub => (
                                    <button
                                        key={`${g.id}-${sub.id}`}
                                        onClick={() => { setGrupo(g.id); setTab(sub.id); setSelectedDoc(null); }}
                                        title={`${g.label} → ${sub.label}`}
                                        className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:border-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                                    >
                                        {sub.label}
                                    </button>
                                )))}
                            </div>
                        </div>
                        <XmlDashboard currentUser={currentUser} refreshKey={refreshKey} />
                    </>
                )}
                {tab === 'captura-auto' && (
                    <>
                        <CapturaDiagnosticoPanel currentUser={currentUser} />
                        <CronsHealthPanel />
                        <NfseCaminhoGuia />
                    </>
                )}
                {tab === 'empresas-status' && (
                    <EmpresasStatusCapturaPanel currentUser={currentUser} />
                )}
                {tab === 'prova-captura' && (
                    <Suspense fallback={<div className="p-6 text-center text-sm text-slate-400">Carregando…</div>}>
                        <ProvaCapturaPanel cnpjInicial={cnpjProva} />
                    </Suspense>
                )}
                {tab === 'backlog-entrada' && (
                    <Suspense fallback={<div className="p-6 text-center text-sm text-slate-400">Carregando…</div>}>
                        <BacklogEntradaPanel />
                    </Suspense>
                )}
                {tab === 'documentos' && (
                    <>
                        <XmlDocumentosList
                            currentUser={currentUser}
                            onSelect={setSelectedDoc}
                            refreshKey={refreshKey}
                            onProvarCaptura={(cnpj) => { setCnpjProva(cnpj); setGrupo('captura'); setTab('prova-captura'); }}
                        />
                        {selectedDoc && (
                            <div className="mt-4">
                                <XmlDocumentoDetalhe documento={selectedDoc} onClose={() => setSelectedDoc(null)} />
                            </div>
                        )}
                    </>
                )}
                {tab === 'importacao' && (
                    <div className="space-y-4">
                        {/* Guia do colaborador: HTML estático servido pelo próprio
                            app (public/ → dist/) — link estável pra equipe toda. */}
                        <div className="flex justify-end">
                            <a
                                href="/guia-saida-mod55.html"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800"
                            >
                                📗 Guia do colaborador — quando/por que/como usar cada função
                            </a>
                        </div>
                        <XmlImportacaoManual
                            currentUser={currentUser}
                            onShowToast={onShowToast}
                            onImported={() => setRefreshKey(k => k + 1)}
                        />
                        {/* Massa (ZIP): trilho da NF-e mod 55 de saída — o lote do
                            portal SEFAZ (baixado no escritório com o cert do cliente)
                            entra aqui e completa os resumos pendentes. */}
                        <Suspense fallback={null}>
                            <XmlImportacaoZip
                                currentUser={currentUser}
                                onShowToast={onShowToast}
                                onImported={() => setRefreshKey(k => k + 1)}
                            />
                        </Suspense>
                        {/* autXML: saída mod 55 automática via DistDFe (cert do
                            escritório). Fica junto do ZIP — ambos completam saída. */}
                        <Suspense fallback={null}>
                            <AutXmlHarvest />
                        </Suspense>
                        {/* Cofre CFI: XML por e-mail — substitui o cofre da SIEG.
                            É por aqui que a saída mod 55 entra (a SEFAZ não
                            entrega a saída ao próprio emissor). */}
                        <Suspense fallback={null}>
                            <CofreEmailPanel />
                        </Suspense>
                        <Suspense fallback={null}>
                            <CofreControlePanel />
                        </Suspense>
                        {/* Checklist de migração: quem tem saída 55 e ainda não
                            recebe via cofre → configurar e-mail no emissor. */}
                        <Suspense fallback={null}>
                            <CofreChecklistPanel />
                        </Suspense>
                    </div>
                )}
                {tab === 'empresas' && (
                    <XmlEmpresasMonitoradas currentUser={currentUser} />
                )}
                {tab === 'sharepoint' && (
                    <XmlSharePoint currentUser={currentUser} onShowToast={onShowToast} onImported={() => setRefreshKey(k => k + 1)} />
                )}
                {tab === 'exportar-iob' && (
                    <XmlExportarIobSage currentUser={currentUser} onShowToast={onShowToast} />
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
                {tab === 'sae_nfce' && (
                    <Suspense fallback={<p className="text-center text-xs text-slate-400 py-6">Carregando...</p>}>
                        <SaeNfceCaptura />
                    </Suspense>
                )}
                {tab === 'nfse_sp_captura' && (
                    <Suspense fallback={<p className="text-center text-xs text-slate-400 py-6">Carregando...</p>}>
                        <div className="space-y-6">
                            {/* Lista de NFSe capturadas primeiro (conteudo principal).
                                O card de gestao de cookies da sessao do portal SP foi
                                movido pro FIM da pagina — e acao de manutencao (renovar
                                a cada ~2h), nao o foco diario do contador. Continua em
                                uso ativo: o cron nfsesp-portal-cron depende desses cookies. */}
                            <XmlNfseSpCapturadas currentUser={currentUser} refreshKey={refreshKey} />
                            <NfseSpSessaoCookies currentUser={currentUser} />
                        </div>
                    </Suspense>
                )}
                {tab === 'nfse_sp_csv' && (
                    <Suspense fallback={<p className="text-center text-xs text-slate-400 py-6">Carregando...</p>}>
                        <XmlNfseSpCsv
                            currentUser={currentUser}
                            onShowToast={onShowToast}
                            onImported={() => setRefreshKey(k => k + 1)}
                        />
                    </Suspense>
                )}
                {tab === 'config' && (
                    <div className="space-y-4">
                        <XmlConfiguracoes currentUser={currentUser} />
                        {/* Sistema → Banco (DEV-ONLY): controle funcionalidade × coleção.
                            O backend trava por admin + SISTEMA_DEV_EMAILS. */}
                        {currentUser?.role === 'admin' && (
                            <Suspense fallback={null}>
                                <SistemaBancoPanel />
                            </Suspense>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CentralDocumentosFiscais;
