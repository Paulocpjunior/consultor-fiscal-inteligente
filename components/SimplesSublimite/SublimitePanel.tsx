/**
 * Painel de alerta de sublimite/teto do Simples Nacional.
 *
 * Para cada empresa Simples na carteira, calcula RBT12 (últimos 12 meses) e
 * classifica contra:
 *   teto Simples         R$ 4.800.000 (ultrapassou = EXCLUSÃO automática)
 *   sublimite ICMS/ISS   R$ 3.600.000 (ultrapassou = sai do Simples Estadual)
 *
 * Sair do Simples sem aviso = prejuízo direto pro cliente. Aqui o contador vê
 * em UMA tela quem está em risco.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { getAlertaSublimite, type SublimiteResposta, type EmpresaSublimite, type FaixaLimite } from '../../services/simplesSublimiteService';

interface Props { onShowToast?: (msg: string) => void; }

const faixaCor: Record<FaixaLimite, string> = {
    ultrapassou: 'var(--danger)',
    critico: '#ea580c',
    alerta: 'var(--warning)',
    ok: 'var(--success)',
};
const faixaLabel: Record<FaixaLimite, string> = {
    ultrapassou: 'ULTRAPASSOU',
    critico: 'CRÍTICO (≥90%)',
    alerta: 'ALERTA (≥70%)',
    ok: 'OK',
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const SublimitePanel: React.FC<Props> = ({ onShowToast: _onShowToast }) => {
    const [data, setData] = useState<SublimiteResposta | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [busca, setBusca] = useState('');
    const [filtro, setFiltro] = useState<'todas' | 'em-risco'>('em-risco');

    const carregar = async () => {
        setLoading(true); setErro(null);
        try { setData(await getAlertaSublimite()); }
        catch (e: any) { setErro(e?.message || 'Falha ao carregar'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, []);

    const lista = useMemo(() => {
        if (!data) return [];
        const q = busca.trim().toLowerCase();
        return data.empresas.filter((e) => {
            if (filtro === 'em-risco' && e.piorFaixa === 'ok') return false;
            if (!q) return true;
            return e.nome.toLowerCase().includes(q) || e.cnpj.includes(q.replace(/\D/g, ''));
        });
    }, [data, filtro, busca]);

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Alerta de sublimite Simples</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Para cada empresa Simples, calcula <b>RBT12</b> (receita bruta dos últimos
                    12 meses, do <code>faturamentoManual</code>) e classifica contra:{' '}
                    <b>sublimite ICMS/ISS R$ 3,6M</b> (ultrapassou = sai do Simples Estadual) e{' '}
                    <b>teto R$ 4,8M</b> (ultrapassou = EXCLUSÃO automática do Simples Nacional).
                </p>

                {data && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                        <Kpi label="Empresas Simples" value={String(data.resumo.totalEmpresas)} />
                        <Kpi label={`Ultrapassou TETO (${brl(data.limites.teto)})`}
                            value={String(data.resumo.ultrapassouTeto)}
                            accent={data.resumo.ultrapassouTeto > 0 ? 'danger' : 'success'} />
                        <Kpi label={`Ultrapassou SUBLIMITE (${brl(data.limites.sublimite)})`}
                            value={String(data.resumo.ultrapassouSublimite)}
                            accent={data.resumo.ultrapassouSublimite > 0 ? 'danger' : 'success'} />
                        <Kpi label="Críticos (≥90% de algum limite)"
                            value={String(data.resumo.criticosTeto + data.resumo.criticosSublimite)}
                            accent={(data.resumo.criticosTeto + data.resumo.criticosSublimite) > 0 ? 'warning' : 'success'} />
                    </div>
                )}
            </div>

            <div className="p-4 rounded-xl flex flex-wrap items-center gap-3" style={card}>
                <input type="text" placeholder="Buscar por nome ou CNPJ…"
                    value={busca} onChange={e => setBusca(e.target.value)}
                    className="flex-1 min-w-[200px] p-2.5 text-sm rounded-lg outline-none"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                <div className="flex gap-1 text-xs">
                    {(['em-risco', 'todas'] as const).map(f => (
                        <button key={f} onClick={() => setFiltro(f)}
                            className="px-3 py-2 rounded-lg font-bold transition-colors"
                            style={{ background: filtro === f ? 'var(--accent)' : 'var(--bg-card)', color: filtro === f ? '#fff' : 'var(--text-muted)', border: `1px solid ${filtro === f ? 'var(--accent)' : 'var(--border-default)'}` }}>
                            {f === 'em-risco' ? 'Em risco' : 'Todas'}
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
                        ✓ Nenhuma empresa Simples em risco no momento.
                    </div>
                )}
                {lista.map((emp) => <EmpresaCard key={emp.cnpj} emp={emp} />)}
            </div>
        </div>
    );
};

function EmpresaCard({ emp }: { emp: EmpresaSublimite }) {
    const cor = faixaCor[emp.piorFaixa];
    return (
        <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderLeft: `4px solid ${cor}` }}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{emp.nome || '—'}</p>
                    <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{emp.cnpj}</p>
                    <div className="mt-2 grid grid-cols-2 gap-3 max-w-md">
                        <Limite label="Sublimite ICMS/ISS" classif={emp.sublimite} />
                        <Limite label="Teto Simples" classif={emp.teto} />
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>RBT12</p>
                    <p className="text-lg font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{brl(emp.rbt12)}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {emp.mesesComDado}/{emp.mesesComDado + emp.mesesSemDado} meses com dado
                    </p>
                </div>
            </div>
        </div>
    );
}

function Limite({ label, classif }: { label: string; classif: EmpresaSublimite['teto'] }) {
    const cor = faixaCor[classif.faixa];
    return (
        <div className="p-2 rounded" style={{ background: 'var(--bg-card)', border: `1px solid ${cor}30` }}>
            <p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: cor, color: '#fff' }}>
                    {faixaLabel[classif.faixa]}
                </span>
                <span className="text-xs font-mono font-bold" style={{ color: cor }}>{classif.pct.toFixed(1)}%</span>
            </div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                {classif.faixa === 'ultrapassou'
                    ? `ultrapassou ${brl(0 - (classif.limite * classif.pct / 100 - classif.limite))}`
                    : `restam ${brl(classif.restante)}`}
            </p>
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

export default SublimitePanel;
