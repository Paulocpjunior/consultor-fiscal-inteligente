/**
 * Painel de prazos de PRESCRIÇÃO da recuperação tributária.
 *
 * Recuperação fiscal tem prazo de 5 anos (CTN art 168). Cada item identificado
 * pelo motor de teses tem sua competência (YYYY-MM); este painel calcula
 * quanto tempo falta até expirar e classifica:
 *
 *   EXPIRADO     >  5 anos atrás (já não dá pra recuperar — perda definitiva)
 *   URGENTE      <= 90 dias até expirar
 *   ALERTA       <= 1 ano até expirar
 *   OK           >  1 ano até expirar (folga)
 *
 * Reusa /api/admin/recuperacao/analisar-todas existente — nenhum endpoint novo.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { analisarTodas } from '../../services/recuperacaoTributariaService';
import {
    dataLimitePrescricao, diasAteExpirar, classificarPrescricao,
    type SeveridadePrescricao,
} from '../../services/prescricaoLogic';

interface Props { onShowToast?: (msg: string) => void; }

type Severidade = SeveridadePrescricao;

interface ItemPrescricao {
    empresaId: string;
    empresaNome: string;
    empresaCnpj: string;
    teseId: string;
    teseNome: string;
    competencia: string;
    valorRecuperavel: number;
    descricao: string;
    fimPrazo: Date;          // último dia de competência + 5 anos
    diasRestantes: number;
    severidade: Severidade;
}

const sevCor: Record<Severidade, string> = {
    expirado: 'var(--text-muted)',
    urgente: 'var(--danger)',
    alerta: '#ea580c',
    ok: 'var(--success)',
};
const sevLabel: Record<Severidade, string> = {
    expirado: 'EXPIRADO',
    urgente: 'URGENTE (≤90d)',
    alerta: 'ALERTA (≤1 ano)',
    ok: 'OK (>1 ano)',
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Lógica pura testada em services/prescricaoLogic.ts.

const PrazosPrescricaoPanel: React.FC<Props> = ({ onShowToast: _onShowToast }) => {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<Severidade | 'todos'>('urgente');
    const [busca, setBusca] = useState('');

    const carregar = async () => {
        setLoading(true); setErro(null);
        try { setData(await analisarTodas()); }
        catch (e: any) { setErro(e?.message || 'Falha ao carregar'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, []);

    // Achata: empresa.teses.itens -> ItemPrescricao[]
    const itens = useMemo((): ItemPrescricao[] => {
        if (!data?.resultados) return [];
        const agora = new Date();
        const out: ItemPrescricao[] = [];
        for (const emp of data.resultados) {
            for (const t of (emp.teses || [])) {
                for (const it of (t.itens || [])) {
                    const fim = dataLimitePrescricao(it.competencia);
                    if (!fim) continue;
                    const diasRestantes = diasAteExpirar(it.competencia, agora)!;
                    out.push({
                        empresaId: emp.empresaId,
                        empresaNome: emp.empresaNome,
                        empresaCnpj: emp.empresaCnpj,
                        teseId: t.tese.id,
                        teseNome: t.tese.nome,
                        competencia: it.competencia,
                        valorRecuperavel: it.valorRecuperavel || 0,
                        descricao: it.descricao || '',
                        fimPrazo: fim,
                        diasRestantes,
                        severidade: classificarPrescricao(diasRestantes),
                    });
                }
            }
        }
        // Ordena: expirado por último; URGENTE primeiro (menor diasRestantes); depois ALERTA; depois OK
        return out.sort((a, b) => {
            const rank = (s: Severidade) => s === 'urgente' ? 0 : s === 'alerta' ? 1 : s === 'ok' ? 2 : 3;
            const r = rank(a.severidade) - rank(b.severidade);
            return r !== 0 ? r : a.diasRestantes - b.diasRestantes;
        });
    }, [data]);

    const totais = useMemo(() => {
        const t = { expirado: 0, urgente: 0, alerta: 0, ok: 0 };
        const valor = { expirado: 0, urgente: 0, alerta: 0, ok: 0 };
        for (const it of itens) {
            t[it.severidade]++;
            valor[it.severidade] += it.valorRecuperavel;
        }
        return { t, valor };
    }, [itens]);

    const lista = useMemo(() => {
        const q = busca.trim().toLowerCase();
        return itens.filter((it) => {
            if (filtro !== 'todos' && it.severidade !== filtro) return false;
            if (!q) return true;
            return it.empresaNome.toLowerCase().includes(q)
                || it.empresaCnpj.includes(q.replace(/\D/g, ''))
                || it.teseNome.toLowerCase().includes(q);
        });
    }, [itens, filtro, busca]);

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Prazos de prescrição</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Recuperação tributária tem prazo de <b>5 anos</b> (CTN art. 168). Este painel
                    lista cada oportunidade identificada (todas as teses, todas as empresas) classificada
                    por <b>quanto falta pra expirar</b>. URGENTE = ≤90 dias.
                </p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                    <Kpi label={`URGENTE (≤90d)`} value={`${totais.t.urgente} · ${brl(totais.valor.urgente)}`} accent={totais.t.urgente > 0 ? 'danger' : 'success'} />
                    <Kpi label={`ALERTA (≤1 ano)`} value={`${totais.t.alerta} · ${brl(totais.valor.alerta)}`} accent={totais.t.alerta > 0 ? 'warning' : 'success'} />
                    <Kpi label={`OK (>1 ano)`} value={`${totais.t.ok} · ${brl(totais.valor.ok)}`} accent="success" />
                    <Kpi label={`EXPIRADO (perda definitiva)`} value={`${totais.t.expirado} · ${brl(totais.valor.expirado)}`} />
                </div>
            </div>

            <div className="p-4 rounded-xl flex flex-wrap items-center gap-3" style={card}>
                <input type="text" placeholder="Buscar (empresa, tese, CNPJ)…"
                    value={busca} onChange={e => setBusca(e.target.value)}
                    className="flex-1 min-w-[200px] p-2.5 text-sm rounded-lg outline-none"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                <div className="flex gap-1 text-xs flex-wrap">
                    {(['urgente', 'alerta', 'ok', 'expirado', 'todos'] as const).map(f => (
                        <button key={f} onClick={() => setFiltro(f)}
                            className="px-3 py-2 rounded-lg font-bold transition-colors"
                            style={{ background: filtro === f ? 'var(--accent)' : 'var(--bg-card)', color: filtro === f ? '#fff' : 'var(--text-muted)', border: `1px solid ${filtro === f ? 'var(--accent)' : 'var(--border-default)'}` }}>
                            {f === 'todos' ? 'Todos' : sevLabel[f as Severidade].split(' ')[0]}
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

            <div className="p-2 rounded-xl overflow-x-auto" style={card}>
                <table className="w-full text-sm">
                    <thead>
                        <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-default)' }}>
                            <th className="py-2 px-3 text-left">Status</th>
                            <th className="py-2 px-3 text-left">Empresa</th>
                            <th className="py-2 px-3 text-left">Tese</th>
                            <th className="py-2 px-3 text-left">Competência</th>
                            <th className="py-2 px-3 text-right">Recuperável</th>
                            <th className="py-2 px-3 text-right">Expira em</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lista.length === 0 && (
                            <tr><td colSpan={6} className="py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                                {loading ? 'Carregando…' : 'Nenhum item nesse filtro.'}
                            </td></tr>
                        )}
                        {lista.slice(0, 500).map((it, i) => (
                            <tr key={`${it.empresaId}-${it.teseId}-${it.competencia}-${i}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                <td className="py-2 px-3">
                                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: sevCor[it.severidade], color: '#fff' }}>{sevLabel[it.severidade].split(' ')[0]}</span>
                                </td>
                                <td className="py-2 px-3">
                                    <div style={{ color: 'var(--text-primary)' }}>{it.empresaNome || '—'}</div>
                                    <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{it.empresaCnpj}</div>
                                </td>
                                <td className="py-2 px-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{it.teseNome}</td>
                                <td className="py-2 px-3 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{it.competencia}</td>
                                <td className="py-2 px-3 text-right font-mono font-bold" style={{ color: sevCor[it.severidade] }}>{brl(it.valorRecuperavel)}</td>
                                <td className="py-2 px-3 text-right text-xs" style={{ color: sevCor[it.severidade] }}>
                                    {it.diasRestantes < 0 ? `${Math.abs(it.diasRestantes)}d atrás` : `${it.diasRestantes}d`}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {lista.length > 500 && (
                    <p className="text-[11px] p-2" style={{ color: 'var(--text-muted)' }}>Mostrando 500 de {lista.length} itens.</p>
                )}
            </div>

            <p className="text-[11px] px-2" style={{ color: 'var(--text-muted)' }}>
                Prazo conta a partir do último dia da competência. Análise rodada agora — pra atualizar, clique "Recarregar".
            </p>
        </div>
    );
};

function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'success' | 'danger' | 'warning' }) {
    const cor = accent === 'success' ? 'var(--success)' : accent === 'danger' ? 'var(--danger)' : accent === 'warning' ? 'var(--warning)' : 'var(--text-primary)';
    return (
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className="text-lg font-bold" style={{ color: cor }}>{value}</p>
        </div>
    );
}

export default PrazosPrescricaoPanel;
