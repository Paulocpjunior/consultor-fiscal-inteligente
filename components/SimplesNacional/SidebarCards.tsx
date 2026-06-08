/**
 * components/SimplesNacional/SidebarCards.tsx
 *
 * Coluna lateral do SimplesNacionalDetalhe: 3 cards lado a lado
 * (RBT12, Folha de Salários, Notas Recentes). Extraído pra reduzir
 * o monolito do detalhe.
 */
import React from 'react';
import { HistoryIcon, UserIcon, SaveIcon } from '../Icons';
import CurrencyInput from './CurrencyInput';
import type { SimplesNacionalNota } from '../../types';

interface ResumoSidebar {
    rbt12Interno: number;
    rbt12Externo: number;
    inicioAtividade?: boolean;
    mesesAtividade?: number;
    rbt12pInterno?: number;
    rbt12pExterno?: number;
    fator_r: number;
}

interface Props {
    totalRbt12Manual: number;
    resumo: ResumoSidebar;
    folha12Input: number;
    setFolha12Input: (v: number) => void;
    onUpdateFolha12: (empresaId: string, valor: number) => void;
    empresaId: string;
    notas: SimplesNacionalNota[];
    onAbrirHistoricoModal: () => void;
}

const SidebarCards: React.FC<Props> = ({
    totalRbt12Manual, resumo, folha12Input, setFolha12Input,
    onUpdateFolha12, empresaId, notas, onAbrirHistoricoModal,
}) => (
    <div className="lg:col-span-1 space-y-6 order-2 lg:order-1">
        {/* RBT12 Card */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
                <HistoryIcon className="w-4 h-4 text-sky-600" /> RBT12 (Histórico 12m)
            </h3>
            <button onClick={onAbrirHistoricoModal} className="text-[10px] text-sky-600 hover:underline font-bold w-full text-right mb-2">Editar Manual</button>
            <div className="p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg mb-3">
                <p className="text-[10px] text-slate-500 uppercase font-bold">Receita Bruta Acumulada</p>
                <p className="text-lg font-mono font-bold text-slate-900 dark:text-white">R$ {totalRbt12Manual.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>

                {/* Exibição Segregada */}
                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-600 flex justify-between text-[10px] font-bold">
                    <div className="text-slate-600 dark:text-slate-400">
                        <span className="block uppercase text-[9px] text-slate-400">Interno</span>
                        R$ {resumo.rbt12Interno.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-indigo-600 dark:text-indigo-400 text-right">
                        <span className="block uppercase text-[9px] text-indigo-400">Externo</span>
                        R$ {resumo.rbt12Externo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                </div>
                <p className="text-[9px] text-slate-400 mt-2 italic text-center">* Base de cálculo segregada para faixa</p>
            </div>

            {/* RBT12 proporcionalizada — empresa em início de atividade */}
            {resumo.inicioAtividade && (
                <div className="p-3 rounded-lg mb-1 border" style={{
                    background: 'var(--warning-soft)',
                    borderColor: 'var(--warning-soft-border)'
                }}>
                    <p className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--warning)' }}>
                        RBT12 Proporcionalizada (Início de Atividade)
                    </p>
                    <p className="text-[10px] mb-2" style={{ color: 'var(--warning)' }}>
                        Empresa com {resumo.mesesAtividade ?? 0} {((resumo.mesesAtividade ?? 0) === 1) ? 'mês' : 'meses'} de atividade.
                        Por força da Resolução CGSN 140/2018 art. 21, o RBT12 é proporcionalizado:
                        <span className="font-mono"> RBT12 / {resumo.mesesAtividade || 1} × 12</span>.
                    </p>
                    <div className="flex justify-between text-[10px] font-bold">
                        <div>
                            <span className="block uppercase text-[9px]" style={{ color: 'var(--warning)' }}>Interno (p)</span>
                            <span style={{ color: 'var(--text-primary)' }}>
                                R$ {(resumo.rbt12pInterno ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                        </div>
                        <div className="text-right">
                            <span className="block uppercase text-[9px]" style={{ color: 'var(--warning)' }}>Externo (p)</span>
                            <span style={{ color: 'var(--text-primary)' }}>
                                R$ {(resumo.rbt12pExterno ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                        </div>
                    </div>
                    <p className="text-[9px] mt-2" style={{ color: 'var(--warning)' }}>
                        Esse é o valor usado para enquadramento na faixa do Anexo (não o RBT12 acima).
                    </p>
                </div>
            )}
        </div>

        {/* Folha Card */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
                <UserIcon className="w-4 h-4 text-sky-600" /> Folha de Salários (12m)
            </h3>
            <div className="space-y-3">
                <div className="flex gap-2">
                    <CurrencyInput value={folha12Input} onChange={setFolha12Input} className="flex-1" />
                    <button onClick={() => onUpdateFolha12(empresaId, folha12Input)} className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 p-2 rounded-lg text-slate-600 dark:text-slate-300"><SaveIcon className="w-4 h-4" /></button>
                </div>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                    <div className="flex justify-between items-center mb-1">
                        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">Fator R Calculado</label>
                        <span className={`text-xs font-bold ${resumo.fator_r >= 0.28 ? 'text-green-600' : 'text-orange-600'}`}>
                            {(resumo.fator_r * 100).toFixed(2)}%
                        </span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                        <div className={`h-2 rounded-full ${resumo.fator_r >= 0.28 ? 'bg-green-500' : 'bg-orange-500'}`} style={{ width: `${Math.min(resumo.fator_r * 100, 100)}%` }}></div>
                    </div>
                    <p className="text-[9px] text-slate-400 mt-1">Meta: 28% para Anexo III (se aplicável)</p>
                </div>
            </div>
        </div>

        {/* Notas Recentes */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4">Notas Importadas</h3>
            {notas.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
                        <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
                            <tr>
                                <th className="px-4 py-2">Data</th>
                                <th className="px-4 py-2 text-right">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {notas.slice(0, 5).map(nota => (
                                <tr key={nota.id} className="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-4 py-2">{new Date(nota.data).toLocaleDateString()}</td>
                                    <td className="px-4 py-2 text-right font-mono font-bold text-slate-700 dark:text-slate-200">
                                        {nota.valor.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p className="text-slate-500 dark:text-slate-400 text-sm text-center py-4">Nenhuma nota importada.</p>
            )}
        </div>
    </div>
);

export default SidebarCards;
