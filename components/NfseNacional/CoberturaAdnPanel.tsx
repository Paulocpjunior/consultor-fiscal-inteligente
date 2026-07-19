/**
 * Painel de cobertura ADN (NFS-e Nacional).
 *
 * Resolve o problema "temos clientes de várias partes do Brasil": em vez de
 * construir N provedores municipais, a NFS-e Nacional unifica via ADN. O
 * gargalo real é que a captura por empresa exige nfseNacionalDfeAtivo=true
 * (default false), então a maioria dos clientes hoje NÃO está sendo capturada.
 *
 * Este painel: lista todas as empresas, mostra quem está ativa e quem já tem
 * histórico de captura, e permite ligar/desligar individual ou em massa.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    getCoberturaAdn, toggleAdnEmpresa, toggleAdnBulk,
    type CoberturaResposta, type EmpresaCobertura,
} from '../../services/nfseNacionalCoberturaService';
import { useConfirm } from '../dialog/DialogProvider';

interface Props {
    onShowToast?: (msg: string) => void;
}

const fmtDate = (iso: string | null) => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch { return iso; }
};

type Filtro = 'todas' | 'ativas' | 'inativas' | 'sem-captura' | 'bloqueadas';

const CoberturaAdnPanel: React.FC<Props> = ({ onShowToast }) => {
    const confirm = useConfirm();
    const [data, setData] = useState<CoberturaResposta | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<Filtro>('todas');
    const [busca, setBusca] = useState('');
    const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);

    const carregar = async () => {
        setLoading(true);
        setErro(null);
        try {
            const r = await getCoberturaAdn();
            setData(r);
        } catch (e: any) {
            setErro(e?.message || 'Falha ao carregar cobertura');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { carregar(); }, []);

    const listaFiltrada = useMemo(() => {
        if (!data) return [];
        const q = busca.trim().toLowerCase();
        return data.empresas.filter((e) => {
            if (filtro === 'ativas' && !e.ativo) return false;
            if (filtro === 'inativas' && e.ativo) return false;
            if (filtro === 'sem-captura' && (e.state?.ultimaSync)) return false;
            if (filtro === 'bloqueadas' && !(e.ativo && e.certOk === false)) return false;
            if (!q) return true;
            return e.nome.toLowerCase().includes(q) || e.cnpj.includes(q.replace(/\D/g, ''));
        });
    }, [data, filtro, busca]);

    const handleToggle = async (e: EmpresaCobertura) => {
        setAcaoEmCurso(e.cnpj);
        try {
            await toggleAdnEmpresa(e.cnpj, !e.ativo);
            onShowToast?.(`${e.nome}: captura ADN ${!e.ativo ? 'habilitada' : 'desabilitada'}`);
            await carregar();
        } catch (err: any) {
            onShowToast?.(`Erro: ${err.message}`);
        } finally {
            setAcaoEmCurso(null);
        }
    };

    const handleHabilitarTodasInativas = async () => {
        if (!data) return;
        const cnpjs = data.empresas.filter((e) => !e.ativo).map((e) => e.cnpj);
        if (!cnpjs.length) { onShowToast?.('Todas as empresas já estão habilitadas.'); return; }
        const ok = await confirm({
            title: `Habilitar ADN em ${cnpjs.length} empresa(s)?`,
            message: (
                <>
                    A ADN exige o certificado A1 próprio de cada CNPJ (mesma raiz) — não
                    aceita o certificado do escritório nem procuração (erro E2243). Empresas
                    sem A1 válido ficarão habilitadas mas vão falhar no cron — sem perda de
                    dados, só log de erro. Veja a coluna <em>Certificado (A1)</em>.
                </>
            ),
            variant: 'warning',
            confirmLabel: 'Habilitar',
        });
        if (!ok) return;
        setAcaoEmCurso('bulk');
        try {
            const r = await toggleAdnBulk(cnpjs, true);
            onShowToast?.(`Habilitadas: ${r.atualizados}/${r.total}`
                + (r.naoEncontrados ? ` · não encontradas: ${r.naoEncontrados}` : '')
                + (r.falhas ? ` · falhas: ${r.falhas}` : ''));
            await carregar();
        } catch (err: any) {
            onShowToast?.(`Erro: ${err.message}`);
        } finally {
            setAcaoEmCurso(null);
        }
    };

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header + KPIs */}
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Cobertura NFS-e Nacional (ADN)</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    A ADN unifica a captura de NFS-e de todos os municípios. Hoje, a captura só roda
                    pra empresa com a flag <code className="text-xs">nfseNacionalDfeAtivo=true</code> —
                    quem está em vermelho não está sendo capturada nacionalmente.
                </p>

                {data && (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
                        <Kpi label="Total empresas" value={String(data.total)} />
                        <Kpi label="Ativas (ADN ligada)" value={`${data.ativas} (${data.percentualAtivas}%)`} accent="success" />
                        <Kpi label="Capturando de fato" value={`${data.capturando ?? '—'}`} accent="success" />
                        <Kpi label="Ligadas s/ A1 (falham)" value={`${data.ativasBloqueadas ?? 0}`} accent={(data.ativasBloqueadas ?? 0) > 0 ? 'danger' : 'success'} />
                        <Kpi label="Prontas p/ ligar" value={`${data.prontasParaLigar ?? 0}`} />
                        <Kpi label="Com captura efetiva" value={`${data.comCaptura} (${data.percentualCaptura}%)`} />
                    </div>
                )}
            </div>

            {/* Toolbar */}
            <div className="p-4 rounded-xl flex flex-wrap items-center gap-3" style={card}>
                <input
                    type="text"
                    placeholder="Buscar por nome ou CNPJ…"
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    className="flex-1 min-w-[200px] p-2.5 text-sm rounded-lg outline-none"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                />
                <div className="flex gap-1 text-xs">
                    {(['todas', 'ativas', 'inativas', 'sem-captura', 'bloqueadas'] as Filtro[]).map(f => (
                        <button
                            key={f}
                            onClick={() => setFiltro(f)}
                            className="px-3 py-2 rounded-lg font-bold transition-colors"
                            style={{
                                background: filtro === f ? 'var(--accent)' : 'var(--bg-card)',
                                color: filtro === f ? '#fff' : 'var(--text-muted)',
                                border: `1px solid ${filtro === f ? 'var(--accent)' : 'var(--border-default)'}`,
                            }}
                        >
                            {f === 'todas' ? 'Todas' : f === 'ativas' ? 'Ativas' : f === 'inativas' ? 'Inativas' : f === 'sem-captura' ? 'Sem captura' : 'Ligadas s/ A1'}
                        </button>
                    ))}
                </div>
                <button
                    onClick={handleHabilitarTodasInativas}
                    disabled={!data || acaoEmCurso !== null || data.inativas === 0}
                    className="px-4 py-2 text-xs font-bold rounded-lg transition-colors disabled:opacity-40"
                    style={{ background: 'var(--success)', color: '#fff', border: '1px solid var(--success)' }}
                >
                    {acaoEmCurso === 'bulk' ? 'Habilitando…' : `Habilitar todas inativas (${data?.inativas ?? 0})`}
                </button>
                <button
                    onClick={carregar}
                    disabled={loading}
                    className="px-3 py-2 text-xs font-bold rounded-lg transition-colors"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
                >
                    {loading ? 'Carregando…' : 'Recarregar'}
                </button>
            </div>

            {erro && (
                <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)' }}>
                    {erro}
                </div>
            )}

            {/* Lista */}
            <div className="p-2 rounded-xl" style={card}>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-default)' }}>
                            <th className="py-2 px-3">Empresa</th>
                            <th className="py-2 px-3">CNPJ</th>
                            <th className="py-2 px-3">Fonte</th>
                            <th className="py-2 px-3">Captura ADN</th>
                            <th className="py-2 px-3">Certificado (A1)</th>
                            <th className="py-2 px-3">Última sync</th>
                            <th className="py-2 px-3 text-right">Ação</th>
                        </tr>
                    </thead>
                    <tbody>
                        {listaFiltrada.length === 0 && (
                            <tr>
                                <td colSpan={7} className="py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                                    {loading ? 'Carregando…' : 'Nenhuma empresa nos filtros atuais.'}
                                </td>
                            </tr>
                        )}
                        {listaFiltrada.map((e) => (
                            <tr key={e.cnpj} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                <td className="py-2 px-3 font-medium" style={{ color: 'var(--text-primary)' }}>{e.nome || '—'}</td>
                                <td className="py-2 px-3 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{e.cnpj}</td>
                                <td className="py-2 px-3 text-xs uppercase" style={{ color: 'var(--text-muted)' }}>{e.fonte}</td>
                                <td className="py-2 px-3">
                                    <span
                                        className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                                        style={{
                                            background: e.ativo ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                                            color: e.ativo ? 'var(--success)' : 'var(--danger)',
                                        }}
                                    >
                                        {e.ativo ? '✓ Ativa' : '○ Inativa'}
                                    </span>
                                </td>
                                <td className="py-2 px-3">
                                    {e.certOk === false ? (
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--danger)' }} title={e.motivoBloqueio || ''}>
                                            ✗ {e.motivoBloqueio ? (e.motivoBloqueio.length > 42 ? e.motivoBloqueio.slice(0, 41) + '…' : e.motivoBloqueio) : 'sem A1 válido'}
                                        </span>
                                    ) : e.certOk === true ? (
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--success)' }}>✓ A1 ok</span>
                                    ) : (
                                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>—</span>
                                    )}
                                </td>
                                <td className="py-2 px-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                    {e.state?.ultimaSync ? fmtDate(e.state.ultimaSync) : '—'}
                                    {e.state?.ultNSU && <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>NSU {e.state.ultNSU}</div>}
                                </td>
                                <td className="py-2 px-3 text-right">
                                    <button
                                        onClick={() => handleToggle(e)}
                                        disabled={acaoEmCurso !== null}
                                        className="px-3 py-1 text-xs font-bold rounded transition-colors disabled:opacity-40"
                                        style={{
                                            background: e.ativo ? 'var(--bg-card)' : 'var(--success)',
                                            color: e.ativo ? 'var(--danger)' : '#fff',
                                            border: `1px solid ${e.ativo ? 'var(--border-default)' : 'var(--success)'}`,
                                        }}
                                    >
                                        {acaoEmCurso === e.cnpj ? '…' : (e.ativo ? 'Desligar' : 'Habilitar')}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="text-[11px] px-2" style={{ color: 'var(--text-muted)' }}>
                A captura ADN exige o <strong>certificado A1 próprio</strong> de cada empresa (mesma raiz
                de CNPJ) — o certificado do escritório é rejeitado com E2243, e a ADN não tem procuração
                (em desenvolvimento pela SERPRO, sem data). A coluna <em>Certificado (A1)</em> mostra quem
                está pronto; use o filtro <strong>Ligadas s/ A1</strong> para achar quem está habilitado mas
                vai falhar no cron.
            </p>
        </div>
    );
};

function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'success' | 'danger' }) {
    const cor = accent === 'success' ? 'var(--success)' : accent === 'danger' ? 'var(--danger)' : 'var(--text-primary)';
    return (
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
            <p className="text-xl font-bold" style={{ color: cor }}>{value}</p>
        </div>
    );
}

export default CoberturaAdnPanel;
