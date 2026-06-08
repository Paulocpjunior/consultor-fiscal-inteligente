/**
 * components/LucroPresumidoReal/ListView.tsx
 *
 * View "list" do LucroPresumidoRealDashboard - lista empresas LP/LR
 * cadastradas com botoes Abrir + Excluir (admin).
 * Extraido de LucroPresumidoRealDashboard.tsx - issue #100.
 */
import React from 'react';
import type { LucroPresumidoEmpresa, User } from '../../types';
import { PlusIcon, TrashIcon } from '../Icons';

export interface ListViewProps {
    empresas: LucroPresumidoEmpresa[];
    currentUser: User | null;
    onNovaEmpresa: () => void;
    onAbrir: (empresaId: string) => void;
    onExcluir: (empresaId: string) => void;
}

const ListView: React.FC<ListViewProps> = ({ empresas, currentUser, onNovaEmpresa, onAbrir, onExcluir }) => (
    <div className="space-y-6 animate-fade-in">
        <div className="flex justify-between items-center">
            <div>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Lucro Presumido e Real</h2>
                <p className="mt-1 text-slate-500 dark:text-slate-400">Gestão de fichas financeiras e cálculo de impostos.</p>
            </div>
            <button
                onClick={onNovaEmpresa}
                className="btn-press flex items-center gap-2 px-4 py-2 bg-sky-600 text-white font-semibold rounded-lg hover:bg-sky-700 transition-colors"
            >
                <PlusIcon className="w-5 h-5" /> Nova Empresa
            </button>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
            <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
                <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
                    <tr>
                        <th className="px-6 py-3">Empresa</th>
                        <th className="px-6 py-3">CNPJ</th>
                        <th className="px-6 py-3">Regime Padrão</th>
                        <th className="px-6 py-3 text-right">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    {empresas.map(emp => (
                        <tr key={emp.id} className="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                            <td className="px-6 py-4 font-bold text-slate-800 dark:text-slate-200">{emp.nome}</td>
                            <td className="px-6 py-4 font-mono">{emp.cnpj}</td>
                            <td className="px-6 py-4">
                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${emp.regimePadrao === 'Real' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                    {emp.regimePadrao || 'Presumido'}
                                </span>
                            </td>
                            <td className="px-6 py-4 text-right flex justify-end gap-2">
                                <button onClick={() => onAbrir(emp.id)} className="text-sky-600 hover:text-sky-800 font-medium">Abrir</button>
                                {currentUser?.role === 'admin' && (
                                    <button onClick={() => onExcluir(emp.id)} className="text-red-500 hover:text-red-700" title="Excluir empresa (admin)"><TrashIcon className="w-4 h-4" /></button>
                                )}
                            </td>
                        </tr>
                    ))}
                    {empresas.length === 0 && (
                        <tr>
                            <td colSpan={4} className="px-6 py-8 text-center text-slate-500">Nenhuma empresa cadastrada.</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    </div>
);

export default ListView;
