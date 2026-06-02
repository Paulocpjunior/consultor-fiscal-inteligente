
import React, { useMemo, useState } from 'react';
import { SimplesNacionalEmpresa, SimplesNacionalNota, User } from '../types';
import * as simplesService from '../services/simplesNacionalService';
import { PlusIcon, InfoIcon, ShieldIcon, PencilIcon, TrashIcon } from './Icons';

interface SimplesNacionalDashboardProps {
    empresas: SimplesNacionalEmpresa[];
    notas: Record<string, SimplesNacionalNota[]>;
    onSelectEmpresa: (id: string, view: 'detalhe' | 'cliente') => void;
    onAddNew: () => void;
    onEdit: (empresa: SimplesNacionalEmpresa) => void;
    onDelete?: (empresa: SimplesNacionalEmpresa) => void;
    currentUser?: User | null;
    onShowToast?: (msg: string) => void;
}

const SimplesNacionalDashboard: React.FC<SimplesNacionalDashboardProps> = ({ empresas, notas, onSelectEmpresa, onAddNew, onEdit, onDelete, currentUser, onShowToast }) => {
    
    const empresasComResumo = useMemo(() => {
        return empresas.map(empresa => {
            // Pass { fullHistory: false } to align "mensal" data with RBT12 period (last 12 months)
            const resumo = simplesService.calcularResumoEmpresa(empresa, notas[empresa.id] || [], new Date(), { fullHistory: false });
            return { ...empresa, resumo };
        });
    }, [empresas, notas]);

    const isAdminView = currentUser?.role === 'admin' || currentUser?.email === 'junior@spassessoriacontabil.com.br';

    const [busca, setBusca] = useState('');
    const empresasFiltradas = useMemo(() => {
        const termo = busca.trim().toLowerCase();
        if (!termo) return empresasComResumo;
        const termoCnpj = termo.replace(/\D/g, '');
        return empresasComResumo.filter(e => {
            const nome = (e.nome || '').toLowerCase();
            const cnpj = (e.cnpj || '').replace(/\D/g, '');
            return nome.includes(termo) || (termoCnpj && cnpj.includes(termoCnpj));
        });
    }, [empresasComResumo, busca]);

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                            Painel Simples Nacional
                        </h2>
                        {isAdminView && (
                             <span className="px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 text-xs font-bold rounded-full flex items-center gap-1">
                                <ShieldIcon className="w-3 h-3" /> Admin View
                             </span>
                        )}
                    </div>
                    <p className="mt-1 text-slate-500 dark:text-slate-400">
                        Gerencie as empresas e acompanhe os cálculos do Simples.
                    </p>
                </div>
                <button
                    onClick={onAddNew}
                    className="btn-press flex items-center gap-2 px-4 py-2 bg-sky-600 text-white font-semibold rounded-lg hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 transition-colors"
                >
                    <PlusIcon className="w-5 h-5" />
                    Nova Empresa
                </button>
            </div>
            
            {empresas.length > 0 && (
                <div className="relative">
                    <input
                        type="text"
                        value={busca}
                        onChange={(ev) => setBusca(ev.target.value)}
                        placeholder="Buscar empresa por nome ou CNPJ..."
                        className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                </div>
            )}

            {empresasComResumo.length > 0 ? (
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
                            <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
                                <tr>
                                    <th scope="col" className="px-6 py-3">Empresa</th>
                                    {isAdminView && <th scope="col" className="px-6 py-3">Usuário</th>}
                                    <th scope="col" className="px-6 py-3">Anexo Efetivo</th>
                                    <th scope="col" className="px-6 py-3 text-right">RBT12 (R$)</th>
                                    <th scope="col" className="px-6 py-3 text-center">Aliq. Efetiva</th>
                                    <th scope="col" className="px-6 py-3 text-right bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300">DAS (Mês Atual)</th>
                                    <th scope="col" className="px-6 py-3 text-right">DAS Est. 12m</th>
                                    <th scope="col" className="px-6 py-3 text-center">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {empresasFiltradas.map(e => (
                                    <tr key={e.id} className="bg-white dark:bg-slate-800 border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600/20">
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                                            {e.nome}
                                            <p className="font-normal text-slate-500 dark:text-slate-400">{e.cnpj}</p>
                                        </td>
                                        {isAdminView && (
                                            <td className="px-6 py-4">
                                                <span className="text-xs font-mono bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded">
                                                    {e.createdByEmail || 'Desconhecido'}
                                                </span>
                                            </td>
                                        )}
                                        <td className="px-6 py-4">
                                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-300">
                                                Anexo {e.resumo.anexo_efetivo}
                                            </span>
                                            {e.anexo === 'III_V' && (
                                                 <span className="block mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                    Fator R: {(e.resumo.fator_r * 100).toFixed(1)}%
                                                 </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono">
                                            {e.resumo.rbt12.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            {/* Badges em ordem de gravidade — so a mais grave aparece. */}
                                            {e.resumo.alertas_faturamento?.excesso_maior_20_pct.atingido ? (
                                                <div className="flex items-center justify-end gap-1 mt-1 text-red-700 dark:text-red-400 text-xs font-bold" title="Excesso > 20% do limite federal (R$ 5,76M) — desenquadramento RETROATIVO (LC 123 art. 30 §1º II)">
                                                    <InfoIcon className="w-3 h-3" />
                                                    Excesso 20%!
                                                </div>
                                            ) : e.resumo.alertas_faturamento?.limite_federal.atingido ? (
                                                <div className="flex items-center justify-end gap-1 mt-1 text-red-600 dark:text-red-400 text-xs font-bold" title="Limite federal Simples ultrapassado (R$ 4,8M) — empresa vedada ao Simples">
                                                    <InfoIcon className="w-3 h-3" />
                                                    Limite federal!
                                                </div>
                                            ) : e.resumo.alertas_faturamento?.proximo_limite_federal.atingido ? (
                                                <div className="flex items-center justify-end gap-1 mt-1 text-amber-600 dark:text-amber-400 text-xs font-bold" title="Receita acima de 90% do limite federal (R$ 4,32M)">
                                                    <InfoIcon className="w-3 h-3" />
                                                    {'>'}90% limite
                                                </div>
                                            ) : (e.resumo.alertas_faturamento?.sublimite_icms_iss.atingido ?? e.resumo.ultrapassou_sublimite) ? (
                                                <div className="flex items-center justify-end gap-1 mt-1 text-orange-600 dark:text-orange-400 text-xs font-bold" title="Sub-limite Estadual/Municipal ICMS/ISS ultrapassado (R$ 3,6M)">
                                                    <InfoIcon className="w-3 h-3" />
                                                    Sub-limite!
                                                </div>
                                            ) : e.resumo.alertas_faturamento?.proxima_mudanca_faixa ? (
                                                <div className="flex items-center justify-end gap-1 mt-1 text-sky-600 dark:text-sky-400 text-xs font-bold" title={`Próxima faixa: alíquota nominal ${e.resumo.alertas_faturamento.proxima_mudanca_faixa.aliquota_nominal_proxima.toFixed(2)}%`}>
                                                    <InfoIcon className="w-3 h-3" />
                                                    Próx. faixa
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="px-6 py-4 text-center font-mono">{e.resumo.aliq_eff.toFixed(2)}%</td>
                                        <td className="px-6 py-4 text-right font-mono font-bold bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300">
                                            {e.resumo.das_mensal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono">{e.resumo.das.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="px-6 py-4 text-center space-x-2 whitespace-nowrap">
                                            <button onClick={() => onSelectEmpresa(e.id, 'detalhe')} className="font-medium text-sky-600 dark:text-sky-400 hover:underline">
                                                Painel
                                            </button>
                                            <span className="text-slate-300 dark:text-slate-600">|</span>
                                            <button onClick={() => onSelectEmpresa(e.id, 'cliente')} className="font-medium text-sky-600 dark:text-sky-400 hover:underline">
                                                Cliente
                                            </button>
                                            <span className="text-slate-300 dark:text-slate-600">|</span>
                                            <button onClick={() => onEdit(e)} className="font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800" title="Editar Empresa">
                                                <PencilIcon className="w-4 h-4 inline" />
                                            </button>
                                            {isAdminView && onDelete && (
                                                <>
                                                    <span className="text-slate-300 dark:text-slate-600">|</span>
                                                    <button onClick={() => onDelete(e)} className="font-medium text-red-500 hover:text-red-700" title="Excluir empresa (admin)">
                                                        <TrashIcon className="w-4 h-4 inline" />
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="text-center p-8 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Nenhuma empresa cadastrada</h3>
                    <p className="mt-2 text-slate-500 dark:text-slate-400">
                        Clique em "Nova Empresa" para começar a fazer seus cálculos do Simples Nacional.
                    </p>
                </div>
            )}
        </div>
    );
};

export default SimplesNacionalDashboard;
