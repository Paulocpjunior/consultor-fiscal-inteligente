
import React, { useEffect, useState } from 'react';
import { AccessLog } from '../types';
import { getAccessLogs } from '../services/authService';
import { CloseIcon, ShieldIcon } from './Icons';

interface AccessLogsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const AccessLogsModal: React.FC<AccessLogsModalProps> = ({ isOpen, onClose }) => {
    const [logs, setLogs] = useState<AccessLog[]>([]);

    useEffect(() => {
        if (isOpen) {
            setLogs(getAccessLogs());
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[70] animate-fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="bg-slate-100 dark:bg-slate-900 p-4 rounded-t-xl flex justify-between items-center border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-slate-800 dark:text-slate-100 font-bold text-lg flex items-center gap-2">
                        <ShieldIcon className="w-5 h-5 text-sky-600" />
                        Logs de Acesso
                    </h3>
                    <button onClick={onClose} className="p-1 rounded-full text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                        <CloseIcon className="w-5 h-5" />
                    </button>
                </div>
                
                <div className="p-4 overflow-y-auto flex-grow">
                    {logs.length === 0 ? (
                        <p className="text-center text-slate-500 dark:text-slate-400 py-8">Nenhum registro encontrado.</p>
                    ) : (
                        <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
                            <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300 sticky top-0">
                                <tr>
                                    <th className="px-4 py-2">Data/Hora</th>
                                    <th className="px-4 py-2">Colaborador</th>
                                    <th className="px-4 py-2">Ação</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((log) => (
                                    <tr key={log.id} className="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td className="px-4 py-2 font-mono">
                                            {new Date(log.timestamp).toLocaleString('pt-BR')}
                                        </td>
                                        <td className="px-4 py-2 font-semibold text-slate-700 dark:text-slate-200">
                                            {log.userName}
                                        </td>
                                        <td className="px-4 py-2">
                                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                                log.action === 'login' 
                                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' 
                                                : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
                                            }`}>
                                                {log.action === 'login' ? 'Entrada' : 'Saída'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
                
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-b-xl">
                    <button 
                        onClick={onClose}
                        className="w-full py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold transition-colors"
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AccessLogsModal;
