
import React, { useMemo } from 'react';
import { SimplesNacionalEmpresa, SimplesNacionalNota, User } from '../types';
import * as simplesService from '../services/simplesNacionalService';
import { PlusIcon, InfoIcon, ShieldIcon, PencilIcon } from './Icons';

interface SimplesNacionalDashboardProps {
    empresas: SimplesNacionalEmpresa[];
    notas: Record<string, SimplesNacionalNota[]>;
    onSelectEmpresa: (id: string, view: 'detalhe' | 'cliente') => void;
    onAddNew: () => void;
    onEdit: (empresa: SimplesNacionalEmpresa) => void;
    currentUser?: User | null;
    onShowToast?: (msg: string) => void;
}

const SimplesNacionalDashboard: React.FC<SimplesNacionalDashboardProps> = ({ empresas, notas, onSelectEmpresa, onAddNew, onEdit, currentUser, onShowToast }) => {
    
    const empresasComResumo = useMemo(() => {
        return empresas.map(empresa => {
            // Pass { fullHistory: false } to align "mensal" data with RBT12 period (last 12 months)
            const resumo = simplesService.calcularResumoEmpresa(empresa, notas[empresa.id] || [], new Date(), { fullHistory: false });
            return { ...empresa, resumo };
        });
    }, [empresas, notas]);

    const isAdminView = currentUser?.role === 'admin' || currentUser?.email === 'junior@spassessoriacontabil.com.br';

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
                                {empresasComResumo.map(e => (
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
                                            {e.resumo.ultrapassou_sublimite && (
                                                <div className="flex items-center justify-end gap-1 mt-1 text-orange-600 dark:text-orange-400 text-xs font-bold" title="Sub-limite Estadual/Municipal ultrapassado (R$ 3.6M)">
                                                    <InfoIcon className="w-3 h-3" />
                                                    Sub-limite!
                                                </div>
                                            )}
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
