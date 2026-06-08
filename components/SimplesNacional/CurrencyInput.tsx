/**
 * components/SimplesNacional/CurrencyInput.tsx
 *
 * Input monetário pt-BR (R$, vírgula decimal) usado pelos painéis do
 * Simples Nacional. Extraído de SimplesNacionalDetalhe.tsx para
 * compartilhar com HistoryRbt12Modal e SidebarCards.
 */
import React from 'react';

interface Props {
    value: number;
    onChange: (val: number) => void;
    className?: string;
    placeholder?: string;
    label?: string;
}

const CurrencyInput: React.FC<Props> = ({ value, onChange, className, placeholder, label }) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/\D/g, '');
        const num = parseFloat(raw) / 100;
        onChange(isNaN(num) ? 0 : num);
    };
    const formatted = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(value);
    return (
        <div className={`relative ${className || ''}`}>
            {label && <label className="block text-xs font-bold text-slate-500 mb-1">{label}</label>}
            <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xs">R$</span>
                <input
                    type="text"
                    value={value === 0 && placeholder ? '' : formatted}
                    placeholder={placeholder}
                    onChange={handleChange}
                    className="w-full pl-8 pr-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-slate-900 font-bold dark:text-white dark:font-mono text-right text-sm"
                />
            </div>
        </div>
    );
};

export default CurrencyInput;
