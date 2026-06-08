/**
 * components/LucroPresumidoReal/inputs.tsx
 *
 * Componentes utilitarios de input usados pelas views do LucroPresumidoReal.
 * Extraidos de LucroPresumidoRealDashboard.tsx pra ficarem reaproveitaveis
 * pelas sub-views (NewFichaView, ReportView, etc).
 */
import React from 'react';

interface CurrencyInputProps {
    label?: string;
    value: number;
    onChange: (val: number) => void;
    className?: string;
    disabled?: boolean;
    placeholder?: string;
    highlight?: boolean;
    subtitle?: string;
    noLabel?: boolean;
}

export const CurrencyInput: React.FC<CurrencyInputProps> = ({
    label, value, onChange, className, disabled, placeholder, highlight, subtitle, noLabel,
}) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/\D/g, '');
        const num = parseFloat(raw) / 100;
        onChange(isNaN(num) ? 0 : num);
    };
    const formatted = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(value);

    return (
        <div className={className}>
            {!noLabel && label && <label className={`block text-xs font-bold uppercase mb-1 ${disabled ? 'text-slate-400' : (highlight ? 'text-sky-700 dark:text-sky-400' : 'text-slate-500 dark:text-slate-400')}`}>{label}</label>}
            <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold text-xs ${highlight ? 'text-sky-600' : 'text-slate-400'}`}>R$</span>
                <input
                    type="text"
                    value={value === 0 ? '' : formatted}
                    placeholder={placeholder || '0,00'}
                    onChange={handleChange}
                    disabled={disabled}
                    className={`w-full pl-8 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-sky-500 outline-none font-mono text-sm font-bold text-right transition-colors
                        ${disabled ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700' :
                          highlight ? 'bg-sky-50 dark:bg-sky-900/20 text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800' :
                          'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600'}`}
                />
            </div>
            {subtitle && <p className="text-[9px] text-sky-600 dark:text-sky-400 mt-1 text-right font-bold">{subtitle}</p>}
        </div>
    );
};

interface ToggleSwitchProps {
    label: string;
    checked: boolean;
    onChange: (val: boolean) => void;
    description?: string;
    colorClass?: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ label, checked, onChange, description, colorClass = 'bg-sky-600' }) => (
    <div className={`p-4 rounded-lg border transition-all cursor-pointer ${checked ? 'bg-white dark:bg-slate-800 border-l-4 border-l-' + colorClass.replace('bg-', '') + ' border-y-slate-200 border-r-slate-200 dark:border-y-slate-700 dark:border-r-slate-700 shadow-sm' : 'bg-slate-50 dark:bg-slate-800/50 border-transparent opacity-70 hover:opacity-100'}`} onClick={() => onChange(!checked)}>
        <div className="flex items-start gap-3">
            <div className={`mt-1 w-5 h-5 rounded border flex items-center justify-center transition-colors ${checked ? colorClass + ' border-transparent' : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-500'}`}>
                {checked && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
            </div>
            <div>
                <span className={`block text-sm font-bold ${checked ? 'text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}>{label}</span>
                {description && <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 block leading-relaxed">{description}</span>}
            </div>
        </div>
    </div>
);
