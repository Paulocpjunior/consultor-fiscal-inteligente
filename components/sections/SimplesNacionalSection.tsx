/**
 * components/sections/SimplesNacionalSection.tsx
 *
 * Section do Simples Nacional extraida do App.tsx -- gerencia o switch
 * entre as 4 sub-views (dashboard / nova / detalhe / cliente) e expoe
 * os handlers do CRUD de empresa via props.
 *
 * Mantida com Suspense + ErrorBoundary internos (igual ao App original)
 * pra cobrir o lazy-load dos dashboards filhos.
 */
import React, { Suspense, lazy } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import ErrorBoundary from '../ErrorBoundary';
import SimplesNacionalDashboard from '../SimplesNacionalDashboard';
import SimplesNacionalNovaEmpresa from '../SimplesNacionalNovaEmpresa';
import * as simplesService from '../../services/simplesNacionalService';
import * as authService from '../../services/authService';
import { useConfirm } from '../dialog/DialogProvider';
import type {
    SimplesNacionalEmpresa, SimplesNacionalNota, SimplesNacionalImportResult, User,
} from '../../types';

const SimplesNacionalDetalhe = lazy(() => import('../SimplesNacionalDetalhe'));
const SimplesNacionalClienteView = lazy(() => import('../SimplesNacionalClienteView'));

export type SimplesView = 'dashboard' | 'detalhe' | 'nova' | 'cliente';

interface Props {
    simplesView: SimplesView;
    setSimplesView: (v: SimplesView) => void;
    simplesEmpresas: SimplesNacionalEmpresa[];
    setSimplesEmpresas: React.Dispatch<React.SetStateAction<SimplesNacionalEmpresa[]>>;
    simplesNotas: Record<string, SimplesNacionalNota[]>;
    selectedEmpresa: SimplesNacionalEmpresa | undefined;
    setSelectedSimplesEmpresaId: (id: string | null) => void;
    simplesEmpresaToEdit: SimplesNacionalEmpresa | null;
    setSimplesEmpresaToEdit: (e: SimplesNacionalEmpresa | null) => void;
    currentUser: User | null;
    setToastMessage: (msg: string | null) => void;
    onSaveSimplesEmpresa: (nome: string, cnpj: string, cnae: string, anexo: any, atividadesSecundarias?: any[], dataAbertura?: string) => Promise<any>;
    onImportNotas: (empresaId: string, file: File) => Promise<SimplesNacionalImportResult>;
    onUpdateFolha12: (empresaId: string, val: number) => void;
    onSaveFaturamentoManual: (empresaId: string, faturamento: any, faturamentoDetalhado?: any) => Promise<any>;
    onUpdateEmpresa: (empresaId: string, data: Partial<SimplesNacionalEmpresa>) => Promise<any>;
}

const SimplesNacionalSection: React.FC<Props> = ({
    simplesView, setSimplesView,
    simplesEmpresas, setSimplesEmpresas,
    simplesNotas,
    selectedEmpresa, setSelectedSimplesEmpresaId,
    simplesEmpresaToEdit, setSimplesEmpresaToEdit,
    currentUser, setToastMessage,
    onSaveSimplesEmpresa, onImportNotas, onUpdateFolha12,
    onSaveFaturamentoManual, onUpdateEmpresa,
}) => {
    const confirm = useConfirm();

    return (
        <ErrorBoundary>
            <Suspense fallback={<LoadingSpinner />}>
                {simplesView === 'dashboard' && (
                    <SimplesNacionalDashboard
                        empresas={simplesEmpresas}
                        notas={simplesNotas}
                        onSelectEmpresa={(id, view) => { setSelectedSimplesEmpresaId(id); setSimplesView(view); }}
                        onAddNew={() => { setSimplesEmpresaToEdit(null); setSimplesView('nova'); }}
                        onEdit={(empresa) => { setSimplesEmpresaToEdit(empresa); setSimplesView('nova'); }}
                        onDelete={async (empresa) => {
                            const ok = await confirm({
                                title: `Excluir empresa "${empresa.nome}"?`,
                                message: `CNPJ ${empresa.cnpj}. Essa ação não pode ser desfeita.`,
                                variant: 'danger',
                                confirmLabel: 'Excluir',
                            });
                            if (!ok) return;
                            try {
                                await simplesService.deleteEmpresa(empresa.id);
                                setSimplesEmpresas(prev => prev.filter(e => e.id !== empresa.id));
                                if (currentUser) authService.logAction(currentUser.id, currentUser.name, 'delete_empresa', empresa.nome);
                                setToastMessage(`Empresa "${empresa.nome}" excluída.`);
                            } catch (err: any) {
                                const msg = err?.code === 'permission-denied'
                                    ? 'Sem permissão para excluir esta empresa (só admin ou criador).'
                                    : (err?.message || 'Erro ao excluir empresa.');
                                setToastMessage(msg);
                                console.error('[deleteEmpresa Simples]', err);
                            }
                        }}
                        onShowToast={(msg) => setToastMessage(msg)}
                        currentUser={currentUser}
                    />
                )}
                {simplesView === 'nova' && (
                    <SimplesNacionalNovaEmpresa
                        onSave={onSaveSimplesEmpresa}
                        onCancel={() => { setSimplesView('dashboard'); setSimplesEmpresaToEdit(null); }}
                        onShowToast={(msg) => setToastMessage(msg)}
                        initialData={simplesEmpresaToEdit}
                    />
                )}
                {simplesView === 'detalhe' && selectedEmpresa && (
                    <SimplesNacionalDetalhe
                        empresa={selectedEmpresa}
                        notas={simplesNotas[selectedEmpresa.id] || []}
                        onBack={() => setSimplesView('dashboard')}
                        onImport={onImportNotas}
                        onUpdateFolha12={onUpdateFolha12}
                        onSaveFaturamentoManual={onSaveFaturamentoManual}
                        onUpdateEmpresa={onUpdateEmpresa}
                        onShowClienteView={() => setSimplesView('cliente')}
                        onShowToast={(msg) => setToastMessage(msg)}
                        currentUser={currentUser}
                    />
                )}
                {simplesView === 'cliente' && selectedEmpresa && (
                    <SimplesNacionalClienteView
                        empresa={selectedEmpresa}
                        notas={simplesNotas[selectedEmpresa.id] || []}
                        onBack={() => setSimplesView('dashboard')}
                    />
                )}
            </Suspense>
        </ErrorBoundary>
    );
};

export default SimplesNacionalSection;
