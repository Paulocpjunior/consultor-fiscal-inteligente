/**
 * Vencimentos da semana — obrigações fiscais que vencem nos próximos 7 dias,
 * agrupadas por urgência. Filtrado por carteira do usuário (admin = tudo).
 *
 * Reusa o /vencimentos/resumo existente — sem endpoint novo. Foco em "o que
 * preciso fazer ATÉ a sexta-feira" (visão diária do contador).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { getResumoVencimentos, type ResumoVencimentos, type TarefaProxima } from '../../services/vencimentosSemanaService';

interface Props { onShowToast?: (msg: string) => void; }

type Urg = 'atrasada' | 'hoje' | 'amanha' | '3d' | '7d';
const urgCor: Record<Urg, string> = {
    atrasada: 'var(--danger)',
    hoje: '#dc2626',
    amanha: '#ea580c',
    '3d': 'var(--warning)',
    '7d': 'var(--text-muted)',
};
const urgLabel: Record<Urg, string> = {
    atrasada: 'ATRASADA',
    hoje: 'VENCE HOJE',
    amanha: 'VENCE AMANHÃ',
    '3d': 'EM 3 DIAS',
    '7d': 'EM 7 DIAS',
};

function classificar(dias: number): Urg {
    if (dias < 0) return 'atrasada';
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'amanha';
    if (dias <= 3) return '3d';
    return '7d';
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const VencimentosSemanaPanel: React.FC<Props> = ({ onShowToast: _onShowToast }) => {
    const [data, setData] = useState<ResumoVencimentos | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<Urg | 'todos'>('todos');
    const [busca, setBusca] = useState('');

    const carregar = async () => {
        setLoading(true); setErro(null);
        try { setData(await getResumoVencimentos()); }
        catch (e: any) { setErro(e?.message || 'Falha ao carregar'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, []);

    const proximas = useMemo(() => {
        const lista = (data?.proximas || []).map((t) => ({
            ...t, urgencia: classificar(t.diasAteVencimento) as Urg,
        }));
        const q = busca.trim().toLowerCase();
        return lista.filter((t) => {
            if (filtro !== 'todos' && t.urgencia !== filtro) return false;
            if (!q) return true;
            return (t.empresaNome || '').toLowerCase().includes(q)
                || (t.empresaCnpj || '').includes(q.replace(/\D/g, ''))
                || (t.titulo || '').toLowerCase().includes(q)
                || (t.obrigacao || '').toLowerCase().includes(q);
        });
    }, [data, filtro, busca]);

    const totalValor = useMemo(
        () => proximas.reduce((acc, t) => acc + (t.valorEstimado || 0), 0),
        [proximas],
    );

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Vencimentos da semana</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Obrigações fiscais que <b>vencem nos próximos 7 dias</b> (ou já estão atrasadas),
                    filtradas pela sua carteira. A lista é a mesma que o cron noturno usa pra disparar
                    alertas — aqui é só pra você ver e agir.
                </p>

                {data && (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-4">
                        <Kpi label="Atrasadas" value={String(data.resumo.atrasadas)} accent={data.resumo.atrasadas > 0 ? 'danger' : 'success'} />
                        <Kpi label="Hoje" value={String(data.resumo.venceHoje)} accent={data.resumo.venceHoje > 0 ? 'danger' : 'success'} />
                        <Kpi label="Amanhã" value={String(data.resumo.venceAmanha)} accent={data.resumo.venceAmanha > 0 ? 'warning' : undefined} />
                        <Kpi label="Em 3 dias" value={String(data.resumo.vence3d)} />
                        <Kpi label="Em 7 dias" value={String(data.resumo.vence7d)} />
                        <Kpi label={`Σ valor (filtro)`} value={brl(totalValor)} />
                    </div>
                )}
            </div>

            <div className="p-4 rounded-xl flex flex-wrap items-center gap-3" style={card}>
                <input type="text" placeholder="Buscar (empresa, obrigação)…"
                    value={busca} onChange={e => setBusca(e.target.value)}
                    className="flex-1 min-w-[200px] p-2.5 text-sm rounded-lg outline-none"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                <div className="flex gap-1 text-xs flex-wrap">
                    {(['todos', 'atrasada', 'hoje', 'amanha', '3d', '7d'] as const).map(f => (
                        <button key={f} onClick={() => setFiltro(f)}
                            className="px-3 py-2 rounded-lg font-bold transition-colors"
                            style={{ background: filtro === f ? 'var(--accent)' : 'var(--bg-card)', color: filtro === f ? '#fff' : 'var(--text-muted)', border: `1px solid ${filtro === f ? 'var(--accent)' : 'var(--border-default)'}` }}>
                            {f === 'todos' ? 'Todas' : urgLabel[f as Urg]}
                        </button>
                    ))}
                </div>
                <button onClick={carregar} disabled={loading}
                    className="px-3 py-2 text-xs font-bold rounded-lg"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                    {loading ? 'Carregando…' : 'Recarregar'}
                </button>
            </div>

            {erro && (
                <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)' }}>{erro}</div>
            )}

            <div className="space-y-2">
                {!loading && proximas.length === 0 && (
                    <div className="p-6 rounded-xl text-center text-sm" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: 'var(--success)' }}>
                        ✓ Nada vencendo na próxima semana
                    </div>
                )}
                {proximas.map((t: any) => <TarefaCard key={t.id} t={t} />)}
            </div>
        </div>
    );
};

function TarefaCard({ t }: { t: TarefaProxima & { urgencia: Urg } }) {
    const cor = urgCor[t.urgencia];
    return (
        <div className="p-3 rounded-xl flex items-start gap-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderLeft: `4px solid ${cor}` }}>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: cor, color: '#fff' }}>{urgLabel[t.urgencia]}</span>
                    {t.obrigacao && (
                        <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t.obrigacao}</span>
                    )}
                    {t.competencia && (
                        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>· {t.competencia}</span>
                    )}
                </div>
                <p className="text-sm font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{t.titulo}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    <b>{t.empresaNome || '—'}</b>
                    {t.empresaCnpj && <span className="font-mono ml-1" style={{ color: 'var(--text-muted)' }}>· {t.empresaCnpj}</span>}
                </p>
                <div className="flex items-center gap-3 mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {t.vencimento && <span>Vence {new Date(t.vencimento).toLocaleDateString('pt-BR')}</span>}
                    <span>{Math.abs(t.diasAteVencimento)} dia(s) {t.diasAteVencimento < 0 ? 'atrasada' : 'restantes'}</span>
                    {t.responsavelNome && <span>· {t.responsavelNome}</span>}
                </div>
            </div>
            {t.valorEstimado != null && (
                <div className="text-right">
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Estimado</p>
                    <p className="text-sm font-bold font-mono" style={{ color: cor }}>{brl(t.valorEstimado)}</p>
                </div>
            )}
        </div>
    );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'success' | 'danger' | 'warning' }) {
    const cor = accent === 'success' ? 'var(--success)' : accent === 'danger' ? 'var(--danger)' : accent === 'warning' ? 'var(--warning)' : 'var(--text-primary)';
    return (
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className="text-lg font-bold" style={{ color: cor }}>{value}</p>
        </div>
    );
}

export default VencimentosSemanaPanel;
