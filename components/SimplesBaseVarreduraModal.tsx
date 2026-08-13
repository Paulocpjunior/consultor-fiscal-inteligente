/**
 * Varredura das bases do Simples (RBT12) — quem estava com DAS a maior.
 *
 * Até 28/07/2026 a faixa era enquadrada por uma base montada a partir do
 * detalhamento por CNAE; quando esse detalhamento somava acima do total
 * lançado do mês, o RBT12 inflava e o DAS saía acima do PGDAS-D. O cálculo
 * já foi corrigido — esta tela responde quem foi afetado e em quanto, sem a
 * equipe precisar abrir cliente por cliente.
 *
 * O impacto vem de recálculo real nas duas bases, não de estimativa.
 */
import React, { useMemo, useState } from 'react';
import { varrerBasesSimples, type DivergenciaBase } from '../services/simplesBaseDivergencia';
import type { SimplesNacionalEmpresa } from '../types';

interface Props {
    empresas: SimplesNacionalEmpresa[];
    onClose: () => void;
    /** Abre o cliente na competência varrida. */
    onAbrirEmpresa?: (empresaId: string) => void;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCnpj = (c: string) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtComp = (c: string) => c.split('-').reverse().join('/');

const competenciasRecentes = (n = 12): string[] => {
    const out: string[] = [];
    const d = new Date();
    for (let i = 0; i < n; i++) {
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        d.setMonth(d.getMonth() - 1);
    }
    return out;
};

const Linha: React.FC<{ d: DivergenciaBase; onAbrir?: () => void }> = ({ d, onAbrir }) => (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{d.nome}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {fmtCnpj(d.cnpj)} · Anexo {d.anexo}
                </p>
            </div>
            <div className="text-right">
                <p className={`text-sm font-bold ${d.diferenca > 0.01 ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}`}>
                    {d.diferenca > 0.01 ? `+${brl(d.diferenca)} a maior` : 'sem impacto no DAS'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    DAS {brl(d.dasAntigo)} → {brl(d.dasCorreto)}
                </p>
            </div>
        </div>

        <div className="text-[11px] text-slate-600 dark:text-slate-300 grid grid-cols-1 sm:grid-cols-3 gap-x-3">
            <span>RBT12 correto: <strong>{brl(d.rbt12Correto)}</strong></span>
            <span>Base usada antes: <strong>{brl(d.rbt12Antigo)}</strong></span>
            <span>Excedente: <strong>{brl(d.excedente)}</strong></span>
        </div>

        <details>
            <summary className="text-[11px] cursor-pointer text-sky-600 dark:text-sky-400">
                Ver o(s) mês(es) com detalhamento acima do total ({d.meses.length})
            </summary>
            <ul className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
                {d.meses.map((m) => (
                    <li key={m.competencia}>
                        {fmtComp(m.competencia)}: total lançado {brl(m.total)} · detalhamento {brl(m.detalhado)}
                        {' '}(<strong>{brl(m.excedente)}</strong> a mais)
                    </li>
                ))}
            </ul>
        </details>

        {onAbrir && (
            <button onClick={onAbrir} className="text-[11px] px-3 py-1 rounded bg-sky-600 text-white hover:bg-sky-700">
                Abrir cliente
            </button>
        )}
    </div>
);

const SimplesBaseVarreduraModal: React.FC<Props> = ({ empresas, onClose, onAbrirEmpresa }) => {
    const [competencia, setCompetencia] = useState(competenciasRecentes()[0]!);

    const resultado = useMemo(() => {
        const [ano, mes] = competencia.split('-').map(Number);
        return varrerBasesSimples(empresas, new Date(ano!, (mes || 1) - 1, 1));
    }, [empresas, competencia]);

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5 space-y-3 my-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                            🔍 Conferência das bases (RBT12)
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xl">
                            Procura clientes cujo <strong>detalhamento por CNAE soma acima do total lançado</strong> do
                            mês. Era isso que inflava o RBT12, subia a faixa e deixava o DAS acima do PGDAS-D. O valor
                            ao lado é a diferença <strong>recalculada</strong> nas duas bases — não é estimativa.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            value={competencia}
                            onChange={(e) => setCompetencia(e.target.value)}
                            className="text-xs p-1.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700"
                        >
                            {competenciasRecentes().map((c) => <option key={c} value={c}>{fmtComp(c)}</option>)}
                        </select>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
                    </div>
                </div>

                <div className={`rounded-lg border p-3 text-sm font-bold ${
                    resultado.farol === 'ok'
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300'
                        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
                }`}>
                    {resultado.resumo}
                </div>

                {resultado.afetadas.map((d) => (
                    <Linha
                        key={d.empresaId}
                        d={d}
                        onAbrir={onAbrirEmpresa ? () => { onAbrirEmpresa(d.empresaId); onClose(); } : undefined}
                    />
                ))}

                {resultado.afetadas.length > 0 && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700 pt-2">
                        O DAS já sai correto desde a correção de 28/07 — não é preciso mexer no cadastro para o cálculo
                        ficar certo. Vale abrir o detalhamento dos meses listados só para confirmar se o lançamento em
                        duplicidade também precisa ser corrigido na origem.
                    </p>
                )}
            </div>
        </div>
    );
};

export default SimplesBaseVarreduraModal;
