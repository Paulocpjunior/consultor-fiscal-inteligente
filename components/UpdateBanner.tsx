import React, { useState } from 'react';
import { useVersionCheck } from '../services/versionService';
import { rotuloVersao } from '../version';

const UpdateBanner: React.FC = () => {
    const { updateAvailable, latest, applyUpdate, dismiss } = useVersionCheck();
    const [isApplying, setIsApplying] = useState(false);

    if (!updateAvailable || !latest) return null;

    const handleApply = async () => {
        setIsApplying(true);
        await applyUpdate();
    };

    return (
        <div
            role="alert"
            aria-live="polite"
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] w-[calc(100%-2rem)] max-w-xl animate-fade-in"
        >
            <div className="bg-white dark:bg-slate-800 border-2 border-sky-500 dark:border-sky-400 rounded-2xl shadow-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center text-sky-600 dark:text-sky-300">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                        <path d="M21 12a9 9 0 0 1-9 9" />
                        <path d="M3 12a9 9 0 0 1 9-9" />
                        <path d="M21 3v6h-6" />
                        <path d="M3 21v-6h6" />
                    </svg>
                </div>
                <div className="flex-grow min-w-0">
                    <p className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                        Nova versão disponível
                    </p>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-0.5">
                        Atualizamos o sistema para a versão{' '}
                        <span className="font-mono font-bold text-sky-700 dark:text-sky-300">
                            {rotuloVersao(latest.version, latest.buildNumber || '')}
                        </span>
                        . Clique em <strong>Atualizar agora</strong> para recarregar (hard refresh) e aplicar as melhorias.
                    </p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-mono truncate">
                        release {latest.release}
                    </p>
                </div>
                <div className="flex gap-2 flex-shrink-0 self-stretch sm:self-center">
                    <button
                        onClick={dismiss}
                        disabled={isApplying}
                        className="btn-press px-3 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                        Mais tarde
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={isApplying}
                        className="btn-press px-4 py-2 text-xs sm:text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors disabled:opacity-60 flex items-center gap-2"
                    >
                        {isApplying ? (
                            <>
                                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                <span>Atualizando...</span>
                            </>
                        ) : (
                            'Atualizar agora'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UpdateBanner;
