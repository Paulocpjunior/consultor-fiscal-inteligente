import React, { useEffect } from 'react';
import { AnimatedCheckIcon } from './Icons';

interface ToastProps {
    message: string;
    onClose: () => void;
    duration?: number;
}

const Toast: React.FC<ToastProps> = ({ message, onClose, duration = 3000 }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, duration);
        return () => clearTimeout(timer);
    }, [onClose, duration]);

    return (
        <div className="fixed bottom-4 right-4 bg-white dark:bg-slate-800 border border-green-100 dark:border-green-900/30 shadow-lg rounded-lg p-4 flex items-center gap-3 animate-fade-in z-[100] max-w-sm">
            <div className="bg-green-100 dark:bg-green-900/30 p-1 rounded-full">
                <AnimatedCheckIcon size="w-5 h-5" />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{message}</p>
        </div>
    );
};

export default Toast;