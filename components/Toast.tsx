import React, { useEffect, useRef } from 'react';
import { AnimatedCheckIcon } from './Icons';

interface ToastProps {
    message: string;
    onClose: () => void;
    duration?: number;
}

const Toast: React.FC<ToastProps> = ({ message, onClose, duration = 3000 }) => {
    // onClose vem como funcao inline do parent. Se incluido nas deps do effect,
    // todo render do parent reseta o setTimeout - toast pode nunca fechar
    // sozinho em apps com state global re-renderizando. Travamos via ref para
    // que o effect dispare apenas uma vez por mount.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const timer = setTimeout(() => onCloseRef.current(), duration);
        return () => clearTimeout(timer);
    }, [duration]);

    return (
        <div className="fixed bottom-4 right-4 bg-white dark:bg-slate-800 border border-green-100 dark:border-green-900/30 shadow-lg rounded-lg p-4 flex items-center gap-3 animate-fade-in z-[100] max-w-sm" role="status" aria-live="polite">
            <div className="bg-green-100 dark:bg-green-900/30 p-1 rounded-full">
                <AnimatedCheckIcon size="w-5 h-5" />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{message}</p>
            <button onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors" aria-label="Fechar notificação">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>
    );
};

export default Toast;