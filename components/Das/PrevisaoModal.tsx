/**
 * components/Das/PrevisaoModal.tsx
 * Modal de previsão DAS — estatística (regressão linear) + IA opcional.
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User, DasPrevisaoResponse, DasPrevisaoIaResponse } from '../../types';
import { getPrevisaoDas, getPrevisaoIa, formatBRL } from '../../services/dasService';
import SafeMarkdown from '../SafeMarkdown';

interface Props {
    empresaId: string;
    empresaNome: string;
    currentUser: User | null;
    onClose: () => void;
    onShowToast: (msg: string) => void;
}

const PrevisaoModal: React.FC<Props> = ({ empresaId, empresaNome, currentUser, onClose, onShowToast }) => {
    const [dados, setDados] = useState<DasPrevisaoResponse | null>(null);
    const [ia, setIa] = useState<DasPrevisaoIaResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingIa, setLoadingIa] = useState(false);

    useEffect(() => {
        getPrevisaoDas(currentUser, empresaId)
            .then(setDados)
            .catch(e => onShowToast(`Erro: ${e.message}`))
            .finally(() => setLoading(false));
    }, [empresaId]);

    const pedirAnaliseIa = async () => {
        if (!dados) return;
        setLoadingIa(true);
        try {
            const r = await getPrevisaoIa(currentUser, dados);
            setIa(r);
        } catch (e: any) {
            onShowToast(`Erro IA: ${e.message}`);
        } finally {
            setLoadingIa(false);
        }
    };

    const renderMarkdown = (text: string) => (
        <SafeMarkdown text={text} className="mb-3 last:mb-0 text-slate-700 dark:text-slate-300" />
    );

    const confiancaLabel = (r2: number) => {
        if (r2 > 0.7) return { label: 'Alta', cor: 'text-emerald-600' };
        if (r2 > 0.4) return { label: 'Média', cor: 'text-amber-600' };
        return { label: 'Baixa', cor: 'text-red-600' };
    };
    // PORTAL PRA <body>. Um ancestral com transform/will-change vira containing
    // block de descendentes `position: fixed` (spec CSS, armadilha anotada no
    // index.css): o `inset-0` deixa de ser a viewport e vira a caixa do painel,
    // então o cartão é CENTRADO NELA — a parte de baixo (justamente os botões de
    // enviar) cai fora da tela e não há como rolar até ela, porque o overlay é
    // fixed. Foi o que o Paulo viu em 12/08 ("está escondida a parte de
    // enviar"). No body, o modal não depende de ancestral nenhum.

    return createPortal((
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-[80] overflow-y-auto" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col my-auto" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-xl font-bold">📈 Previsão DAS — {empresaNome}</h3>
                    <p className="text-sm text-slate-500 mt-1">Próximos 3 meses, baseado em regressão linear do histórico</p>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {loading && <div className="text-center text-slate-500">Calculando previsão...</div>}

                    {dados?.aviso && (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-amber-700 dark:text-amber-300 text-sm">
                            ⚠️ {dados.aviso}
                        </div>
                    )}

                    {dados && dados.previsao.length > 0 && (
                        <>
                            {/* Estatistica */}
                            <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-4 grid grid-cols-3 gap-3 text-sm">
                                <div>
                                    <div className="text-xs text-slate-500">Histórico analisado</div>
                                    <div className="font-bold text-lg">{dados.estatistica.qtdMesesAnalisados} meses</div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-500">Tendência mensal</div>
                                    <div className={`font-bold text-lg ${dados.estatistica.slope > 0 ? 'text-red-600' : dados.estatistica.slope < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                                        {dados.estatistica.slope > 0 ? '↑ +' : dados.estatistica.slope < 0 ? '↓ ' : '→ '}
                                        {formatBRL(Math.abs(dados.estatistica.slope))}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-500">Confiança (R²)</div>
                                    <div className={`font-bold text-lg ${confiancaLabel(dados.estatistica.r2).cor}`}>
                                        {confiancaLabel(dados.estatistica.r2).label} ({(dados.estatistica.r2 * 100).toFixed(0)}%)
                                    </div>
                                </div>
                            </div>

                            {/* Previsao por mes */}
                            <div>
                                <h4 className="text-sm font-bold mb-2">Próximos 3 meses</h4>
                                <div className="space-y-2">
                                    {dados.previsao.map(p => (
                                        <div key={p.competencia} className={`p-3 rounded-lg border ${p.mudancaFaixa ? 'border-red-300 bg-red-50 dark:bg-red-900/20' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}>
                                            <div className="flex items-center justify-between flex-wrap gap-2">
                                                <div>
                                                    <div className="font-mono text-sm font-bold">{p.competencia}</div>
                                                    <div className="text-xs text-slate-500">RBT12 projetado: {formatBRL(p.rbt12Projetado)}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-lg font-bold text-slate-800 dark:text-slate-100">
                                                        {formatBRL(p.dasProvavel)}
                                                    </div>
                                                    <div className="text-xs text-slate-500">
                                                        entre {formatBRL(p.dasMin)} e {formatBRL(p.dasMax)}
                                                    </div>
                                                </div>
                                            </div>
                                            {p.mudancaFaixa && (
                                                <div className="mt-2 text-xs text-red-700 dark:text-red-400 font-bold">
                                                    🚨 ALERTA: {p.mudancaFaixa.mensagem}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Botao IA */}
                            <div className="bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 border border-sky-200 dark:border-sky-800 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-bold text-slate-800 dark:text-slate-100">🤖 Análise IA</h4>
                                    <button
                                        onClick={pedirAnaliseIa}
                                        disabled={loadingIa}
                                        className="btn-press text-xs px-3 py-1.5 bg-sky-600 text-white font-bold rounded hover:bg-sky-700 disabled:opacity-50"
                                    >
                                        {loadingIa ? '⏳ Analisando...' : ia ? '🔄 Regenerar' : '✨ Analisar'}
                                    </button>
                                </div>
                                {ia ? (
                                    <>
                                        <div className="text-sm">{renderMarkdown(ia.analise)}</div>
                                        <div className="text-xs text-slate-400 mt-2 italic">
                                            {ia.modelo} • {new Date(ia.geradoEm).toLocaleString('pt-BR')}
                                        </div>
                                    </>
                                ) : !loadingIa && (
                                    <p className="text-sm text-slate-500 italic">
                                        Clique pra IA explicar a tendência, alertar riscos e sugerir ações.
                                    </p>
                                )}
                            </div>
                        </>
                    )}
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
                    <button onClick={onClose} className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    ), document.body);
};

export default PrevisaoModal;
