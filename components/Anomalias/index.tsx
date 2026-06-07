/**
 * components/Anomalias/index.tsx
 * Detector de Anomalias DAS — visao global de irregularidades detectadas.
 */
import React, { useEffect, useState } from 'react';
import type { User, AnomaliasGlobalResponse, AnomaliasEmpresa, AnomaliaDetectada, AnomaliaIaResponse } from '../../types';
import { getAnomaliasTodas, explicarAnomaliaIa, tipoLabel, severidadeBadge } from '../../services/anomaliasService';
import SafeMarkdown from '../SafeMarkdown';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const AnomaliasView: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [data, setData] = useState<AnomaliasGlobalResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [empresaAberta, setEmpresaAberta] = useState<AnomaliasEmpresa | null>(null);
    const [anomaliaAtiva, setAnomaliaAtiva] = useState<AnomaliaDetectada | null>(null);
    const [analise, setAnalise] = useState<AnomaliaIaResponse | null>(null);
    const [loadingIa, setLoadingIa] = useState(false);
    const [filtroSeveridade, setFiltroSeveridade] = useState<'all' | 'alta' | 'media'>('all');

    const carregar = async () => {
        setLoading(true);
        setErro(null);
        try {
            const r = await getAnomaliasTodas(currentUser);
            setData(r);
        } catch (e: any) {
            setErro(e?.message || 'Erro ao carregar');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, []);

    const explicar = async (a: AnomaliaDetectada) => {
        if (!empresaAberta) return;
        setAnomaliaAtiva(a);
        setAnalise(null);
        setLoadingIa(true);
        try {
            const r = await explicarAnomaliaIa(currentUser, empresaAberta.empresaNome, undefined, a);
            setAnalise(r);
        } catch (e: any) {
            onShowToast?.(`Erro IA: ${e.message}`);
        } finally {
            setLoadingIa(false);
        }
    };

    const renderMarkdown = (text: string) => (
        <SafeMarkdown text={text} className="mb-3 last:mb-0 text-slate-700 dark:text-slate-300" />
    );

    const resultadosFiltrados = data?.resultados.filter(r =>
        filtroSeveridade === 'all' || r.severidadeMax === filtroSeveridade
    ) || [];

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">🔍 Detector de Anomalias</h2>
                    <p className="text-sm text-slate-500 mt-1">
                        Analise estatistica do historico de DAS por empresa. Detecta saltos de faturamento, mudanca de anexo, DAS abaixo do esperado.
                    </p>
                </div>
                <button
                    onClick={carregar}
                    disabled={loading}
                    className="btn-press px-4 py-2 bg-slate-700 text-white font-bold rounded-lg hover:bg-slate-800 disabled:opacity-50"
                >
                    {loading ? '⏳ Analisando...' : '🔄 Atualizar análise'}
                </button>
            </div>

            {erro && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
                    {erro}
                </div>
            )}

            {data && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                        <div className="text-xs text-slate-500">Empresas analisadas</div>
                        <div className="text-2xl font-bold">{data.totalEmpresas}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-amber-300 dark:border-amber-700">
                        <div className="text-xs text-slate-500">Com anomalias</div>
                        <div className="text-2xl font-bold text-amber-600">{data.empresasComAnomalia}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                        <div className="text-xs text-slate-500">Saudáveis</div>
                        <div className="text-2xl font-bold text-emerald-600">{data.totalEmpresas - data.empresasComAnomalia}</div>
                    </div>
                </div>
            )}

            {data && data.resultados.length > 0 && (
                <div className="flex gap-1 text-xs">
                    <button
                        onClick={() => setFiltroSeveridade('all')}
                        className={`px-3 py-1.5 rounded ${filtroSeveridade === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-100 dark:bg-slate-700'}`}
                    >
                        Todas ({data.empresasComAnomalia})
                    </button>
                    <button
                        onClick={() => setFiltroSeveridade('alta')}
                        className={`px-3 py-1.5 rounded ${filtroSeveridade === 'alta' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'}`}
                    >
                        🔴 Alta ({data.resultados.filter(r => r.severidadeMax === 'alta').length})
                    </button>
                    <button
                        onClick={() => setFiltroSeveridade('media')}
                        className={`px-3 py-1.5 rounded ${filtroSeveridade === 'media' ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-700'}`}
                    >
                        🟡 Média ({data.resultados.filter(r => r.severidadeMax === 'media').length})
                    </button>
                </div>
            )}

            {data && data.empresasComAnomalia === 0 && (
                <div className="text-center py-12 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-700">
                    <div className="text-4xl mb-2">✨</div>
                    <h3 className="text-lg font-bold text-emerald-700 dark:text-emerald-300">Nenhuma anomalia detectada</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        Todas as empresas estão dentro dos padrões esperados.
                    </p>
                </div>
            )}

            <div className="space-y-2">
                {resultadosFiltrados.map(r => (
                    <button
                        key={r.empresaId}
                        onClick={() => setEmpresaAberta(r)}
                        className="w-full text-left p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-400 transition-colors"
                    >
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-3">
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${severidadeBadge(r.severidadeMax)}`}>
                                    {r.severidadeMax === 'alta' ? '🔴 ALTA' : '🟡 MÉDIA'}
                                </span>
                                <div>
                                    <div className="font-bold text-slate-800 dark:text-slate-100">{r.empresaNome}</div>
                                    <div className="text-xs text-slate-500">{r.empresaCnpj}</div>
                                </div>
                            </div>
                            <div className="text-sm">
                                <span className="font-bold text-amber-600">{r.qtdAnomalias}</span>
                                <span className="text-slate-500 ml-1">anomalia{r.qtdAnomalias > 1 ? 's' : ''}</span>
                            </div>
                        </div>
                        <div className="mt-2 flex gap-1 flex-wrap">
                            {r.anomalias.slice(0, 3).map((a, i) => (
                                <span key={i} className="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                                    {tipoLabel(a.tipo)}
                                </span>
                            ))}
                        </div>
                    </button>
                ))}
            </div>

            {/* Modal detalhe da empresa */}
            {empresaAberta && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[80]" onClick={() => { setEmpresaAberta(null); setAnomaliaAtiva(null); setAnalise(null); }}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-slate-200 dark:border-slate-700">
                            <h3 className="text-lg font-bold">🔍 {empresaAberta.empresaNome}</h3>
                            <p className="text-xs text-slate-500 mt-1">
                                {empresaAberta.qtdAnomalias} anomalia(s) detectada(s) — clique numa pra IA explicar
                            </p>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 space-y-3">
                            {empresaAberta.anomalias.map((a, i) => (
                                <div key={i} className={`rounded-lg border p-3 cursor-pointer ${anomaliaAtiva === a ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-sky-300'}`}
                                     onClick={() => explicar(a)}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${severidadeBadge(a.severidade)}`}>
                                            {a.severidade.toUpperCase()}
                                        </span>
                                        <span className="text-sm font-bold">{tipoLabel(a.tipo)}</span>
                                        <span className="text-xs text-slate-400 ml-auto">{a.competencia}</span>
                                    </div>
                                    <div className="text-sm text-slate-700 dark:text-slate-300">
                                        {a.descricao}
                                    </div>
                                    <div className="text-xs text-slate-400 mt-1">
                                        {Object.entries(a.dados).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                                    </div>
                                </div>
                            ))}

                            {/* IA */}
                            {anomaliaAtiva && (
                                <div className="bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 border border-sky-200 dark:border-sky-800 rounded-lg p-4 mt-4">
                                    <h4 className="font-bold text-sm mb-2">🤖 Análise IA — {tipoLabel(anomaliaAtiva.tipo)}</h4>
                                    {loadingIa && <div className="text-sm text-slate-500 italic">Gemini analisando...</div>}
                                    {analise && (
                                        <>
                                            <div className="text-sm">{renderMarkdown(analise.analise)}</div>
                                            <div className="text-xs text-slate-400 mt-2 italic">
                                                {analise.modelo} • {new Date(analise.geradoEm).toLocaleString('pt-BR')}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
                            <button
                                onClick={() => { setEmpresaAberta(null); setAnomaliaAtiva(null); setAnalise(null); }}
                                className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100"
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AnomaliasView;
