import React from 'react';
import { SimilarService } from '../types';
import LoadingSpinner from './LoadingSpinner';
import { LightBulbIcon } from './Icons';

interface SimilarServicesDisplayProps {
    services: SimilarService[] | null;
    isLoading: boolean;
    error: string | null;
    onSelectService: (code: string) => void;
}

const SimilarServicesDisplay: React.FC<SimilarServicesDisplayProps> = ({ services, isLoading, error, onSelectService }) => {
    if (!services && !isLoading && !error) {
        return null;
    }

    return (
        <div className="mt-6 p-6 bg-white dark:bg-slate-800 rounded-lg shadow-sm animate-fade-in">
            <div className="flex items-center mb-4">
                <LightBulbIcon className="w-6 h-6 text-sky-600 dark:text-sky-400" />
                <h3 className="ml-3 text-xl font-bold text-slate-800 dark:text-slate-100">
                    Serviços Similares Sugeridos por IA
                </h3>
            </div>
            {isLoading && <LoadingSpinner />}
            {error && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-300">
                    <p className="font-semibold">Erro ao buscar sugestões</p>
                    <p className="text-sm">{error}</p>
                </div>
            )}
            {services && services.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {services.map(service => (
                        <button
                            key={service.code}
                            onClick={() => onSelectService(service.code)}
                            className="text-left p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg hover:bg-sky-100 dark:hover:bg-sky-900/50 border border-transparent hover:border-sky-300 dark:hover:border-sky-600 transition-all"
                        >
                            <p className="font-bold text-sky-700 dark:text-sky-400">{service.code}</p>
                            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{service.description}</p>
                        </button>
                    ))}
                </div>
            )}
             {services && services.length === 0 && (
                <p className="text-slate-500 dark:text-slate-400">Nenhum serviço similar foi encontrado.</p>
            )}
        </div>
    );
};

export default SimilarServicesDisplay;
