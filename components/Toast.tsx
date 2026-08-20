import React, { useEffect, useRef } from 'react';
import { tomDoToast, duracaoDoToast, TOM_META } from '../services/toastTone';

interface ToastProps {
    message: string;
    onClose: () => void;
    duration?: number;
}

const Toast: React.FC<ToastProps> = ({ message, onClose, duration }) => {
    // O tom vem da mensagem: falha NÃO pode aparecer com ✓ verde (era o caso
    // até 30/07 — "Falha na análise: IA indisponível" chegava com cara de
    // sucesso pra colaboradora).
    const tom = tomDoToast(message);
    const meta = TOM_META[tom];
    const ms = duration ?? duracaoDoToast(tom);

    // onClose vem como funcao inline do parent. Se incluido nas deps do effect,
    // todo render do parent reseta o setTimeout - toast pode nunca fechar
    // sozinho em apps com state global re-renderizando. Travamos via ref para
    // que o effect dispare apenas uma vez por mount.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const timer = setTimeout(() => onCloseRef.current(), ms);
        return () => clearTimeout(timer);
    }, [ms]);

    return (
        <div
            className="fixed bottom-4 right-4 bg-white dark:bg-slate-800 shadow-lg rounded-lg p-4 flex items-start gap-3 animate-fade-in z-[100] max-w-sm"
            style={{ border: `1px solid ${meta.corBorda}`, borderLeft: `4px solid ${meta.corBorda}` }}
            role={tom === 'erro' ? 'alert' : 'status'}
            aria-live={tom === 'erro' ? 'assertive' : 'polite'}
        >
            <div
                className="p-1 rounded-full flex-shrink-0 w-7 h-7 flex items-center justify-center text-sm font-bold"
                style={{ background: meta.corFundo, color: meta.corBorda }}
                aria-hidden="true"
            >
                {meta.emoji}
            </div>
            <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide m-0" style={{ color: meta.corBorda }}>
                    {meta.rotulo}
                </p>
                {/* Mensagem de erro é longa (traz a ação): quebra em linhas em vez de cortar. */}
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200 m-0 mt-0.5 break-words">{message}</p>
            </div>
            <button
                onClick={onClose}
                className="ml-auto p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex-shrink-0"
                aria-label="Fechar notificação"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>
    );
};

export default Toast;
