/**
 * components/AnaliseCredito/_shared.tsx
 *
 * Helpers e mini-componentes compartilhados entre os painéis de
 * AnaliseCreditoExtrato (CSV e E-Fiscal). Extraídos para reduzir
 * o monolito do componente principal.
 */
import React from 'react';
import type { LancamentoExtrato } from '../../services/analiseCreditoExtratoService';

export const brl = (n: number) =>
    n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const BadgeConfianca: React.FC<{ c: LancamentoExtrato['confianca'] }> = ({ c }) => {
    const cfg: Record<LancamentoExtrato['confianca'], { bg: string; label: string }> = {
        ALTA:      { bg: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',    label: '✓ alta' },
        MEDIA:     { bg: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200', label: '~ média' },
        BAIXA:     { bg: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200', label: '! baixa' },
        SEM_MATCH: { bg: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',             label: '? revisar' },
    };
    return (
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg[c].bg}`}>
            {cfg[c].label}
        </span>
    );
};

export const CardTotal: React.FC<{ label: string; valor: number; cor: string; qtde?: number }> = ({
    label, valor, cor, qtde,
}) => (
    <div className={`rounded-xl p-3 ${cor} flex flex-col gap-0.5`}>
        <span className="text-[11px] font-medium opacity-75">{label}</span>
        <span className="text-sm font-bold">R$ {brl(valor)}</span>
        {typeof qtde === 'number' && <span className="text-[10px] opacity-60">{qtde} lanç.</span>}
    </div>
);
