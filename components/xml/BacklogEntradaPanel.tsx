/**
 * BacklogEntradaPanel — por empresa: NF-e de entrada completas × resumos
 * pendentes de ciência × travadas (NSU). Termômetro do "substituir a SIEG".
 *
 *   travada            → nsuTravado/pendenciaNSU no sefaz_state — investigar
 *   pendente-ciencia   → resumos sem manifestação — o manifesto-cron resolve
 *   aguardando-completa→ ciência feita; completa chega no próximo ciclo
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    getBacklogEntrada,
    type BacklogEntradaResposta, type BacklogEntradaStatus,
} from '../../services/backlogEntradaService';

const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtQuando = (ms: number | null) => {
    if (!ms) return '—';
    const min = Math.floor((Date.now() - ms) / 60000);
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h}h`;
    return `há ${Math.floor(h / 24)}d`;
};

const BADGES: Record<BacklogEntradaStatus, { cls: string; label: string }> = {
    travada: { cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', label: '🔴 Travada (NSU)' },
    'pendente-ciencia': { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', label: '🟠 Pendente de ciência' },
    'aguardando-completa': { cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300', label: '🔵 Aguardando completa' },
    'sem-captura': { cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400', label: 'Sem captura' },
    ok: { cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', label: '✅ OK' },
};

type Filtro = 'atencao' | BacklogEntradaStatus | 'todas';

const BacklogEntradaPanel: React.FC = () => {
    const [data, setData] = useState<BacklogEntradaResposta | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<Filtro>('atencao');
    const [busca, setBusca] = useState('');

    const carregar = async () => {
        setLoading(true); setErro(null);
        try { setData(await getBacklogEntrada()); }
        catch (e: any) { setErro(e?.message || 'Falha ao carregar'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, []);

    const linhas = useMemo(() => {
        if (!data) return [];
        const q = busca.trim().toLowerCase();
        const qNum = q.replace(/\D/g, '');
        return data.linhas.filter(l => {
            if (q) return l.nome.toLowerCase().includes(q) || (qNum && l.cnpj.includes(qNum));
            if (filtro === 'todas') return true;
            if (filtro === 'atencao') return l.status === 'travada' || l.status === 'pendente-ciencia';
            return l.status === filtro;
        });
    }, [data, filtro, busca]);

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>📥 Backlog de Entrada</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Por empresa: NF-e de entrada <b>completas</b> × <b>resumos pendentes de Ciência</b> ×
                    <b> travadas</b> (NSU preso/pendência na SEFAZ). Resumos manifestados viram completas
                    no próximo ciclo; pendentes o <b>manifesto-cron</b> resolve; travadas pedem investigação.
                </p>
                {data && (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-4">
                        <Kpi label="Docs de entrada" value={String(data.resumo.totalDocs)} />
                        <Kpi label="Completas" value={String(data.resumo.totalCompletas)} accent="success" />
                        <Kpi label="Resumos pendentes" value={String(data.resumo.totalResumosPendentes)} accent={data.resumo.totalResumosPendentes > 0 ? 'warning' : 'success'} />
                        <Kpi label="Manifestados (aguard.)" value={String(data.resumo.totalResumosManifestados)} />
                        <Kpi label="Empresas travadas" value={String(data.resumo.travadas)} accent={data.resumo.travadas > 0 ? 'danger' : 'success'} />
                        <Kpi label="Fora do prazo (>180d)" value={String(data.resumo.totalResumosForaPrazo)} accent={data.resumo.totalResumosForaPrazo > 0 ? 'danger' : 'success'} />
                    </div>
                )}
            </div>

            <div className="p-4 rounded-xl flex flex-wrap items-center gap-3" style={card}>
                <select
                    value={filtro} onChange={e => setFiltro(e.target.value as Filtro)}
                    className="px-3 py-1.5 text-sm border rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-slate-600"
                >
                    <option value="atencao">🚨 Precisam de atenção (travadas + pendentes)</option>
                    <option value="travada">🔴 Travadas (NSU)</option>
                    <option value="pendente-ciencia">🟠 Pendentes de ciência</option>
                    <option value="aguardando-completa">🔵 Aguardando completa</option>
                    <option value="ok">✅ OK</option>
                    <option value="sem-captura">Sem captura</option>
                    <option value="todas">Todas</option>
                </select>
                <input
                    type="text" placeholder="Buscar por nome ou CNPJ…"
                    value={busca} onChange={e => setBusca(e.target.value)}
                    className="px-3 py-1.5 text-sm border rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-slate-600 placeholder-gray-400 dark:placeholder-slate-500 min-w-[220px]"
                />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {linhas.length} de {data?.linhas.length ?? 0}
                </span>
                <button
                    onClick={carregar} disabled={loading}
                    className="ml-auto px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-800 dark:text-gray-100 rounded"
                >
                    ↻ Atualizar
                </button>
            </div>

            {erro && <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-800 px-3 py-2 text-sm text-red-800 dark:text-red-300">{erro}</div>}
            {loading && <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Carregando…</div>}

            {!loading && data && linhas.length === 0 && (
                <div className="p-6 text-center text-sm rounded-xl" style={card}>Nenhuma empresa nesse filtro. 🎉</div>
            )}

            {!loading && linhas.length > 0 && (
                <div className="rounded-xl overflow-x-auto" style={card}>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                                <th className="px-4 py-2">Empresa</th>
                                <th className="px-4 py-2">Status</th>
                                <th className="px-4 py-2 text-right">Entradas</th>
                                <th className="px-4 py-2 text-right">Completas</th>
                                <th className="px-4 py-2 text-right">Pend. ciência</th>
                                <th className="px-4 py-2 text-right">Aguardando</th>
                                <th className="px-4 py-2 text-right">% completa</th>
                                <th className="px-4 py-2">Última sync</th>
                                <th className="px-4 py-2">NSU</th>
                            </tr>
                        </thead>
                        <tbody>
                            {linhas.map(l => {
                                const b = BADGES[l.status];
                                return (
                                    <tr key={l.cnpj} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                                        <td className="px-4 py-2">
                                            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{l.nome}</div>
                                            <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{fmtCnpj(l.cnpj)} · {l.regime}</div>
                                        </td>
                                        <td className="px-4 py-2">
                                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${b.cls}`}>{b.label}</span>
                                            {l.resumosForaPrazo > 0 && (
                                                <div className="text-[10px] mt-0.5 text-red-600 dark:text-red-400">{l.resumosForaPrazo} resumo(s) &gt;180d (ciência expirada)</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-2 text-right font-mono">{l.totalEntradas}</td>
                                        <td className="px-4 py-2 text-right font-mono text-emerald-600 dark:text-emerald-400">{l.completas}</td>
                                        <td className={`px-4 py-2 text-right font-mono ${l.resumosPendentes > 0 ? 'text-amber-600 dark:text-amber-400 font-bold' : ''}`}>{l.resumosPendentes}</td>
                                        <td className="px-4 py-2 text-right font-mono">{l.resumosManifestados}</td>
                                        <td className="px-4 py-2 text-right font-mono">{l.pctCompleta == null ? '—' : `${l.pctCompleta}%`}</td>
                                        <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                            {fmtQuando(l.ultimaSyncMs)}
                                            {l.cStatUltimaSync && <span className="ml-1" style={{ color: 'var(--text-muted)' }}>· cStat {l.cStatUltimaSync}</span>}
                                        </td>
                                        <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                            {l.nsuTravado ? <span className="text-red-600 dark:text-red-400">travado @{l.nsuTravado}</span> : null}
                                            {l.pendenciaNSU > 0 ? <span className="ml-1">⏳ {l.pendenciaNSU} na fila</span> : (!l.nsuTravado ? '—' : null)}
                                        </td>
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

export default BacklogEntradaPanel;
