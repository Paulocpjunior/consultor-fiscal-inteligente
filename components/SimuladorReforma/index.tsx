/**
 * components/SimuladorReforma/index.tsx
 * Simulador IBS/CBS — projeta carga tributaria 2026-2033 por regime.
 */
import React, { useState } from 'react';
import type { User, SimulacaoReforma, SimuladorIaResponse, RegimeReforma } from '../../types';
import { simular, explicarSimulacao, formatBRL } from '../../services/simuladorReformaService';
import SafeMarkdown from '../SafeMarkdown';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const SimuladorReforma: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [faturamentoStr, setFaturamentoStr] = useState('1000000');
    const [regime, setRegime] = useState<RegimeReforma>('Presumido');
    const [dasAnualStr, setDasAnualStr] = useState('');
    const [empresaNome, setEmpresaNome] = useState('');
    const [resultado, setResultado] = useState<SimulacaoReforma | null>(null);
    const [analise, setAnalise] = useState<SimuladorIaResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingIa, setLoadingIa] = useState(false);

    const handleSimular = async () => {
        const fat = parseFloat(faturamentoStr.replace(/\./g, '').replace(',', '.'));
        if (!fat || fat <= 0) { onShowToast?.('Faturamento inválido'); return; }
        const das = parseFloat(dasAnualStr.replace(/\./g, '').replace(',', '.')) || 0;

        setLoading(true);
        setAnalise(null);
        try {
            const r = await simular(currentUser, fat, regime, das);
            setResultado(r);
        } catch (e: any) {
            onShowToast?.(`Erro: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleExplicar = async () => {
        if (!resultado) return;
        setLoadingIa(true);
        try {
            const r = await explicarSimulacao(currentUser, resultado, empresaNome || undefined);
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

    const cargaMax = resultado ? Math.max(...resultado.projecoes.map(p => p.cargaTotal)) : 1;

    return (
        <div className="space-y-5">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">📊 Simulador IBS/CBS</h2>
                <p className="text-sm text-slate-500 mt-1">
                    Projeção de carga tributária 2026-2033 conforme Reforma Tributária (LC 214/2025).
                </p>
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-400">
                ⚠️ <strong>Estimativas:</strong> alíquotas cheias (CBS 8,8% / IBS 17,7%) ainda serão fixadas pelo Senado.
                ICMS/ISS atual e IRPJ/CSLL não estão na simulação. Foco apenas no impacto direto da reforma.
            </div>

            {/* Form */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-5 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label className="text-xs text-slate-500 font-bold block mb-1">EMPRESA (opcional)</label>
                        <input
                            type="text"
                            value={empresaNome}
                            onChange={e => setEmpresaNome(e.target.value)}
                            placeholder="Nome da empresa"
                            className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-slate-500 font-bold block mb-1">FATURAMENTO ANUAL (R$)</label>
                        <input
                            type="text"
                            value={faturamentoStr}
                            onChange={e => setFaturamentoStr(e.target.value.replace(/[^\d.,]/g, ''))}
                            placeholder="1000000"
                            className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-mono"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-slate-500 font-bold block mb-1">REGIME ATUAL</label>
                        <div className="flex gap-1">
                            {(['Simples', 'Presumido', 'Real'] as RegimeReforma[]).map(r => (
                                <button
                                    key={r}
                                    onClick={() => setRegime(r)}
                                    className={`flex-1 text-sm px-2 py-2 rounded font-bold ${regime === r ? 'bg-sky-600 text-white' : 'bg-slate-100 dark:bg-slate-700'}`}
                                >
                                    {r}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {regime === 'Simples' && (
                    <div>
                        <label className="text-xs text-slate-500 font-bold block mb-1">DAS ANUAL ATUAL (R$, opcional)</label>
                        <input
                            type="text"
                            value={dasAnualStr}
                            onChange={e => setDasAnualStr(e.target.value.replace(/[^\d.,]/g, ''))}
                            placeholder="60000"
                            className="w-full md:w-1/3 px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-mono"
                        />
                        <p className="text-xs text-slate-400 mt-1">Pra projeção precisa do Simples Nacional ao longo dos anos.</p>
                    </div>
                )}

                <button
                    onClick={handleSimular}
                    disabled={loading}
                    className="btn-press w-full md:w-auto px-6 py-3 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 disabled:opacity-50"
                >
                    {loading ? '⏳ Calculando...' : '🚀 Simular Reforma 2026-2033'}
                </button>
            </div>

            {/* Resultado */}
            {resultado && (
                <>
                    {/* Tabela ano a ano */}
                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                            <h3 className="font-bold">Projeção 2026-2033 — {resultado.regime}</h3>
                            <p className="text-xs text-slate-500 mt-1">
                                Faturamento base: {formatBRL(resultado.faturamentoAnual)}/ano
                            </p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 dark:bg-slate-900 text-xs">
                                    <tr>
                                        <th className="text-left p-2">Ano</th>
                                        {resultado.regime !== 'Simples' && <>
                                            <th className="text-right p-2">PIS+COFINS</th>
                                            <th className="text-right p-2">CBS</th>
                                            <th className="text-right p-2">IBS</th>
                                            <th className="text-right p-2">Compensação</th>
                                        </>}
                                        <th className="text-right p-2">Carga Total</th>
                                        <th className="text-right p-2">% Faturamento</th>
                                        <th className="text-left p-2">Visual</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {resultado.projecoes.map(p => {
                                        const pct = (p.cargaTotal / cargaMax) * 100;
                                        return (
                                            <tr key={p.ano} className="border-t border-slate-100 dark:border-slate-700">
                                                <td className="p-2 font-bold">{p.ano}</td>
                                                {resultado.regime !== 'Simples' && <>
                                                    <td className="p-2 text-right font-mono">{formatBRL((p.pisAtual || 0) + (p.cofinsAtual || 0) || (p.pisCofinsLiquido || 0))}</td>
                                                    <td className="p-2 text-right font-mono">{formatBRL(p.cbs || 0)}</td>
                                                    <td className="p-2 text-right font-mono">{formatBRL(p.ibs || 0)}</td>
                                                    <td className="p-2 text-right font-mono text-emerald-600">{p.compensacao ? `-${formatBRL(p.compensacao)}` : '—'}</td>
                                                </>}
                                                <td className="p-2 text-right font-mono font-bold">{formatBRL(p.cargaTotal)}</td>
                                                <td className="p-2 text-right text-slate-500">{p.cargaPctFaturamento ? `${p.cargaPctFaturamento}%` : '—'}</td>
                                                <td className="p-2 w-32">
                                                    <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded overflow-hidden">
                                                        <div
                                                            className={`h-full transition-all ${p.ano >= 2027 ? 'bg-amber-500' : 'bg-sky-500'}`}
                                                            style={{ width: `${pct}%` }}
                                                        />
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Premissas */}
                    <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                        <h4 className="font-bold text-sm mb-2">📋 Premissas e Observações</h4>
                        <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                            {Object.entries(resultado.premissas).map(([k, v]) => (
                                <div key={k}>• <strong>{k}:</strong> {v}</div>
                            ))}
                        </div>
                        <div className="border-t border-slate-200 dark:border-slate-700 mt-3 pt-3 text-xs space-y-1">
                            {resultado.observacoes.map((o, i) => (
                                <div key={i} className="text-slate-500">⚠️ {o}</div>
                            ))}
                        </div>
                    </div>

                    {/* Analise IA */}
                    <div className="bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 border border-sky-200 dark:border-sky-800 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                            <h3 className="font-bold">🤖 Análise estratégica com IA</h3>
                            <button
                                onClick={handleExplicar}
                                disabled={loadingIa}
                                className="btn-press text-xs px-3 py-1.5 bg-sky-600 text-white font-bold rounded hover:bg-sky-700 disabled:opacity-50"
                            >
                                {loadingIa ? '⏳ Analisando...' : analise ? '🔄 Regenerar' : '✨ Pedir análise IA'}
                            </button>
                        </div>
                        {loadingIa && !analise && <div className="text-sm text-slate-500 italic">Gemini analisando...</div>}
                        {analise && (
                            <>
                                <div className="text-sm">{renderMarkdown(analise.analise)}</div>
                                <div className="text-xs text-slate-400 mt-3 italic">
                                    {analise.modelo} • {new Date(analise.geradoEm).toLocaleString('pt-BR')}
                                </div>
                            </>
                        )}
                        {!loadingIa && !analise && (
                            <p className="text-sm text-slate-500 italic">
                                Clique em "Pedir análise IA" pra Gemini sugerir ações estratégicas baseadas nesta projeção.
                            </p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default SimuladorReforma;
