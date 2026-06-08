/**
 * components/LucroPresumidoReal/DetailsView.tsx
 *
 * View "details" do LucroPresumidoRealDashboard - mostra cards de fichas
 * (competencias) de UMA empresa selecionada, com botoes pra abrir Dados
 * Fiscais / Correlacao CFOP / criar nova ficha. NFSe SP admin panel
 * embutido pra admin.
 * Extraido de LucroPresumidoRealDashboard.tsx - issue #100.
 */
import React from 'react';
import type { LucroPresumidoEmpresa, User } from '../../types';
import { ArrowLeftIcon, BuildingIcon, CalculatorIcon, PlusIcon } from '../Icons';
import NfseSpAdminPanel from '../NfseSpAdminPanel';

export interface DetailsViewProps {
    empresa: LucroPresumidoEmpresa;
    currentUser: User | null;
    onVoltar: () => void;
    onAbrirDadosFiscais: () => void;
    onAbrirCorrelacaoCfop: () => void;
    onCriarNovaFicha: () => void;
    onAbrirFicha: (fichaId: string) => void;
    /** Callback pra salvar config NFSe SP (chama service e atualiza state). */
    onSalvarNfseSpConfig: (cfg: { ccmSp: string; nfseSpAutorizadoEm?: string | null }) => Promise<void>;
    onShowToast: (msg: string) => void;
}

const DetailsView: React.FC<DetailsViewProps> = ({
    empresa, currentUser, onVoltar, onAbrirDadosFiscais, onAbrirCorrelacaoCfop,
    onCriarNovaFicha, onAbrirFicha, onSalvarNfseSpConfig, onShowToast,
}) => (
    <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
                <button onClick={onVoltar} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full"><ArrowLeftIcon className="w-5 h-5" /></button>
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{empresa.nome}</h2>
                    <p className="text-slate-500 dark:text-slate-400 font-mono text-sm">{empresa.cnpj}</p>
                </div>
            </div>
            <button onClick={onAbrirDadosFiscais} className="btn-press flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 font-bold rounded-lg hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50" title="Dados fiscais para SPED, DCTFWeb e outras obrigacoes">
                <BuildingIcon className="w-5 h-5" />
                Dados Fiscais
            </button>
            <button onClick={onAbrirCorrelacaoCfop} className="btn-press flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 font-bold rounded-lg hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50" title="Correlacao automatica/manual de CFOPs no SPED Fiscal">
                🔄 Correlacao CFOP
            </button>
        </div>

        {/* NFSe SP — mesmo painel do Simples, agora tambem pro Lucro (admin) */}
        {currentUser?.role === 'admin' && (
            <NfseSpAdminPanel
                empresaId={empresa.id}
                colecao="lucro_empresas"
                ccmSpAtual={empresa.dadosFiscais?.ccmSp || empresa.ccmSp}
                nfseSpAutorizadoEmAtual={empresa.nfseSpAutorizadoEm}
                onSalvarConfig={onSalvarNfseSpConfig}
                onShowToast={onShowToast}
            />
        )}

        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <CalculatorIcon className="w-5 h-5 text-sky-600" />
                    Fichas Financeiras (Competências)
                </h3>
                <button
                    onClick={onCriarNovaFicha}
                    className="btn-press flex items-center gap-2 px-4 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 transition-colors"
                >
                    <PlusIcon className="w-4 h-4" /> Nova Competência
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {empresa.fichaFinanceira && empresa.fichaFinanceira.length > 0 ? empresa.fichaFinanceira.map(ficha => (
                    <div key={ficha.id} onClick={() => onAbrirFicha(ficha.id)} className="cursor-pointer bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg border border-slate-200 dark:border-slate-600 hover:border-sky-400 transition-all">
                        <div className="flex justify-between items-start mb-2">
                            <span className="font-bold text-slate-800 dark:text-white capitalize">{new Date(ficha.mesReferencia + '-02').toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${ficha.periodoApuracao === 'Trimestral' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' : 'bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300'}`}>
                                {ficha.periodoApuracao || 'Mensal'}
                            </span>
                        </div>
                        <div className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
                            <div className="flex justify-between"><span>Faturamento:</span> <span className="font-mono text-slate-900 dark:text-slate-200 font-bold">{ficha.faturamentoMesTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>
                            <div className="flex justify-between"><span>Impostos:</span> <span className="font-mono">{ficha.totalImpostos.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>
                        </div>
                    </div>
                )) : (
                    <p className="text-slate-500 col-span-3 text-center py-4">Nenhuma ficha financeira registrada.</p>
                )}
            </div>
        </div>
    </div>
);

export default DetailsView;
