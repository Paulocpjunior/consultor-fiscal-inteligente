/**
 * DialogProvider — substituto acessivel pra window.confirm/alert/prompt.
 *
 * Por que: window.confirm bloqueia thread, leitor de tela nao consegue
 * ler o titulo, nao tem trap de foco, layout inconsistente entre browsers
 * e quebra em mobile. ConfirmDialog/PromptDialog renderizam um <dialog>
 * acessivel via React (com Esc/Enter, trap de foco, role=alertdialog).
 *
 * Uso:
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title: 'Excluir?', message: '...', variant: 'danger' });
 *   if (ok) doDelete();
 *
 *   const prompt = usePrompt();
 *   const nome = await prompt({ title: 'Novo nome', defaultValue: '...' });
 *   if (nome !== null) doSave(nome);
 *
 * Setup: envolver <App /> com <DialogProvider> em index.tsx.
 */
import React, {
    createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';

export type ConfirmVariant = 'danger' | 'warning' | 'info';

export interface ConfirmOptions {
    title: string;
    message: React.ReactNode;
    variant?: ConfirmVariant;
    confirmLabel?: string;
    cancelLabel?: string;
}

export interface PromptOptions {
    title: string;
    message?: React.ReactNode;
    defaultValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Bloqueia confirmar se input vazio. Default true. */
    requireValue?: boolean;
}

interface DialogCtx {
    confirm: (opts: ConfirmOptions) => Promise<boolean>;
    prompt: (opts: PromptOptions) => Promise<string | null>;
}

const Ctx = createContext<DialogCtx | null>(null);

export function useConfirm(): DialogCtx['confirm'] {
    const c = useContext(Ctx);
    if (!c) throw new Error('useConfirm: <DialogProvider> ausente em index.tsx');
    return c.confirm;
}

export function usePrompt(): DialogCtx['prompt'] {
    const c = useContext(Ctx);
    if (!c) throw new Error('usePrompt: <DialogProvider> ausente em index.tsx');
    return c.prompt;
}

type Resolver<T> = (v: T) => void;

interface PendingConfirm {
    type: 'confirm';
    opts: ConfirmOptions;
    resolve: Resolver<boolean>;
}

interface PendingPrompt {
    type: 'prompt';
    opts: PromptOptions;
    resolve: Resolver<string | null>;
}

type Pending = PendingConfirm | PendingPrompt;

const VARIANT_BTN: Record<ConfirmVariant, string> = {
    danger: 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500 text-white',
    warning: 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500 text-white',
    info: 'bg-sky-600 hover:bg-sky-700 focus-visible:ring-sky-500 text-white',
};

const VARIANT_ICON: Record<ConfirmVariant, { bg: string; emoji: string }> = {
    danger: { bg: 'bg-red-100 dark:bg-red-900/40', emoji: '⚠️' },
    warning: { bg: 'bg-amber-100 dark:bg-amber-900/40', emoji: '⚠' },
    info: { bg: 'bg-sky-100 dark:bg-sky-900/40', emoji: 'ℹ️' },
};

export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [pending, setPending] = useState<Pending | null>(null);
    const [inputValue, setInputValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const confirmBtnRef = useRef<HTMLButtonElement>(null);

    const confirm = useCallback((opts: ConfirmOptions) => {
        return new Promise<boolean>(resolve => {
            setPending({ type: 'confirm', opts, resolve });
        });
    }, []);

    const prompt = useCallback((opts: PromptOptions) => {
        return new Promise<string | null>(resolve => {
            setInputValue(opts.defaultValue || '');
            setPending({ type: 'prompt', opts, resolve });
        });
    }, []);

    const close = useCallback((result: boolean | string | null) => {
        if (!pending) return;
        if (pending.type === 'confirm') {
            (pending.resolve as Resolver<boolean>)(result === true);
        } else {
            (pending.resolve as Resolver<string | null>)(typeof result === 'string' ? result : null);
        }
        setPending(null);
        setInputValue('');
    }, [pending]);

    // Esc cancela; Enter confirma (so quando nao esta digitando em textarea).
    useEffect(() => {
        if (!pending) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close(pending.type === 'confirm' ? false : null);
            } else if (e.key === 'Enter' && !e.shiftKey) {
                // Em prompt, Enter confirma se houver valor (ou se nao for required)
                if (pending.type === 'prompt') {
                    const required = pending.opts.requireValue !== false;
                    if (required && !inputValue.trim()) return;
                    e.preventDefault();
                    close(inputValue);
                } else {
                    e.preventDefault();
                    close(true);
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [pending, inputValue, close]);

    // Focus inicial: input (prompt) ou botao confirmar (confirm).
    useEffect(() => {
        if (!pending) return;
        const t = setTimeout(() => {
            if (pending.type === 'prompt') {
                inputRef.current?.focus();
                inputRef.current?.select();
            } else {
                confirmBtnRef.current?.focus();
            }
        }, 50);
        return () => clearTimeout(t);
    }, [pending]);

    const ctxValue = { confirm, prompt };

    let modal: React.ReactNode = null;
    if (pending) {
        const variant = pending.type === 'confirm' ? (pending.opts.variant || 'warning') : 'info';
        const icon = VARIANT_ICON[variant];
        const cancelLabel = pending.opts.cancelLabel || 'Cancelar';
        const confirmLabel = pending.opts.confirmLabel || (pending.type === 'confirm' ? 'Confirmar' : 'OK');
        const onCancel = () => close(pending.type === 'confirm' ? false : null);
        const onConfirm = () => {
            if (pending.type === 'prompt') {
                const required = pending.opts.requireValue !== false;
                if (required && !inputValue.trim()) return;
                close(inputValue);
            } else {
                close(true);
            }
        };
        const required = pending.type === 'prompt' && pending.opts.requireValue !== false;
        const confirmDisabled = pending.type === 'prompt' && required && !inputValue.trim();

        modal = (
            <div
                className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-[200] animate-fade-in overflow-y-auto"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="dialog-title"
                aria-describedby="dialog-desc"
                onClick={onCancel}
            >
                <div
                    className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md flex flex-col my-auto"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="p-5 flex items-start gap-3">
                        <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg ${icon.bg}`}>
                            {icon.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 id="dialog-title" className="text-lg font-bold text-slate-800 dark:text-slate-100">
                                {pending.opts.title}
                            </h3>
                            {pending.opts.message && (
                                <div id="dialog-desc" className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                    {pending.opts.message}
                                </div>
                            )}
                            {pending.type === 'prompt' && (
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={inputValue}
                                    onChange={e => setInputValue(e.target.value)}
                                    placeholder={pending.opts.placeholder}
                                    className="mt-3 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                />
                            )}
                        </div>
                    </div>
                    <div className="px-5 py-3 bg-slate-50 dark:bg-slate-900/40 rounded-b-xl flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                        >
                            {cancelLabel}
                        </button>
                        <button
                            ref={confirmBtnRef}
                            type="button"
                            onClick={onConfirm}
                            disabled={confirmDisabled}
                            className={`px-4 py-2 text-sm font-bold rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_BTN[variant]}`}
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <Ctx.Provider value={ctxValue}>
            {children}
            {modal}
        </Ctx.Provider>
    );
};
