/**
 * Painel de monitoramento de certificados digitais.
 *
 * Quando cert vence, SERPRO/SEFAZ/e-CAC param sem aviso e a cobertura
 * de tudo cai pra zero. Este painel mostra TODOS os certs por dias
 * restantes — cert da S&P (afeta todas as empresas) primeiro.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    getCertMonitor,
    type CertMonitorResposta, type CertItem, type SeveridadeCert,
} from '../../services/certMonitorService';

interface Props { onShowToast?: (msg: string) => void; }

const sevCor: Record<SeveridadeCert, string> = {
    critica: 'var(--danger)',
    alta: '#ea580c',
    media: 'var(--warning)',
    baixa: 'var(--success)',
};

const brDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; }
};

const CertMonitorPanel: React.FC<Props> = ({ onShowToast: _onShowToast }) => {
    const [data, setData] = useState<CertMonitorResposta | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<'a-renovar' | 'todos'>('a-renovar');
    const [busca, setBusca] = useState('');

    const carregar = async () => {
        setLoading(true); setErro(null);
        try { setData(await getCertMonitor()); }
        catch (e: any) { setErro(e?.message || 'Falha ao carregar'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, []);

    const lista = useMemo(() => {
        if (!data) return [];
        const q = busca.trim().toLowerCase();
        return data.certs.filter((c) => {
            // "A renovar" = todos com faixa != null (até 30 dias) + expirados
            if (filtro === 'a-renovar' && c.faixa === null) return false;
            if (!q) return true;
            return (c.titular || '').toLowerCase().includes(q)
                || (c.cnpj || '').includes(q.replace(/\D/g, ''));
        });
    }, [data, filtro, busca]);

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Certificados digitais</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Quando cert vence, <b>SERPRO/SEFAZ/e-CAC param sem aviso</b> e a cobertura
                    de TUDO cai pra zero. O cert da <b>S&P</b> afeta todas as empresas;
                    certs <b>por empresa</b> afetam apenas o CNPJ específico. Já existe um cron
                    noturno que dispara email — esse painel é a visão consolidada.
                </p>

                {data && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
                        <Kpi label="Total" value={String(data.resumo.total)} />
                        <Kpi label="EXPIRADOS" value={String(data.resumo.expirados)} accent={data.resumo.expirados > 0 ? 'danger' : 'success'} />
                        <Kpi label="Críticos (≤3d)" value={String(data.resumo.criticos)} accent={data.resumo.criticos > 0 ? 'danger' : 'success'} />
                        <Kpi label="Urgentes (≤7d)" value={String(data.resumo.urgentes)} accent={data.resumo.urgentes > 0 ? 'warning' : 'success'} />
                        <Kpi label="Atenção (≤30d)" value={String(data.resumo.atencao)} />
                    </div>
                )}
            </div>

            <div className="p-4 rounded-xl flex flex-wrap items-center gap-3" style={card}>
                <input type="text" placeholder="Buscar por nome ou CNPJ…"
                    value={busca} onChange={e => setBusca(e.target.value)}
                    className="flex-1 min-w-[200px] p-2.5 text-sm rounded-lg outline-none"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                <div className="flex gap-1 text-xs">
                    {(['a-renovar', 'todos'] as const).map(f => (
                        <button key={f} onClick={() => setFiltro(f)}
                            className="px-3 py-2 rounded-lg font-bold transition-colors"
                            style={{ background: filtro === f ? 'var(--accent)' : 'var(--bg-card)', color: filtro === f ? '#fff' : 'var(--text-muted)', border: `1px solid ${filtro === f ? 'var(--accent)' : 'var(--border-default)'}` }}>
                            {f === 'a-renovar' ? 'A renovar (≤30d)' : 'Todos'}
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
                {!loading && lista.length === 0 && (
                    <div className="p-6 rounded-xl text-center text-sm" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: 'var(--success)' }}>
                        ✓ Nenhum certificado pra renovar nos próximos 30 dias.
                    </div>
                )}
                {lista.map((c, i) => <CertCard key={`${c.escopo}-${c.cnpj}-${i}`} c={c} />)}
            </div>
        </div>
    );
};

function CertCard({ c }: { c: CertItem }) {
    const cor = sevCor[c.severidade];
    return (
        <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderLeft: `4px solid ${cor}` }}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: cor, color: '#fff' }}>
                            {c.labelUrgencia}
                        </span>
                        <span className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>
                            {c.escopo === 'sefaz_global' ? '⭐ S&P (afeta todas)' : 'EMPRESA'}
                        </span>
                    </div>
                    <p className="text-sm font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{c.titular || '—'}</p>
                    {c.cnpj && (
                        <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{c.cnpj}</p>
                    )}
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                        Vence em <b>{brDate(c.notAfter)}</b>
                        {c.diasRestantes != null && (
                            <> · {c.diasRestantes < 0
                                ? <span style={{ color: 'var(--danger)' }}><b>EXPIROU há {Math.abs(c.diasRestantes)} dia(s)</b></span>
                                : <span style={{ color: cor }}>{c.diasRestantes} dia(s) restante(s)</span>}
                            </>
                        )}
                    </p>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                        <b>Impacto:</b> {c.afeta}
                    </p>
                </div>
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

export default CertMonitorPanel;
