/**
 * components/Pgdas/ConferirModal.tsx
 * Modal de Conferencia PGDAS-D vs calculo proprio.
 */
import React, { useState } from 'react';
import type { User, PgdasConferirResponse, PgdasDivergencia, PgdasExplicarResponse } from '../../types';
import { conferirPgdas, explicarDivergencia, severidadeBadge, formatBRL } from '../../services/pgdasConferirService';

interface Props {
    empresaId: string;
    empresaNome: string;
    currentUser: User | null;
    onClose: () => void;
    onShowToast: (msg: string) => void;
}

const ConferirModal: React.FC<Props> = ({ empresaId, empresaNome, currentUser, onClose, onShowToast }) => {
    const [resultado, setResultado] = useState<PgdasConferirResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [arquivoNome, setArquivoNome] = useState<string>('');
    const [divergenciaAtiva, setDivergenciaAtiva] = useState<PgdasDivergencia | null>(null);
    const [analise, setAnalise] = useState<PgdasExplicarResponse | null>(null);
    const [loadingIa, setLoadingIa] = useState(false);

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (!f.name.toLowerCase().endsWith('.pdf')) {
            onShowToast('Apenas PDF do PGDAS-D');
            return;
        }
        setArquivoNome(f.name);
        setLoading(true);
        setResultado(null);
        try {
            const buf = await f.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let bin = '';
            for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
            const base64 = btoa(bin);

            const r = await conferirPgdas(currentUser, empresaId, base64);
            setResultado(r);
        } catch (err: any) {
            onShowToast(`Erro: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const explicar = async (d: PgdasDivergencia) => {
        if (!resultado) return;
        setDivergenciaAtiva(d);
        setAnalise(null);
        setLoadingIa(true);
        try {
            const r = await explicarDivergencia(currentUser, empresaNome, d, resultado.extraido);
            setAnalise(r);
        } catch (e: any) {
            onShowToast(`Erro IA: ${e.message}`);
        } finally {
            setLoadingIa(false);
        }
    };

    const renderMarkdown = (text: string) => {
        return text.split(/\n\n+/).map((b, i) => {
            const html = b.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>');
            return <p key={i} className="mb-2 last:mb-0 text-sm text-slate-700 dark:text-slate-300" dangerouslySetInnerHTML={{ __html: html }} />;
        });
    };

    const fmtCampo = (campo: string, v: any) => {
        if (v === null || v === undefined) return '—';
        if (campo === 'anexoAplicado') return String(v);
        if (typeof v === 'number') {
            if (campo === 'aliquotaEfetiva' || campo === 'fatorR') return v.toFixed(2) + (campo === 'aliquotaEfetiva' ? '%' : '');
            return formatBRL(v);
        }
        return String(v);
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[80]" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-lg font-bold">🔍 Conferência PGDAS-D — {empresaNome}</h3>
                    <p className="text-xs text-slate-500 mt-1">
                        Faça upload do PDF do PGDAS-D. Sistema extrai dados via IA e compara com nossa apuração.
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {/* Upload */}
                    {!resultado && !loading && (
                        <label className="block border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-sky-400 transition-colors">
                            <input type="file" accept=".pdf" onChange={handleFile} className="hidden" />
                            <div className="text-4xl mb-2">📄</div>
                            <div className="font-bold">Clique para selecionar o PDF do PGDAS-D</div>
                            <div className="text-xs text-slate-500 mt-1">Ou arraste o arquivo aqui</div>
                        </label>
                    )}

                    {loading && (
                        <div className="text-center py-12">
                            <div className="text-4xl mb-2">⏳</div>
                            <div className="font-bold">{arquivoNome}</div>
                            <div className="text-sm text-slate-500 mt-2">IA extraindo dados do PGDAS e comparando com sua apuração...</div>
                            <div className="text-xs text-slate-400 mt-1">Pode demorar 10-20 segundos</div>
                        </div>
                    )}

                    {resultado && (
                        <>
                            {/* Resumo */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                                    <div className="text-xs text-slate-500">Competência</div>
                                    <div className="font-bold">{resultado.extraido.competencia || '—'}</div>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                                    <div className="text-xs text-slate-500">DAS no PGDAS</div>
                                    <div className="font-bold">{formatBRL(resultado.extraido.valorDas || 0)}</div>
                                </div>
                                <div className={`rounded-lg p-3 border ${resultado.divergencias.length === 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300' : 'bg-red-50 dark:bg-red-900/20 border-red-300'}`}>
                                    <div className="text-xs text-slate-500">Divergências</div>
                                    <div className="font-bold">
                                        {resultado.divergencias.length === 0 ? '✓ Nenhuma' : `${resultado.divergencias.length} encontrada(s)`}
                                    </div>
                                </div>
                            </div>

                            {/* Validacoes (CNPJ, etc) */}
                            {resultado.validacoes.length > 0 && (
                                <div className="space-y-2">
                                    {resultado.validacoes.map((v, i) => (
                                        <div key={i} className="bg-red-50 dark:bg-red-900/20 border border-red-300 rounded-lg p-3 text-sm">
                                            <span className="font-bold text-red-700">⚠️ {v.tipo}</span>
                                            <div className="text-red-600 mt-1">{v.descricao}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Sem calculo no app */}
                            {!resultado.temCalculoNoApp && (
                                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 rounded-lg p-3 text-sm">
                                    <div className="font-bold text-amber-700">ℹ️ Sem comparação</div>
                                    <div className="text-amber-700 mt-1">
                                        Não há cálculo desta competência no histórico do app. Apure o mês primeiro
                                        para conferir as divergências.
                                    </div>
                                </div>
                            )}

                            {/* Divergencias */}
                            {resultado.divergencias.length > 0 && (
                                <div>
                                    <h4 className="font-bold mb-2">⚠️ Divergências detectadas (clique pra IA explicar)</h4>
                                    <div className="space-y-2">
                                        {resultado.divergencias.map((d, i) => (
                                            <button
                                                key={i}
                                                onClick={() => explicar(d)}
                                                className={`w-full text-left p-3 rounded-lg border transition-colors ${divergenciaAtiva === d ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-sky-300'}`}
                                            >
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${severidadeBadge(d.severidade)}`}>
                                                        {d.severidade.toUpperCase()}
                                                    </span>
                                                    <span className="font-bold text-sm">{d.campo}</span>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2 text-sm mt-2">
                                                    <div>
                                                        <div className="text-xs text-slate-500">No PGDAS</div>
                                                        <div className="font-mono">{fmtCampo(d.campo, d.valorPgdas)}</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-xs text-slate-500">No app</div>
                                                        <div className="font-mono">{fmtCampo(d.campo, d.valorApp)}</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-xs text-slate-500">Diferença</div>
                                                        <div className="font-mono text-red-600">
                                                            {typeof d.diferenca === 'number' ? formatBRL(d.diferenca) : d.diferenca}
                                                            {d.diferencaPct !== null && ` (${d.diferencaPct}%)`}
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* IA explicando divergencia */}
                            {divergenciaAtiva && (
                                <div className="bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 border border-sky-200 dark:border-sky-800 rounded-lg p-4">
                                    <h4 className="font-bold text-sm mb-2">🤖 Análise IA — {divergenciaAtiva.campo}</h4>
                                    {loadingIa && <div className="text-sm text-slate-500 italic">Gemini analisando...</div>}
                                    {analise && (
                                        <>
                                            {renderMarkdown(analise.analise)}
                                            <div className="text-xs text-slate-400 mt-2 italic">
                                                {analise.modelo} • {new Date(analise.geradoEm).toLocaleString('pt-BR')}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Detalhes extraidos (collapsible) */}
                            <details className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                                <summary className="font-bold text-sm cursor-pointer">📋 Dados completos extraídos do PGDAS</summary>
                                <pre className="text-xs mt-3 overflow-x-auto bg-white dark:bg-slate-950 p-2 rounded">
                                    {JSON.stringify(resultado.extraido, null, 2)}
                                </pre>
                            </details>
                        </>
                    )}
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-between flex-wrap gap-2">
                    <div>
                        {resultado && (
                            <button
                                onClick={() => { setResultado(null); setDivergenciaAtiva(null); setAnalise(null); setArquivoNome(''); }}
                                className="text-xs text-sky-600 hover:underline"
                            >
                                ↺ Conferir outro PGDAS
                            </button>
                        )}
                    </div>
                    <button onClick={onClose} className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100">
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConferirModal;
