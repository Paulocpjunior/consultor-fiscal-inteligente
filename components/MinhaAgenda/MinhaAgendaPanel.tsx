/**
 * Minha Agenda Fiscal — dashboard consolidado por carteira.
 *
 * Pra cada empresa que o colaborador é responsável (admin vê todas), mostra
 * num único cartão o risco fiscal real da semana:
 *   - PGDAS-D pendente (Simples) ou DCTFWeb pendente (Lucro)
 *   - mensagens críticas/altas não lidas no e-CAC/DET/DEC/DJE/EMac
 *   - score 0-100 pra priorizar
 */
import React, { useEffect, useMemo, useState } from 'react';
import { getMinhaAgenda, type MinhaAgendaResposta, type EmpresaAgenda } from '../../services/minhaAgendaService';
import { faixaDoScoreUi, FAIXA_LABEL, FAIXA_COR } from '../../services/agendaScoreUi';

interface Props { onShowToast?: (msg: string) => void; }

// Faixas centralizadas em services/agendaScoreUi.ts (espelho do backend).
const scoreCor = (score: number) => FAIXA_COR[faixaDoScoreUi(score)];
function exportarCsv(lista: EmpresaAgenda[]) {
    const headers = ['Score', 'Faixa', 'Empresa', 'CNPJ', 'Regime', 'PGDAS gaps', 'DCTFWeb gaps', 'Msgs crít.', 'Msgs altas', 'Pendências'];
    const rows = lista.map((e) => [
        e.score,
        scoreLabel(e.score),
        (e.nome || '').replace(/[;\n\r]/g, ' '),
        e.cnpj,
        e.regime,
        e.pgdas?.gaps ?? '',
        e.dctfweb?.gaps ?? '',
        e.mensagens.criticas,
        e.mensagens.altas,
        e.pendencias.join(' | ').replace(/[;\n\r]/g, ' '),
    ].join(';'));
    const csv = [headers.join(';'), ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `minha-agenda-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

const scoreLabel = (score: number) => FAIXA_LABEL[faixaDoScoreUi(score)];

const MinhaAgendaPanel: React.FC<Props> = ({ onShowToast: _onShowToast }) => {
    const [meses, setMeses] = useState(3);
    const [data, setData] = useState<MinhaAgendaResposta | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [busca, setBusca] = useState('');
    const [filtro, setFiltro] = useState<'com-risco' | 'todas'>('com-risco');

    const carregar = async () => {
        setLoading(true); setErro(null);
        try { setData(await getMinhaAgenda(meses)); }
        catch (e: any) { setErro(e?.message || 'Falha ao carregar'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [meses]);

    const lista = useMemo(() => {
        if (!data) return [];
        const q = busca.trim().toLowerCase();
        return data.empresas.filter((e) => {
            if (filtro === 'com-risco' && e.score === 0) return false;
            if (!q) return true;
            return e.nome.toLowerCase().includes(q) || e.cnpj.includes(q.replace(/\D/g, ''));
        });
    }, [data, filtro, busca]);

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Minha agenda fiscal</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Consolida o risco fiscal real <b>das suas empresas</b> (carteira) num só lugar:
                    PGDAS-D / DCTFWeb pendentes e mensagens críticas no e-CAC. Score 0-100 prioriza
                    a fila do dia.
                </p>

                {data && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                        <Kpi label="Empresas na carteira" value={String(data.totalEmpresas)} />
                        <Kpi label="Com risco" value={String(data.empresasComRisco)} accent={data.empresasComRisco > 0 ? 'warning' : 'success'} />
                        <Kpi label="Risco CRÍTICO (≥70)" value={String(data.riscoCritico)} accent={data.riscoCritico > 0 ? 'danger' : 'success'} />
                        <Kpi label="Usuário" value={data.usuario.role === 'admin' ? 'admin (tudo)' : data.usuario.email.split('@')[0]} />
                    </div>
                )}
            </div>

            <div className="p-4 rounded-xl flex flex-wrap items-center gap-3" style={card}>
                <input type="text" placeholder="Buscar por nome ou CNPJ…"
                    value={busca} onChange={e => setBusca(e.target.value)}
                    className="flex-1 min-w-[200px] p-2.5 text-sm rounded-lg outline-none"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                <div className="flex gap-1 text-xs">
                    {(['com-risco', 'todas'] as const).map(f => (
                        <button key={f} onClick={() => setFiltro(f)}
                            className="px-3 py-2 rounded-lg font-bold transition-colors"
                            style={{ background: filtro === f ? 'var(--accent)' : 'var(--bg-card)', color: filtro === f ? '#fff' : 'var(--text-muted)', border: `1px solid ${filtro === f ? 'var(--accent)' : 'var(--border-default)'}` }}>
                            {f === 'com-risco' ? 'Com risco' : 'Todas'}
                        </button>
                    ))}
                </div>
                <select value={meses} onChange={e => setMeses(Number(e.target.value))}
                    className="px-3 py-2 text-xs font-bold rounded-lg"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                    {[3, 6, 12].map(m => <option key={m} value={m}>Últimos {m} meses</option>)}
                </select>
                <button onClick={carregar} disabled={loading}
                    className="px-3 py-2 text-xs font-bold rounded-lg"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                    {loading ? 'Carregando…' : 'Recarregar'}
                </button>
                <button onClick={() => exportarCsv(lista)} disabled={!lista.length}
                    className="px-3 py-2 text-xs font-bold rounded-lg disabled:opacity-40"
                    style={{ background: 'var(--success)', color: '#fff', border: '1px solid var(--success)' }}>
                    ⬇ Exportar CSV
                </button>
            </div>

            {erro && (
                <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)' }}>{erro}</div>
            )}

            <div className="space-y-2">
                {!loading && lista.length === 0 && (
                    <div className="p-6 rounded-xl text-center text-sm" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: 'var(--success)' }}>
                        ✓ Nenhuma empresa com risco no momento.
                    </div>
                )}
                {lista.map((emp) => <EmpresaCard key={emp.cnpj} emp={emp} />)}
            </div>
        </div>
    );
};

function EmpresaCard({ emp }: { emp: EmpresaAgenda }) {
    const cor = scoreCor(emp.score);
    return (
        <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderLeft: `4px solid ${cor}` }}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: cor, color: '#fff' }}>
                            {scoreLabel(emp.score)} {emp.score}/100
                        </span>
                        <span className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>{emp.regime}</span>
                    </div>
                    <p className="text-sm font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{emp.nome || '—'}</p>
                    <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{emp.cnpj}</p>

                    {emp.pendencias.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {emp.pendencias.map((p, i) => <li key={i}>• {p}</li>)}
                        </ul>
                    )}
                </div>

                <div className="flex flex-col gap-1 text-[11px] text-right" style={{ color: 'var(--text-muted)' }}>
                    {emp.pgdas && (
                        <span style={{ color: emp.pgdas.gaps > 0 ? 'var(--danger)' : 'var(--success)' }}>
                            PGDAS: {emp.pgdas.gaps === 0 ? '✓' : `${emp.pgdas.gaps} gap(s)`}
                        </span>
                    )}
                    {emp.dctfweb && (
                        <span style={{ color: emp.dctfweb.gaps > 0 ? 'var(--danger)' : 'var(--success)' }}>
                            DCTFWeb: {emp.dctfweb.gaps === 0 ? '✓' : `${emp.dctfweb.gaps} gap(s)`}
                        </span>
                    )}
                    {emp.mensagens.total > 0 && (
                        <span>
                            Msgs: {emp.mensagens.criticas > 0 && <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>{emp.mensagens.criticas} crít </span>}
                            {emp.mensagens.altas > 0 && <span style={{ color: '#ea580c' }}>{emp.mensagens.altas} altas </span>}
                            {emp.mensagens.medias + emp.mensagens.baixas > 0 && <span>{emp.mensagens.medias + emp.mensagens.baixas} outras</span>}
                        </span>
                    )}
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

export default MinhaAgendaPanel;
