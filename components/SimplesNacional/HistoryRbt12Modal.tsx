/**
 * components/SimplesNacional/HistoryRbt12Modal.tsx
 *
 * Editor manual do RBT12 (faturamento bruto dos 12 meses anteriores
 * usado no calculo do Simples Nacional). Extraido de
 * SimplesNacionalDetalhe.tsx -- modal usado quando o sistema nao
 * conseguiu inferir RBT12 dos lancamentos (notas fiscais importadas).
 *
 * Renderiza um CurrencyInput por mes anterior ao `mesApuracao`.
 */
import React from 'react';
import { PlusIcon } from '../Icons';

interface Props {
    mesApuracao: Date;
    manualRbtHistory: Record<string, number>;
    setManualRbtHistory: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    onSalvar: () => void;
    onFechar: () => void;
    CurrencyInput: React.FC<{ value: number; onChange: (val: number) => void; className?: string }>;
}

const HistoryRbt12Modal: React.FC<Props> = ({
    mesApuracao, manualRbtHistory, setManualRbtHistory,
    onSalvar, onFechar, CurrencyInput,
}) => (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-[60] animate-fade-in overflow-y-auto" onClick={onFechar}>
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col my-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100">Editor de Histórico RBT12</h3>
                <button onClick={onFechar} className="text-slate-400 hover:text-slate-600">
                    <div className="rotate-45"><PlusIcon className="w-5 h-5" /></div>
                </button>
            </div>
            <div className="p-4 overflow-y-auto flex-grow space-y-3">
                <p className="text-xs text-slate-500 mb-2">Informe o faturamento bruto mensal dos últimos 12 meses para cálculo correto da alíquota.</p>
                {Array.from({ length: 12 }).map((_, i) => {
                    const d = new Date(mesApuracao.getTime());
                    d.setMonth(d.getMonth() - (i + 1));
                    const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
                    const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

                    return (
                        <div key={key} className="flex justify-between items-center gap-4">
                            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 capitalize w-1/3">{label}</label>
                            <CurrencyInput
                                value={manualRbtHistory[key] || 0}
                                onChange={(val) => setManualRbtHistory(prev => ({ ...prev, [key]: val }))}
                                className="flex-grow"
                            />
                        </div>
                    );
                })}
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                <button onClick={onFechar} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg">Cancelar</button>
                <button onClick={onSalvar} className="px-4 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700">Salvar Histórico</button>
            </div>
        </div>
    </div>
);

export default HistoryRbt12Modal;
