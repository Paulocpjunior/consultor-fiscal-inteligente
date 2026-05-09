/**
 * AlertaPopup — banner de alerta sobre mensagens críticas na Caixa Postal.
 * Aparece uma vez por dia (deduplicado via localStorage).
 */
import React, { useEffect, useState } from 'react';
import type { User, CaixaPostalResumo, SearchType } from '../../types';
import { getResumo } from '../../services/caixaPostalService';

const STORAGE_KEY = 'caixaPostal:lastAlertDate';

interface Props {
    currentUser: User | null;
    onIrParaCaixaPostal: () => void;
}

const AlertaPopup: React.FC<Props> = ({ currentUser, onIrParaCaixaPostal }) => {
    const [resumo, setResumo] = useState<CaixaPostalResumo | null>(null);
    const [dispensado, setDispensado] = useState(false);

    useEffect(() => {
        // Só admin recebe alerta
        if (!currentUser || currentUser.role !== 'admin') return;

        const hoje = new Date().toISOString().slice(0, 10);
        try {
            const lastDate = localStorage.getItem(STORAGE_KEY);
            if (lastDate === hoje) {
                setDispensado(true);
                return;
            }
        } catch { /* ignore */ }

        getResumo(currentUser)
            .then(r => {
                if (r.empresasComCriticas > 0) {
                    setResumo(r);
                }
            })
            .catch(() => { /* silencioso, modulo opcional */ });
    }, [currentUser]);

    const handleDispensar = () => {
        try {
            localStorage.setItem(STORAGE_KEY, new Date().toISOString().slice(0, 10));
        } catch { /* ignore */ }
        setDispensado(true);
    };

    const handleIr = () => {
        handleDispensar();
        onIrParaCaixaPostal();
    };

    if (dispensado || !resumo || resumo.empresasComCriticas === 0) return null;

    const intimacoes = resumo.naoLidasPorCategoria.intimacao || 0;
    const malha = resumo.naoLidasPorCategoria.malha || 0;
    const exclusoes = resumo.naoLidasPorCategoria.exclusao || 0;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[80] animate-fade-in">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md p-6">
                <div className="flex items-start gap-4 mb-4">
                    <div className="text-4xl">⚠️</div>
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                            Pendências fiscais críticas detectadas
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                            {resumo.empresasComCriticas} empresa(s) têm mensagens importantes da Receita Federal não lidas.
                        </p>
                    </div>
                </div>

                <div className="space-y-1 text-sm bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3 mb-4">
                    {intimacoes > 0 && (
                        <div className="flex justify-between">
                            <span className="text-red-700 dark:text-red-400">🔴 Intimações</span>
                            <span className="font-bold">{intimacoes}</span>
                        </div>
                    )}
                    {malha > 0 && (
                        <div className="flex justify-between">
                            <span className="text-amber-700 dark:text-amber-400">🟡 Malha Fiscal</span>
                            <span className="font-bold">{malha}</span>
                        </div>
                    )}
                    {exclusoes > 0 && (
                        <div className="flex justify-between">
                            <span className="text-purple-700 dark:text-purple-400">🟣 Exclusão Simples</span>
                            <span className="font-bold">{exclusoes}</span>
                        </div>
                    )}
                </div>

                {resumo.mode === 'mock' && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
                        ⓘ Modo teste — dados sintéticos pra desenvolvimento. Ative produção via env CAIXA_POSTAL_MODE=serpro quando o Integra Contador estiver contratado.
                    </p>
                )}

                <div className="flex gap-2 justify-end">
                    <button
                        onClick={handleDispensar}
                        className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                        Ver depois
                    </button>
                    <button
                        onClick={handleIr}
                        className="btn-press px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700"
                    >
                        Ver agora →
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AlertaPopup;
