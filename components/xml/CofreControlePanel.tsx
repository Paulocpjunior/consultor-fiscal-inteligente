import React, { useState } from 'react';
import { historicoCofre, pendenciasCofre, arquivarSharePoint, type CofreHistoricoResultado, type CofrePendenciasResultado, type ArquivoSpResultado } from '../../services/saeNfceService';

/**
 * CofreControlePanel — painel de controle do cofre de e-mail (Fase 1).
 * KPIs (saída/entrada hoje e no mês), série diária, pendências ao vivo
 * (e-mails travados sem .xml) e histórico das execuções.
 */
const fmtData = (ms: number | null | undefined) => {
    if (!ms) return '—';
    try { return new Date(ms).toLocaleString('pt-BR'); } catch { return '—'; }
};

const Kpi: React.FC<{ label: string; saida: number; entrada: number; erros?: number }> = ({ label, saida, entrada, erros }) => (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex-1 min-w-[120px]">
        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase">{label}</p>
        <p className="text-sm mt-1">
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">{saida}</span> saída ·{' '}
            <span className="text-slate-600 dark:text-slate-300">{entrada}</span> entrada
            {erros ? <span className="text-red-500"> · {erros} erro</span> : null}
        </p>
    </div>
);

const CofreControlePanel: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [hist, setHist] = useState<CofreHistoricoResultado | null>(null);
    const [pend, setPend] = useState<CofrePendenciasResultado | null>(null);
    const [spLoading, setSpLoading] = useState(false);
    const [sp, setSp] = useState<ArquivoSpResultado | null>(null);

    const arquivar = async () => {
        setSpLoading(true);
        setSp(null);
        try {
            setSp(await arquivarSharePoint());
        } catch (e) {
            setSp({ ok: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
            setSpLoading(false);
        }
    };

    const carregar = async () => {
        setLoading(true);
        try {
            const [h, p] = await Promise.all([historicoCofre(60), pendenciasCofre()]);
            setHist(h); setPend(p);
        } catch (e) {
            setHist({ ok: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
            setLoading(false);
        }
    };

    const kpis = hist?.kpis;
    const maxDia = Math.max(1, ...(kpis?.porDia || []).map((d) => d.saida + d.entrada));

    return (
        <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">📊 Cofre CFI — controle</h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">KPIs, pendências e histórico das leituras da caixa.</p>
                </div>
                <button onClick={carregar} disabled={loading}
                    className="px-3 py-1.5 text-xs font-bold rounded-md bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200">
                    {loading ? 'Carregando…' : 'Atualizar painel'}
                </button>
            </div>

            {hist && !hist.ok && <p className="text-xs text-red-600 dark:text-red-400">{hist.error || 'Falha ao carregar.'}</p>}

            {kpis && (
                <>
                    <div className="flex flex-wrap gap-2">
                        <Kpi label="Hoje" saida={kpis.hoje.saida} entrada={kpis.hoje.entrada} erros={kpis.hoje.erros} />
                        <Kpi label="Mês" saida={kpis.mes.saida} entrada={kpis.mes.entrada} erros={kpis.mes.erros} />
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex-1 min-w-[140px]">
                            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase">Última leitura</p>
                            <p className="text-xs mt-1 text-slate-600 dark:text-slate-300">{fmtData(kpis.ultimaExecMs)}</p>
                            <p className="text-[11px] text-slate-400">{kpis.total.execucoes} execuções · {kpis.total.saida} saídas no total</p>
                        </div>
                    </div>

                    {/* Série diária (14 dias) — barras simples saída+entrada */}
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Últimos 14 dias</p>
                        <div className="flex items-end gap-1 h-20">
                            {kpis.porDia.map((d) => (
                                <div key={d.dia} className="flex-1 flex flex-col items-center justify-end" title={`${d.dia}: ${d.saida} saída, ${d.entrada} entrada`}>
                                    <div className="w-full bg-emerald-500/80 rounded-t" style={{ height: `${(d.saida / maxDia) * 100}%` }} />
                                    <div className="w-full bg-slate-400/60" style={{ height: `${(d.entrada / maxDia) * 100}%` }} />
                                    <span className="text-[8px] text-slate-400 mt-0.5">{d.dia.slice(8)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {/* Pendências ao vivo */}
            {pend && pend.ok && (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                        Pendências na caixa: {pend.total ?? 0}
                        {(pend.total ?? 0) === 0 && <span className="text-emerald-600 dark:text-emerald-400"> — nada travado ✓</span>}
                    </p>
                    {(pend.pendencias || []).length > 0 && (
                        <ul className="mt-1 text-[11px] text-amber-600 dark:text-amber-400 space-y-0.5 max-h-40 overflow-y-auto">
                            {(pend.pendencias || []).map((p, i) => (
                                <li key={i}>
                                    <strong>{p.assunto}</strong>{p.from ? ` — ${p.from}` : ''} <span className="font-mono">[{p.anexos.join(', ')}]</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
            {pend && !pend.ok && <p className="text-xs text-red-600 dark:text-red-400">Pendências: {pend.error}</p>}

            {/* Arquivo no SharePoint (Fase 3) */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                        <p className="text-xs font-bold text-slate-600 dark:text-slate-300">🗄️ Arquivo no SharePoint</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Sobe os XMLs do cofre pra pasta do cliente (automático a cada dia útil). Este botão força agora.</p>
                    </div>
                    <button onClick={arquivar} disabled={spLoading}
                        className="px-3 py-1.5 text-xs font-bold rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white whitespace-nowrap">
                        {spLoading ? 'Arquivando…' : 'Arquivar agora'}
                    </button>
                </div>
                {sp && !sp.ok && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{sp.error || 'Falha ao arquivar.'}</p>}
                {sp && sp.ok && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                        ✓ <span className="text-indigo-600 dark:text-indigo-400 font-bold">{sp.arquivados ?? 0}</span> arquivados de {sp.candidatos ?? 0} ·
                        {' '}{sp.semConfig ?? 0} sem config SharePoint · {sp.erros ?? 0} erros
                        {(sp.errosDetalhe?.length ?? 0) > 0 && (
                            <ul className="list-disc list-inside mt-0.5 text-[11px] text-red-500 font-mono">
                                {(sp.errosDetalhe || []).slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                            </ul>
                        )}
                    </p>
                )}
            </div>

            {/* Histórico das execuções */}
            {hist?.runs && hist.runs.length > 0 && (
                <details className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                    <summary className="text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">Histórico das leituras ({hist.runs.length})</summary>
                    <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-[11px]">
                            <thead className="text-slate-400 text-left">
                                <tr><th className="pr-3">Quando</th><th className="pr-3">Saída</th><th className="pr-3">Entrada</th><th className="pr-3">Erros</th><th>Origem</th></tr>
                            </thead>
                            <tbody className="text-slate-600 dark:text-slate-300">
                                {hist.runs.map((r, i) => (
                                    <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                                        <td className="pr-3 py-0.5">{fmtData(r.ranAtMs)}</td>
                                        <td className="pr-3">{r.saida}</td>
                                        <td className="pr-3">{r.entrada}</td>
                                        <td className="pr-3">{r.erros ? <span className="text-red-500">{r.erros}</span> : 0}</td>
                                        <td className="text-slate-400">{r.origem || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
            )}
        </div>
    );
};

export default CofreControlePanel;
