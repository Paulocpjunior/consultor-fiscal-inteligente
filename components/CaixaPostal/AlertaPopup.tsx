/**
 * AlertaPopup — banner de alerta sobre mensagens criticas na Caixa Postal.
 * Aparece uma vez por dia (deduplicado via localStorage).
 * Mostra breakdown por canal (eCAC, DET, DEC, DJE, e-MAC).
 */
import React, { useEffect, useState } from 'react';
import type { User, CaixaPostalResumo, CaixaPostalFonte } from '../../types';
import { getResumo, fonteLabel, fonteDotColor } from '../../services/caixaPostalService';

const STORAGE_KEY = 'caixaPostal:lastAlertDate';

interface Props {
    currentUser: User | null;
    onIrParaCaixaPostal: () => void;
}

const AlertaPopup: React.FC<Props> = ({ currentUser, onIrParaCaixaPostal }) => {
    const [resumo, setResumo] = useState<CaixaPostalResumo | null>(null);
    const [dispensado, setDispensado] = useState(false);

    useEffect(() => {
        // Liberado a qualquer usuario autenticado (colaboradores cobrem
        // empresas uns dos outros). Filtro por carteira vira depois.
        if (!currentUser) return;

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
    const detNotif = (resumo.naoLidasPorCategoria.det_notificacao || 0) + (resumo.naoLidasPorCategoria.det_auto_infracao || 0);
    const decIntim = resumo.naoLidasPorCategoria.dec_intimacao || 0;
    const djeCit = (resumo.naoLidasPorCategoria.dje_citacao || 0) + (resumo.naoLidasPorCategoria.dje_intimacao || 0);

    // Per-fonte breakdown
    const fontes: CaixaPostalFonte[] = ['ecac', 'det', 'dec', 'dje', 'emac', 'prefeitura_sp'];
    const naoLidasPorFonte = resumo.naoLidasPorFonte || {};

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[80] animate-fade-in">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md p-6">
                <div className="flex items-start gap-4 mb-4">
                    <div className="text-4xl">&#9888;&#65039;</div>
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                            Pendencias fiscais criticas detectadas
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                            {resumo.empresasComCriticas} empresa(s) tem mensagens importantes nao lidas.
                        </p>
                    </div>
                </div>

                {/* Breakdown por categoria critica */}
                <div className="space-y-1 text-sm bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3 mb-3">
                    {intimacoes > 0 && (
                        <div className="flex justify-between">
                            <span className="text-red-700 dark:text-red-400">Intimacoes (Receita)</span>
                            <span className="font-bold">{intimacoes}</span>
                        </div>
                    )}
                    {malha > 0 && (
                        <div className="flex justify-between">
                            <span className="text-amber-700 dark:text-amber-400">Malha Fiscal</span>
                            <span className="font-bold">{malha}</span>
                        </div>
                    )}
                    {exclusoes > 0 && (
                        <div className="flex justify-between">
                            <span className="text-purple-700 dark:text-purple-400">Exclusao Simples</span>
                            <span className="font-bold">{exclusoes}</span>
                        </div>
                    )}
                    {detNotif > 0 && (
                        <div className="flex justify-between">
                            <span className="text-orange-700 dark:text-orange-400">Notificacoes Trabalhistas (DET)</span>
                            <span className="font-bold">{detNotif}</span>
                        </div>
                    )}
                    {decIntim > 0 && (
                        <div className="flex justify-between">
                            <span className="text-emerald-700 dark:text-emerald-400">Intimacoes Estaduais (DEC)</span>
                            <span className="font-bold">{decIntim}</span>
                        </div>
                    )}
                    {djeCit > 0 && (
                        <div className="flex justify-between">
                            <span className="text-violet-700 dark:text-violet-400">Citacoes/Intimacoes Judiciais (DJE)</span>
                            <span className="font-bold">{djeCit}</span>
                        </div>
                    )}
                </div>

                {/* Breakdown por canal */}
                {resumo.naoLidasPorFonte && (
                    <div className="flex flex-wrap gap-2 mb-4">
                        {fontes.map(f => {
                            const count = naoLidasPorFonte[f] || 0;
                            if (count === 0) return null;
                            return (
                                <span key={f} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                    <span className={`inline-block w-2 h-2 rounded-full ${fonteDotColor(f)}`}></span>
                                    {fonteLabel(f)}: {count}
                                </span>
                            );
                        })}
                    </div>
                )}

                {resumo.mode === 'mock' && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
                        Modo teste -- dados sinteticos para desenvolvimento. Ative producao via env CAIXA_POSTAL_MODE=serpro quando o Integra Contador estiver contratado.
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
                        Ver agora
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AlertaPopup;
