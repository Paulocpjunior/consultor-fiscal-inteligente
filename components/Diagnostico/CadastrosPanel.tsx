/**
 * Painel de diagnóstico de cadastros incompletos das empresas.
 *
 * Empresas com UF/codMunIBGE/anexo faltando bloqueiam o SPED Fiscal gerador
 * e o cálculo do DAS sem aviso claro — esse painel pega antes do contador
 * tentar gerar e descobrir o problema no meio.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    getDiagnosticoCadastros,
    type DiagnosticoCadastrosResposta, type EmpresaCadastro, type GravidadeCadastro,
} from '../../services/diagnosticoCadastrosService';

interface Props { onShowToast?: (msg: string) => void; }

const gravCor: Record<GravidadeCadastro, string> = {
    critico: 'var(--danger)',
    alto: '#ea580c',
    medio: 'var(--warning)',
    ok: 'var(--success)',
};
const gravLabel: Record<GravidadeCadastro, string> = {
    critico: 'CRÍTICO',
    alto: 'ALTO',
    medio: 'MÉDIO',
    ok: 'OK',
};

const CadastrosPanel: React.FC<Props> = ({ onShowToast: _onShowToast }) => {
    const [data, setData] = useState<DiagnosticoCadastrosResposta | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<GravidadeCadastro | 'todas'>('critico');
    const [busca, setBusca] = useState('');

    const carregar = async () => {
        setLoading(true); setErro(null);
        try { setData(await getDiagnosticoCadastros()); }
        catch (e: any) { setErro(e?.message || 'Falha ao carregar'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, []);

    const lista = useMemo(() => {
        if (!data) return [];
        const q = busca.trim().toLowerCase();
        return data.empresas.filter((e) => {
            if (filtro !== 'todas' && e.gravidade !== filtro) return false;
            if (!q) return true;
            return e.nome.toLowerCase().includes(q) || e.cnpj.includes(q.replace(/\D/g, ''));
        });
    }, [data, filtro, busca]);

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Cadastros incompletos</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Empresas Simples/Lucro com campos obrigatórios faltando.
                    <b> Crítico</b> = SPED Fiscal não gera (sem UF / IBGE / CNPJ).
                    <b> Alto</b> = DAS/DARF não calcula (sem anexo / tipo tributação).
                    <b> Médio</b> = identificação ou CNAE faltando.
                </p>

                {data && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
                        <Kpi label="Total" value={String(data.resumo.total)} />
                        <Kpi label="Críticos" value={String(data.resumo.criticos)} accent={data.resumo.criticos > 0 ? 'danger' : 'success'} />
                        <Kpi label="Altos" value={String(data.resumo.altos)} accent={data.resumo.altos > 0 ? 'warning' : 'success'} />
                        <Kpi label="Médios" value={String(data.resumo.medios)} />
                        <Kpi label="OK" value={String(data.resumo.ok)} accent="success" />
                    </div>
                )}
            </div>

            <div className="p-4 rounded-xl flex flex-wrap items-center gap-3" style={card}>
                <input type="text" placeholder="Buscar por nome ou CNPJ…"
                    value={busca} onChange={e => setBusca(e.target.value)}
                    className="flex-1 min-w-[200px] p-2.5 text-sm rounded-lg outline-none"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                <div className="flex gap-1 text-xs">
                    {(['critico', 'alto', 'medio', 'todas'] as const).map(f => (
                        <button key={f} onClick={() => setFiltro(f as any)}
                            className="px-3 py-2 rounded-lg font-bold transition-colors"
                            style={{ background: filtro === f ? 'var(--accent)' : 'var(--bg-card)', color: filtro === f ? '#fff' : 'var(--text-muted)', border: `1px solid ${filtro === f ? 'var(--accent)' : 'var(--border-default)'}` }}>
                            {f === 'todas' ? 'Todas' : gravLabel[f as GravidadeCadastro]}
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
                        ✓ Nenhuma empresa nessa gravidade.
                    </div>
                )}
                {lista.map((emp) => <EmpresaCard key={emp.cnpj} emp={emp} />)}
            </div>
        </div>
    );
};

function EmpresaCard({ emp }: { emp: EmpresaCadastro }) {
    const cor = gravCor[emp.gravidade];
    return (
        <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderLeft: `4px solid ${cor}` }}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: cor, color: '#fff' }}>
                            {gravLabel[emp.gravidade]}
                        </span>
                        <span className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>{emp.regime}</span>
                    </div>
                    <p className="text-sm font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{emp.nome || '—'}</p>
                    <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{emp.cnpj || '(sem CNPJ)'}</p>
                </div>
                <div className="text-right">
                    <span className="text-2xl font-bold" style={{ color: cor }}>{emp.pendencias.length}</span>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>pendência(s)</p>
                </div>
            </div>
            {emp.pendencias.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {emp.pendencias.map((p, i) => (
                        <li key={i}>
                            <span className="font-mono" style={{ color: 'var(--text-muted)' }}>{p.campo}</span>
                            {' — '}{p.descricao}
                            <span className="block text-[10px] ml-4" style={{ color: 'var(--text-muted)' }}>
                                impacto: {p.impacto}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
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

export default CadastrosPanel;
