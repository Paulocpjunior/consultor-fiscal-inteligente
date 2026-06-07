/**
 * Painel de diagnóstico de configurações operacionais.
 *
 * Env var faltando = feature silenciosamente quebrada. Esse painel
 * mostra TODAS as configs faltando e o IMPACTO específico de cada uma.
 * Não expõe valores (segurança) — só presença/ausência.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    getDiagnosticoConfig,
    type DiagnosticoConfigResposta, type AchadoConfig, type CriticidadeConfig,
} from '../../services/diagnosticoConfigService';

interface Props { onShowToast?: (msg: string) => void; }

const critCor: Record<CriticidadeConfig, string> = {
    critico: 'var(--danger)',
    alto: '#ea580c',
    medio: 'var(--warning)',
    // 'informativo' = env vazia mas codigo tem default rodando (ex: STORAGE_BUCKET)
    informativo: 'var(--text-muted)',
};
const critLabel: Record<CriticidadeConfig, string> = {
    critico: 'CRÍTICO',
    alto: 'ALTO',
    medio: 'MÉDIO',
    informativo: 'INFO (default OK)',
};

const ConfigPanel: React.FC<Props> = ({ onShowToast: _onShowToast }) => {
    const [data, setData] = useState<DiagnosticoConfigResposta | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<CriticidadeConfig | 'todas'>('todas');

    const carregar = async () => {
        setLoading(true); setErro(null);
        try { setData(await getDiagnosticoConfig()); }
        catch (e: any) { setErro(e?.message || 'Falha ao carregar'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, []);

    const lista = useMemo(() => {
        if (!data) return [];
        return data.achados.filter((a) => filtro === 'todas' || a.criticidade === filtro);
    }, [data, filtro]);

    // Agrupar por categoria
    const porCategoria = useMemo(() => {
        const m = new Map<string, AchadoConfig[]>();
        for (const a of lista) {
            const arr = m.get(a.categoria) || [];
            arr.push(a);
            m.set(a.categoria, arr);
        }
        return Array.from(m.entries());
    }, [lista]);

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Configurações operacionais</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Env var faltando = <b>feature silenciosamente quebrada</b>. Painel mostra
                    o que está faltando + IMPACTO específico. <b>Valores não são expostos</b>{' '}
                    (segurança) — só presença/ausência.
                </p>

                {data && (
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-4">
                        <Kpi label="Total verificadas" value={String(data.resumo.total)} />
                        <Kpi label="Críticas faltando" value={String(data.resumo.criticos)} accent={data.resumo.criticos > 0 ? 'danger' : 'success'} />
                        <Kpi label="Altas faltando" value={String(data.resumo.altos)} accent={data.resumo.altos > 0 ? 'warning' : 'success'} />
                        <Kpi label="Médias faltando" value={String(data.resumo.medios)} />
                        <Kpi label="Info (default OK)" value={String((data.resumo as any).informativos ?? 0)} />
                        <Kpi label="Ambiente" value={data.ambiente.toUpperCase()} />
                    </div>
                )}
            </div>

            <div className="p-4 rounded-xl flex flex-wrap items-center gap-3" style={card}>
                <div className="flex gap-1 text-xs">
                    {(['todas', 'critico', 'alto', 'medio', 'informativo'] as const).map(f => (
                        <button key={f} onClick={() => setFiltro(f as any)}
                            className="px-3 py-2 rounded-lg font-bold transition-colors"
                            style={{ background: filtro === f ? 'var(--accent)' : 'var(--bg-card)', color: filtro === f ? '#fff' : 'var(--text-muted)', border: `1px solid ${filtro === f ? 'var(--accent)' : 'var(--border-default)'}` }}>
                            {f === 'todas' ? 'Todas' : critLabel[f as CriticidadeConfig]}
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

            <div className="space-y-3">
                {!loading && lista.length === 0 && (
                    <div className="p-6 rounded-xl text-center text-sm" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: 'var(--success)' }}>
                        ✓ Todas as configurações verificadas estão OK.
                    </div>
                )}
                {porCategoria.map(([cat, achados]) => (
                    <div key={cat} className="p-3 rounded-xl" style={card}>
                        <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{cat}</p>
                        <div className="space-y-1.5">
                            {achados.map((a, i) => <AchadoLinha key={i} a={a} />)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

function AchadoLinha({ a }: { a: AchadoConfig }) {
    const cor = critCor[a.criticidade];
    return (
        <div className="flex items-start gap-3 p-2 rounded" style={{ background: 'var(--bg-card)', borderLeft: `3px solid ${cor}` }}>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: cor, color: '#fff' }}>
                        {critLabel[a.criticidade]}
                    </span>
                    <code className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{a.chave}</code>
                    {a.valorAtual && (
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            atual: <code>{a.valorAtual}</code>
                        </span>
                    )}
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{a.descricao}</p>
                <p className="text-[11px] mt-0.5" style={{ color: cor }}>
                    <b>Impacto:</b> {a.impacto}
                </p>
            </div>
        </div>
    );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'success' | 'danger' | 'warning' }) {
    const cor = accent === 'success' ? 'var(--success)' : accent === 'danger' ? 'var(--danger)' : accent === 'warning' ? 'var(--warning)' : 'var(--text-primary)';
    return (
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className="text-xl font-bold" style={{ color: cor }}>{value}</p>
        </div>
    );
}

export default ConfigPanel;
