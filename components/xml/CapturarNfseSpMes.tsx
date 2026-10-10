/**
 * 🔁 CAPTURAR NFS-e SP DESTA COMPETÊNCIA — mês encerrado, só a empresa (09/10).
 *
 * Paulo, LANCHONETE JO-BRAS: a rodada automática do portal de SP só alcança
 * os últimos ~40 dias, e o "zero NFS-e" de um mês que ficou fora dela travava
 * o Fim de Mês sem ninguém conseguir provar nada. Este botão baixa o MÊS
 * INTEIRO do portal para a empresa (prestadas e tomadas) e grava a prova do
 * mês. Admin; leva ~1-2 min (login no portal + dois downloads).
 */
import React, { useState } from 'react';
import { capturarNfseSpDoMes, type CapturaNfseSpMes } from '../../services/nfseSpCapturaMesService';

interface Props {
    empresaId: string;
    competencia: string;
    /** Reapura a aba depois da captura. */
    onCapturado?: () => void;
}

const mesAtual = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const br = (c: string) => c.split('-').reverse().join('/');

const CapturarNfseSpMes: React.FC<Props> = ({ empresaId, competencia, onCapturado }) => {
    const [rodando, setRodando] = useState(false);
    const [r, setR] = useState<CapturaNfseSpMes | null>(null);
    const encerrado = /^\d{4}-\d{2}$/.test(competencia) && competencia < mesAtual();

    const rodar = async () => {
        setRodando(true); setR(null);
        try {
            const res = await capturarNfseSpDoMes({ empresaId, anoMes: competencia });
            setR(res);
            if (res.ok) onCapturado?.();
        } finally {
            setRodando(false);
        }
    };

    return (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
                <button onClick={rodar} disabled={rodando || !empresaId || !encerrado}
                    className="px-3 py-2 text-sm font-bold rounded-lg border border-emerald-500 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-40"
                    title="Baixa do portal da Prefeitura o mês inteiro desta empresa (prestadas e tomadas). Só admin.">
                    {rodando ? 'Capturando no portal… (1-2 min)' : `🔁 Capturar NFS-e SP de ${br(competencia)} (mês inteiro)`}
                </button>
                <span className="text-[11px] text-slate-500">
                    {encerrado
                        ? 'Para mês fora da janela automática (últimos ~40 dias). Grava a prova do mês: o "zero NFS-e" passa a valer.'
                        : 'Só mês já encerrado — o mês corrente a captura automática baixa todo dia.'}
                </span>
            </div>
            {r && (r.ok ? (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                    ✅ {br(r.anoMes || competencia)} capturado: {r.prestadas ?? 0} NFS-e emitida(s) · {r.tomadas ?? 0} tomada(s). A apuração foi refeita.
                </p>
            ) : (
                <p className="text-[11px] font-semibold text-red-700 dark:text-red-300">
                    {r.erro || [r.erroPrestadas && `emitidas: ${r.erroPrestadas}`, r.erroTomadas && `tomadas: ${r.erroTomadas}`].filter(Boolean).join(' · ') || 'Falha não detalhada.'}
                </p>
            ))}
        </div>
    );
};

export default CapturarNfseSpMes;
