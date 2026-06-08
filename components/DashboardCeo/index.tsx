/**
 * components/DashboardCeo/index.tsx
 * Dashboard CEO — visao executiva unificada.
 *
 * KPIs vindos de Caixa Postal, DAS, NFSe, Apuracoes.
 * Insights IA via Gemini (rota backend).
 */
import React, { useEffect, useState } from 'react';
import type { User, DashboardCeoKpis, DashboardCeoInsights, AcoesResponse, AcaoPendente, SearchType } from '../../types';
import { getKpis, getInsights, getAcoes, urgenciaBadgeClass, urgenciaIcon, tipoIcon, formatBRL } from '../../services/dashboardCeoService';
import CobrancaModal from '../Das/CobrancaModal';
import SafeMarkdown from '../SafeMarkdown';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
    onNavigateTo?: (target: 'caixa-postal' | 'das' | 'nfse' | 'apuracoes') => void;
}

const DashboardCeo: React.FC<Props> = ({ currentUser, onShowToast, onNavigateTo }) => {
    const [kpis, setKpis] = useState<DashboardCeoKpis | null>(null);
    const [insights, setInsights] = useState<DashboardCeoInsights | null>(null);
    const [loadingKpis, setLoadingKpis] = useState(false);
    const [loadingInsights, setLoadingInsights] = useState(false);
    const [acoes, setAcoes] = useState<AcoesResponse | null>(null);
    const [loadingAcoes, setLoadingAcoes] = useState(false);
    const [filtroAcao, setFiltroAcao] = useState<'all' | 'alta' | 'media' | 'baixa'>('all');
    const [cobrancaAlvo, setCobrancaAlvo] = useState<{ empresaCnpj: string; empresaNome: string; valor: number } | null>(null);
    const [erro, setErro] = useState<string | null>(null);

    const carregarAcoes = async () => {
        setLoadingAcoes(true);
        try {
            const r = await getAcoes(currentUser);
            setAcoes(r);
        } catch (e: any) {
            console.warn('Falha ao carregar acoes:', e?.message);
        } finally {
            setLoadingAcoes(false);
        }
    };

    const carregarKpis = async () => {
        setLoadingKpis(true);
        setErro(null);
        try {
            const r = await getKpis(currentUser);
            setKpis(r);
        } catch (e: any) {
            setErro(e?.message || 'Erro ao carregar KPIs');
        } finally {
            setLoadingKpis(false);
        }
    };

    const gerarInsights = async () => {
        if (!kpis) return;
        setLoadingInsights(true);
        try {
            const r = await getInsights(currentUser, kpis);
            setInsights(r);
        } catch (e: any) {
            onShowToast?.(`Erro IA: ${e.message}`);
        } finally {
            setLoadingInsights(false);
        }
    };

    useEffect(() => { carregarKpis(); carregarAcoes(); }, []);

    // Auto-gera insights quando KPIs carregam pela primeira vez
    useEffect(() => {
        if (kpis && !insights && !loadingInsights) {
            gerarInsights();
        }
    }, [kpis]);

    // ─── Render insights formatados (parse markdown simples) ──────────────
    const renderInsights = (text: string) => (
        <SafeMarkdown text={text} className="mb-3 last:mb-0 text-slate-700 dark:text-slate-300" />
    );

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">📊 Dashboard CEO</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Visão executiva unificada — empresas, obrigações pendentes, riscos fiscais
                    </p>
                </div>
                <button
                    onClick={() => { carregarKpis(); carregarAcoes(); setInsights(null); }}
                    disabled={loadingKpis}
                    className="btn-press px-4 py-2 bg-slate-700 text-white font-bold rounded-lg hover:bg-slate-800 disabled:opacity-50"
                >
                    {loadingKpis ? '⏳ Atualizando...' : '🔄 Atualizar'}
                </button>
            </div>

            {erro && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{erro}</div>
            )}

            {loadingKpis && !kpis && (
                <div className="text-center py-12 text-slate-500">Carregando KPIs...</div>
            )}

            {kpis && (
                <>
                    {/* Faixa de KPI principal */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <button
                            onClick={() => onNavigateTo?.('caixa-postal')}
                            className={`text-left p-4 rounded-lg border-2 transition-all ${
                                kpis.caixaPostal.empresasComCriticas > 0
                                    ? 'border-red-300 bg-red-50 dark:bg-red-900/20'
                                    : 'border-slate-200 bg-white dark:bg-slate-800'
                            } hover:border-red-400`}
                        >
                            <div className="text-xs text-slate-500 mb-1">📬 CAIXA POSTAL</div>
                            <div className="text-3xl font-bold text-red-700 dark:text-red-400">
                                {kpis.caixaPostal.naoLidasCriticas}
                            </div>
                            <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                mensagens críticas em <strong>{kpis.caixaPostal.empresasComCriticas}</strong> empresas
                            </div>
                        </button>

                        <button
                            onClick={() => onNavigateTo?.('das')}
                            className={`text-left p-4 rounded-lg border-2 transition-all ${
                                kpis.das.vencidos > 0
                                    ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/20'
                                    : 'border-slate-200 bg-white dark:bg-slate-800'
                            } hover:border-amber-400`}
                        >
                            <div className="text-xs text-slate-500 mb-1">💸 DAS VENCIDOS</div>
                            <div className="text-3xl font-bold text-amber-700 dark:text-amber-400">
                                {kpis.das.vencidos}
                            </div>
                            <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                {formatBRL(kpis.das.valorVencido)} em <strong>{kpis.das.empresasComVencido}</strong> empresas
                            </div>
                        </button>

                        <button
                            onClick={() => onNavigateTo?.('nfse')}
                            className="text-left p-4 rounded-lg border-2 border-slate-200 bg-white dark:bg-slate-800 hover:border-sky-400 transition-all"
                        >
                            <div className="text-xs text-slate-500 mb-1">📑 NFS-e MÊS</div>
                            <div className="text-3xl font-bold text-sky-700 dark:text-sky-400">
                                {kpis.nfse.mesAtual}
                            </div>
                            <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                ISS {formatBRL(kpis.nfse.issTotal)}
                            </div>
                        </button>

                        <button
                            onClick={() => onNavigateTo?.('apuracoes')}
                            className={`text-left p-4 rounded-lg border-2 transition-all ${
                                kpis.apuracoes.pendentes > 0
                                    ? 'border-purple-300 bg-purple-50 dark:bg-purple-900/20'
                                    : 'border-slate-200 bg-white dark:bg-slate-800'
                            } hover:border-purple-400`}
                        >
                            <div className="text-xs text-slate-500 mb-1">📊 APURAÇÕES</div>
                            <div className="text-3xl font-bold text-purple-700 dark:text-purple-400">
                                {kpis.apuracoes.pendentes}
                            </div>
                            <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                empresas sem cálculo do mês
                            </div>
                        </button>
                    </div>

                    {/* Empresas atendidas */}
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-500">🏢 Total de empresas atendidas</span>
                            <span className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                                {kpis.totalEmpresas}
                            </span>
                        </div>
                    </div>

                    {/* ─── KPIs novos: cobertura PGDAS/DCTFWeb + sublimite ──── */}
                    {(kpis.cobertura || kpis.sublimite) && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {kpis.cobertura && (
                                <>
                                    <div className="p-4 rounded-lg border-2 border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700">
                                        <div className="text-xs text-slate-500 mb-1">📋 PGDAS-D (ref. {kpis.cobertura.mesAnterior})</div>
                                        <div className="text-3xl font-bold text-amber-700 dark:text-amber-400">
                                            {kpis.cobertura.pgdasPendentes}<span className="text-base font-normal text-slate-500">/{kpis.cobertura.pgdasTotal}</span>
                                        </div>
                                        <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                            Simples sem PGDAS no mês anterior
                                        </div>
                                    </div>
                                    <div className="p-4 rounded-lg border-2 border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700">
                                        <div className="text-xs text-slate-500 mb-1">📋 DCTFWeb (ref. {kpis.cobertura.mesAnterior})</div>
                                        <div className="text-3xl font-bold text-amber-700 dark:text-amber-400">
                                            {kpis.cobertura.dctfwebPendentes}<span className="text-base font-normal text-slate-500">/{kpis.cobertura.dctfwebTotal}</span>
                                        </div>
                                        <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                            Lucro sem DCTFWeb no mês anterior
                                        </div>
                                    </div>
                                </>
                            )}
                            {kpis.sublimite && (
                                <div className={`p-4 rounded-lg border-2 ${
                                    kpis.sublimite.tetoUltrapassou > 0 || kpis.sublimite.sublimiteUltrapassou > 0
                                        ? 'border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700'
                                        : (kpis.sublimite.tetoCritico + kpis.sublimite.sublimiteCritico) > 0
                                            ? 'border-orange-300 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-700'
                                            : 'border-slate-200 bg-white dark:bg-slate-800'
                                }`}>
                                    <div className="text-xs text-slate-500 mb-1">⚠ SUBLIMITE Simples</div>
                                    <div className="text-3xl font-bold text-red-700 dark:text-red-400">
                                        {kpis.sublimite.tetoUltrapassou + kpis.sublimite.sublimiteUltrapassou}
                                    </div>
                                    <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                        ultrapassaram + {kpis.sublimite.tetoCritico + kpis.sublimite.sublimiteCritico} em estado crítico
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Painel de Acao */}
                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-wrap gap-2">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                                    🎯 Painel de Ação
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    O que precisa ser feito hoje, priorizado por urgência
                                </p>
                            </div>
                            {acoes && (
                                <div className="flex gap-1 text-xs">
                                    <button
                                        onClick={() => setFiltroAcao('all')}
                                        className={`px-2.5 py-1 rounded ${filtroAcao === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
                                    >
                                        Todas ({acoes.totalAcoes})
                                    </button>
                                    <button
                                        onClick={() => setFiltroAcao('alta')}
                                        className={`px-2.5 py-1 rounded ${filtroAcao === 'alta' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'}`}
                                    >
                                        🔴 Alta ({acoes.porUrgencia.alta})
                                    </button>
                                    <button
                                        onClick={() => setFiltroAcao('media')}
                                        className={`px-2.5 py-1 rounded ${filtroAcao === 'media' ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-700'}`}
                                    >
                                        🟡 Média ({acoes.porUrgencia.media})
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="max-h-96 overflow-y-auto">
                            {loadingAcoes && !acoes && (
                                <div className="p-6 text-center text-slate-500 text-sm">Carregando ações...</div>
                            )}

                            {acoes && acoes.acoes.length === 0 && (
                                <div className="p-6 text-center text-slate-500 text-sm">
                                    ✨ Nenhuma ação pendente. Tudo em dia!
                                </div>
                            )}

                            {acoes && acoes.acoes
                                .filter(a => filtroAcao === 'all' || a.urgencia === filtroAcao)
                                .map((a, idx) => (
                                <div
                                    key={idx}
                                    className="w-full p-3 border-b border-slate-100 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex items-stretch"
                                >
                                <button
                                    onClick={() => {
                                        if (a.modulo === 'caixa-postal') onNavigateTo?.('caixa-postal');
                                        else if (a.modulo === 'das') onNavigateTo?.('das');
                                        else if (a.modulo === 'simples') onNavigateTo?.('apuracoes');
                                        else if (a.modulo === 'nfse') onNavigateTo?.('nfse');
                                    }}
                                    className="flex-1 text-left"
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="flex-shrink-0 text-xl">
                                            {tipoIcon(a.tipo)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${urgenciaBadgeClass(a.urgencia)}`}>
                                                    {urgenciaIcon(a.urgencia)} {a.urgencia.toUpperCase()}
                                                </span>
                                                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                                                    {a.empresaNome || a.empresaCnpj}
                                                </span>
                                            </div>
                                            <div className="text-sm text-slate-700 dark:text-slate-300 mt-1">
                                                {a.titulo}
                                            </div>
                                            <div className="text-xs text-slate-500 mt-0.5">
                                                {a.descricao}
                                            </div>
                                        </div>
                                        <div className="flex-shrink-0 text-xs text-sky-600 font-bold">
                                            {a.acao} →
                                        </div>
                                    </div>
                                </button>
                                {a.tipo === 'das-vencido' && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setCobrancaAlvo({ empresaCnpj: a.empresaCnpj, empresaNome: a.empresaNome || a.empresaCnpj, valor: 0 }); }}
                                        className="ml-2 px-3 py-1 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded text-xs font-bold flex-shrink-0 self-center"
                                        title="Gerar cobrança com IA"
                                    >
                                        📨 Cobrar
                                    </button>
                                )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Insights IA */}
                    <div className="bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 border border-sky-200 dark:border-sky-800 rounded-lg p-5">
                        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                                🤖 Análise da semana — Recomendações IA
                            </h3>
                            <button
                                onClick={gerarInsights}
                                disabled={loadingInsights}
                                className="btn-press text-xs px-3 py-1.5 bg-sky-600 text-white font-bold rounded hover:bg-sky-700 disabled:opacity-50"
                            >
                                {loadingInsights ? '⏳ Pensando...' : insights ? '🔄 Regenerar' : '✨ Gerar'}
                            </button>
                        </div>

                        {loadingInsights && !insights && (
                            <div className="text-sm text-slate-500 italic">
                                Gemini analisando seus KPIs...
                            </div>
                        )}

                        {insights && (
                            <>
                                <div className="text-sm prose prose-sm max-w-none">
                                    {renderInsights(insights.insights)}
                                </div>
                                <div className="text-xs text-slate-400 mt-3 italic">
                                    Gerado em {new Date(insights.geradoEm).toLocaleString('pt-BR')} • modelo {insights.modelo}
                                </div>
                            </>
                        )}

                        {!loadingInsights && !insights && !erro && (
                            <p className="text-sm text-slate-500 italic">
                                Clique em "Gerar" pra IA analisar os KPIs e dar recomendações priorizadas.
                            </p>
                        )}
                    </div>
                </>
            )}

            {cobrancaAlvo && (
                <CobrancaModal
                    dasInfo={cobrancaAlvo}
                    currentUser={currentUser}
                    onClose={() => setCobrancaAlvo(null)}
                    onShowToast={(m) => onShowToast?.(m)}
                />
            )}
        </div>
    );
};

export default DashboardCeo;
