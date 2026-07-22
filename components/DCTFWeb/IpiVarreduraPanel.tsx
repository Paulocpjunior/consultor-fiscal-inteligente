/**
 * IpiVarreduraPanel — varredura de IPI por competência (motivação: Experte
 * 06/2026). Fase 1 (local, grátis): quem tem IPI apurado na ficha. Fase 2
 * (botão, consulta SERPRO): o MIT de cada uma tem mês-modelo com IPI?
 *   - pronta            → preenchimento automático transmite sozinho
 *   - precisa_lancamento→ lançar IPI 1x no e-CAC (vira modelo)
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    getIpiVarredura,
    type IpiVarreduraResposta, type IpiVarreduraLinha,
} from '../../services/ipiVarreduraService';

interface Props { onShowToast?: (msg: string) => void; }

const brl = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

const competenciaDefault = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1); // competência sendo declarada agora
    return d.toISOString().slice(0, 7);
};

const CORES: Record<string, { badge: string; label: string }> = {
    pronta: { badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', label: '✅ Pronta' },
    precisa_lancamento: { badge: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', label: '🔴 Lançar 1x no e-CAC' },
    erro_consulta: { badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', label: '⚠️ Erro na consulta' },
    verificar_mit: { badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300', label: '🔎 Verificar MIT' },
    sem_ipi: { badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400', label: 'Sem IPI' },
};

const IpiVarreduraPanel: React.FC<Props> = ({ onShowToast }) => {
    const [competencia, setCompetencia] = useState(competenciaDefault());
    const [data, setData] = useState<IpiVarreduraResposta | null>(null);
    const [loading, setLoading] = useState(false);
    const [consultandoMit, setConsultandoMit] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const carregar = async (consultarMit: boolean) => {
        consultarMit ? setConsultandoMit(true) : setLoading(true);
        setErro(null);
        try {
            const r = await getIpiVarredura(competencia, consultarMit);
            setData(r);
            if (consultarMit) {
                onShowToast?.(`Varredura MIT concluída: ${r.resumo.pronta} pronta(s), ${r.resumo.precisaLancamento} precisando de lançamento no e-CAC.`);
            }
        } catch (e: any) {
            setErro(e?.message || 'Falha ao carregar');
        } finally {
            setLoading(false); setConsultandoMit(false);
        }
    };
    useEffect(() => { carregar(false); /* eslint-disable-next-line */ }, [competencia]);

    const linhas = useMemo(() => data?.linhas || [], [data]);
    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>🏭 Varredura de IPI</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Empresas Lucro com <b>IPI apurado</b> na competência e o que falta para o MIT
                    transmitir sozinho. <b>Pronta</b> = já existe mês-modelo com IPI no MIT (o app monta
                    e transmite). <b>Lançar 1x no e-CAC</b> = primeiro IPI da empresa — lance manualmente
                    uma vez; a partir do mês seguinte o app assume (caso Experte 06/2026).
                </p>
                {data && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
                        <Kpi label="Com IPI na competência" value={String(data.resumo.comIpi)} />
                        <Kpi label="IPI total apurado" value={brl(data.resumo.ipiTotalApurado)} />
                        <Kpi label="Prontas" value={String(data.resumo.pronta)} accent={data.resumo.pronta > 0 ? 'success' : undefined} />
                        <Kpi label="Precisam e-CAC 1x" value={String(data.resumo.precisaLancamento)} accent={data.resumo.precisaLancamento > 0 ? 'danger' : 'success'} />
                        <Kpi label="IPI em risco" value={brl(data.resumo.ipiTotalEmRisco)} accent={data.resumo.ipiTotalEmRisco > 0 ? 'danger' : 'success'} />
                    </div>
                )}
            </div>

            <div className="p-4 rounded-xl flex flex-wrap items-center gap-3" style={card}>
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Competência:</label>
                <input
                    type="month" value={competencia}
                    onChange={e => setCompetencia(e.target.value)}
                    className="px-3 py-1.5 text-sm border rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-slate-600"
                />
                <button
                    onClick={() => carregar(true)}
                    disabled={consultandoMit || loading || (data?.resumo.comIpi || 0) === 0}
                    title="Consulta o MIT (SERPRO) das empresas com IPI — 2 chamadas por empresa"
                    className="px-3 py-1.5 text-sm font-semibold bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
                >
                    {consultandoMit ? '⏳ Consultando MIT…' : '🔎 Verificar modelo no MIT (SERPRO)'}
                </button>
                <button
                    onClick={() => carregar(false)}
                    disabled={loading || consultandoMit}
                    className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-800 dark:text-gray-100 rounded"
                >
                    ↻ Atualizar
                </button>
                {data && (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {data.consultouMit ? 'Com consulta ao MIT' : 'Somente fase local (ficha) — sem SERPRO'} · gerado {new Date(data.geradoEm).toLocaleString('pt-BR')}
                    </span>
                )}
            </div>

            {erro && (
                <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-800 px-3 py-2 text-sm text-red-800 dark:text-red-300">{erro}</div>
            )}
            {loading && <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Carregando…</div>}

            {!loading && data && linhas.length === 0 && (
                <div className="p-6 text-center text-sm rounded-xl" style={card}>
                    Nenhuma empresa Lucro com IPI apurado em {competencia}. 🎉
                </div>
            )}

            {!loading && linhas.length > 0 && (
                <div className="rounded-xl overflow-x-auto" style={card}>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                                <th className="px-4 py-2">Empresa</th>
                                <th className="px-4 py-2">Regime</th>
                                <th className="px-4 py-2 text-right">IPI apurado</th>
                                <th className="px-4 py-2">Status</th>
                                <th className="px-4 py-2">Modelo</th>
                                <th className="px-4 py-2">Ação</th>
                            </tr>
                        </thead>
                        <tbody>
                            {linhas.map((l: IpiVarreduraLinha) => {
                                const cor = CORES[l.status] || CORES.sem_ipi;
                                return (
                                    <tr key={l.cnpj} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                                        <td className="px-4 py-2">
                                            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{l.nome}</div>
                                            <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{fmtCnpj(l.cnpj)}</div>
                                        </td>
                                        <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>{l.regime}</td>
                                        <td className="px-4 py-2 text-right font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{brl(l.ipiApurado)}</td>
                                        <td className="px-4 py-2">
                                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cor.badge}`}>{cor.label}</span>
                                        </td>
                                        <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                            {l.modeloPeriodo || (l.temModeloIpi === false ? '—' : '?')}
                                        </td>
                                        <td className="px-4 py-2 text-xs max-w-md" style={{ color: 'var(--text-secondary)' }}>{l.acao}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

const Kpi: React.FC<{ label: string; value: string; accent?: 'danger' | 'success' | 'warning' }> = ({ label, value, accent }) => (
    <div className="p-3 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
        <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</div>
        <div className={`text-lg font-bold ${
            accent === 'danger' ? 'text-red-600 dark:text-red-400'
            : accent === 'success' ? 'text-emerald-600 dark:text-emerald-400'
            : accent === 'warning' ? 'text-amber-600 dark:text-amber-400' : ''
        }`} style={accent ? undefined : { color: 'var(--text-primary)' }}>{value}</div>
    </div>
);

export default IpiVarreduraPanel;
