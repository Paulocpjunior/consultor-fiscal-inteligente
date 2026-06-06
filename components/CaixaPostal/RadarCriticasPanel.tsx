/**
 * Radar de mensagens críticas/altas/médias não lidas no e-CAC / DET / DEC /
 * DJE / EMac (SP). Ordenado por risco fiscal (urgência × idade × prazo).
 *
 * Os criticos sao: intimações da Receita, malha fiscal, exclusão do Simples,
 * autos de infração DET, citações judiciais. Cada dia parado = +1 ponto de
 * risco; prazo vencido = +50 pontos.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    getRadarCaixaPostal, type MensagemClassificada, type Urgencia, type RadarResposta,
    categoriaLabel,
} from '../../services/caixaPostalRadarService';

interface Props { onShowToast?: (msg: string) => void; }

const urgCor: Record<Urgencia, string> = {
    critica: 'var(--danger)',
    alta: '#ea580c',
    media: 'var(--warning)',
    baixa: 'var(--text-muted)',
};
const urgLabel: Record<Urgencia, string> = {
    critica: 'CRÍTICA', alta: 'ALTA', media: 'MÉDIA', baixa: 'BAIXA',
};

const RadarCriticasPanel: React.FC<Props> = ({ onShowToast: _onShowToast }) => {
    const [data, setData] = useState<MensagemClassificada[]>([]);
    const [meta, setMeta] = useState<{ totalBruto: number; truncado: boolean } | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<Urgencia | 'todas' | 'acao'>('acao');
    const [busca, setBusca] = useState('');

    const carregar = async () => {
        setLoading(true); setErro(null);
        try {
            const r: RadarResposta = await getRadarCaixaPostal();
            setData(r.mensagens);
            setMeta({ totalBruto: r.totalBruto, truncado: r.truncado });
        }
        catch (e: any) { setErro(e?.message || 'Falha ao carregar'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, []);

    const lista = useMemo(() => {
        const q = busca.trim().toLowerCase();
        return data.filter((m) => {
            if (filtro === 'acao' && m.urgencia === 'baixa') return false;
            if (filtro !== 'todas' && filtro !== 'acao' && m.urgencia !== filtro) return false;
            if (!q) return true;
            return (m.empresaNome || '').toLowerCase().includes(q)
                || m.empresaCnpj.includes(q.replace(/\D/g, ''))
                || m.assunto.toLowerCase().includes(q)
                || categoriaLabel[m.categoria]?.toLowerCase().includes(q);
        });
    }, [data, filtro, busca]);

    const counts = useMemo(() => {
        const c = { critica: 0, alta: 0, media: 0, baixa: 0 };
        data.forEach((m) => c[m.urgencia]++);
        return c;
    }, [data]);

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Radar fiscal — caixa postal</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Mensagens NÃO lidas do e-CAC / DET / DEC / DJE / EMac (SP) e
                    Prefeitura SP, classificadas por risco fiscal real. Prazo vencido
                    sem resposta vira auto de infração — daí "crítica" pesa mais que
                    qualquer outra fila.
                </p>

                <div className="grid grid-cols-4 gap-3 mt-4">
                    <Kpi label="Críticas" value={String(counts.critica)} accent="danger" />
                    <Kpi label="Altas" value={String(counts.alta)} accent={counts.alta > 0 ? 'warning' : 'success'} />
                    <Kpi label="Médias" value={String(counts.media)} />
                    <Kpi label="Total não lidas" value={String(meta?.totalBruto ?? data.length)} />
                </div>
            </div>

            <div className="p-4 rounded-xl flex flex-wrap items-center gap-3" style={card}>
                <input type="text" placeholder="Buscar (empresa, assunto, categoria)…"
                    value={busca} onChange={e => setBusca(e.target.value)}
                    className="flex-1 min-w-[200px] p-2.5 text-sm rounded-lg outline-none"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                <div className="flex gap-1 text-xs flex-wrap">
                    {(['acao', 'critica', 'alta', 'media', 'todas'] as const).map(f => (
                        <button key={f} onClick={() => setFiltro(f as any)}
                            className="px-3 py-2 rounded-lg font-bold transition-colors"
                            style={{ background: filtro === f ? 'var(--accent)' : 'var(--bg-card)', color: filtro === f ? '#fff' : 'var(--text-muted)', border: `1px solid ${filtro === f ? 'var(--accent)' : 'var(--border-default)'}` }}>
                            {f === 'acao' ? 'Requer ação' : f === 'critica' ? 'Críticas' : f === 'alta' ? 'Altas' : f === 'media' ? 'Médias' : 'Todas'}
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

            {meta?.truncado && (
                <div className="p-3 rounded-xl text-sm" style={{ background: 'var(--warning-soft)', border: '1px solid var(--warning-soft-border)', borderLeft: '4px solid var(--warning)', color: 'var(--text-secondary)' }}>
                    <b style={{ color: 'var(--warning)' }}>⚠ Exibindo as 500 mensagens de maior risco</b> (de {meta.totalBruto} total). Foque nas críticas/altas; use a busca pra empresa específica.
                </div>
            )}

            <div className="space-y-2">
                {!loading && lista.length === 0 && (
                    <div className="p-6 rounded-xl text-center text-sm" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: 'var(--success)' }}>
                        ✓ Nenhuma mensagem nessa categoria.
                    </div>
                )}
                {lista.map((m) => (
                    <div key={m.mensagemId} className="p-3 rounded-xl flex items-start gap-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderLeft: `4px solid ${urgCor[m.urgencia]}` }}>
                        <div style={{ width: 6, alignSelf: 'stretch', borderRadius: 2 }} />
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: urgCor[m.urgencia], color: '#fff' }}>{urgLabel[m.urgencia]}</span>
                                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{categoriaLabel[m.categoria] || m.categoria}</span>
                                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>·</span>
                                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{m.fonte}</span>
                            </div>
                            <p className="text-sm font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{m.assunto || '(sem assunto)'}</p>
                            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                                <b>{m.empresaNome || '—'}</b> · <span className="font-mono">{m.empresaCnpj}</span>
                            </p>
                            <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                <span>{m.diasParado} dia(s) parada</span>
                                {m.diasParaPrazo != null && (
                                    <span style={{ color: m.diasParaPrazo < 0 ? 'var(--danger)' : m.diasParaPrazo <= 5 ? 'var(--warning)' : 'var(--text-muted)' }}>
                                        Prazo: {m.diasParaPrazo < 0 ? `${Math.abs(m.diasParaPrazo)} dia(s) VENCIDO` : `${m.diasParaPrazo} dia(s) restante(s)`}
                                    </span>
                                )}
                                <span>Risco {m.riscoCalculado}/100</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'success' | 'danger' | 'warning' }) {
    const cor = accent === 'success' ? 'var(--success)' : accent === 'danger' ? 'var(--danger)' : accent === 'warning' ? 'var(--warning)' : 'var(--text-primary)';
    return (
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className="text-xl font-bold" style={{ color: cor }}>{value}</p>
        </div>
    );
}

export default RadarCriticasPanel;
