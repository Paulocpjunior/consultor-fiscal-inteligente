/**
 * CruzarComCapturadas — cruzamento SPED Fiscal × NF-e capturadas no sistema.
 *
 * Pega a empresa + competência, busca todas as NF-e capturadas (status
 * autorizado) e cruza contra o SPED Fiscal que o admin subir. Detecta:
 *   - NF-e capturada AUTORIZADA mas NAO escriturada -> ERRO (risco de malha)
 *   - NF-e escriturada com valor != XML capturado    -> ERRO
 *   - NF-e escriturada sem XML capturado             -> AVISO (captura incompleta)
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '../../types';
import { getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { useEmpresaAtivaId } from '../../services/empresaAtivaContext';
import EmpresaAtivaFixa from '../../components/EmpresaAtivaFixa';
import { auth } from '../../services/firebaseConfig';
import { formatCnpjCpf } from '../../services/xmlParserService';
import { parseSped, cruzarComCapturadas, type CruzamentoCapturados, type NfeCapturada } from '../../services/spedFiscalExcelEditor';

interface Props { currentUser: User | null; }

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const tipoCor: Record<string, string> = {
    NAO_ESCRITURADA: 'var(--danger)',
    DIVERGENCIA_VALOR: 'var(--danger)',
    SEM_CAPTURA: 'var(--warning)',
    SEM_VALOR_CAPTURADO: 'var(--warning)',
};
const tipoLabel: Record<string, string> = {
    NAO_ESCRITURADA: 'NÃO escriturada',
    DIVERGENCIA_VALOR: 'Valor diverge',
    SEM_CAPTURA: 'Sem captura',
    SEM_VALOR_CAPTURADO: 'XML sem valor',
};

function getCompetenciaAtual() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const CruzarComCapturadas: React.FC<Props> = ({ currentUser }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    // A EMPRESA É A ATIVA DA SESSÃO (Paulo, 15/08 — "tira os seletores
    // internos"): módulo por-cliente não pergunta de novo em qual cliente
    // está. O cartão fixo diz, e a troca é uma só, no topo.
    const empresaId = useEmpresaAtivaId();
    const [competencia, setCompetencia] = useState(getCompetenciaAtual());
    const [arqSped, setArqSped] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [data, setData] = useState<CruzamentoCapturados | null>(null);
    const [capturadasInfo, setCapturadasInfo] = useState<{ total: number; descartadas: number } | null>(null);
    const [filtro, setFiltro] = useState<'todos' | 'erro' | 'aviso'>('todos');

    useEffect(() => {
        if (!currentUser) return;
        getEmpresasDisponiveis(currentUser).then(list => {
            setEmpresas(list);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser]);

    const empresaSel = useMemo(() => empresas.find(e => e.id === empresaId), [empresas, empresaId]);

    const handleCruzar = async () => {
        if (!empresaId) { setErro('Selecione a empresa.'); return; }
        if (!arqSped) { setErro('Selecione o SPED Fiscal (.txt).'); return; }
        setLoading(true); setErro(null); setData(null); setCapturadasInfo(null);
        try {
            const token = await auth?.currentUser?.getIdToken();
            if (!token) throw new Error('Sessão expirada');

            const qs = new URLSearchParams({ empresaId, competencia });
            const respCap = await fetch(`/api/admin/sped-fiscal/nfes-capturadas?${qs}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!respCap.ok) {
                const err = await respCap.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${respCap.status}`);
            }
            const cap = await respCap.json();
            setCapturadasInfo({ total: cap.total, descartadas: cap.descartadas });

            const txt = await arqSped.text();
            const parsed = await parseSped(txt);
            const r = await cruzarComCapturadas(parsed, cap.nfes as NfeCapturada[]);
            setData(r);
            if (!r.aplicavel) setErro(r.motivo || 'Não aplicável');
        } catch (e: any) {
            setErro(e?.message || 'Falha no cruzamento');
        } finally {
            setLoading(false);
        }
    };

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };
    const achadosFiltrados = (data?.achados || []).filter(a => filtro === 'todos' || a.severidade === filtro);

    return (
        <div className="space-y-5 animate-fade-in">
            <div className="p-4 rounded-xl" style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-soft)', borderLeft: '4px solid var(--accent)' }}>
                <p className="text-xs font-bold" style={{ color: 'var(--accent)' }}>SPED Fiscal × NF-e capturadas</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Compara o SPED Fiscal que você subiu contra as <b>NF-e autorizadas já capturadas</b>{' '}
                    no sistema (mesmos XMLs que alimentam o gerador). Caça <b>nota não escriturada</b>{' '}
                    (risco de malha), <b>divergência de valor</b> e nota escriturada <b>sem XML capturado</b>{' '}
                    (captura incompleta — contador decide).
                </p>
            </div>

            {/* Empresa + competência */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl" style={card}>
                    <EmpresaAtivaFixa rotulo="Empresa" />
                </div>
                <div className="p-4 rounded-xl" style={card}>
                    <label className="text-xs uppercase font-medium block mb-2" style={{ color: 'var(--text-muted)' }}>Competência</label>
                    <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)}
                        className="w-full p-2.5 text-sm rounded-lg outline-none"
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                </div>
            </div>

            {/* Upload SPED */}
            <label className="flex flex-col items-center justify-center gap-1 p-5 rounded-xl cursor-pointer border-2 border-dashed"
                style={{ borderColor: arqSped ? 'var(--accent)' : 'var(--border-default)', background: 'var(--bg-card)' }}>
                <span className="text-2xl">{arqSped ? '✅' : '📄'}</span>
                <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>SPED Fiscal (EFD ICMS/IPI)</span>
                <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{arqSped?.name || 'clique para selecionar o .txt'}</span>
                <input type="file" accept=".txt" className="hidden" onChange={e => { setArqSped(e.target.files?.[0] || null); setData(null); }} />
            </label>

            <div className="flex justify-center">
                <button onClick={handleCruzar} disabled={loading || !empresaId || !arqSped}
                    className="btn-press px-8 py-4 text-white font-bold text-base rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'var(--accent)', minWidth: '280px' }}>
                    {loading
                        ? <span className="flex items-center justify-center gap-3"><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Cruzando…</span>
                        : 'Cruzar SPED × Capturadas'}
                </button>
            </div>

            {erro && (
                <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)' }}>{erro}</div>
            )}

            {data?.aplicavel && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Kpi label="NF-e no SPED" value={String(data.resumo.totalSped)} />
                        <Kpi label="NF-e capturadas" value={String(data.resumo.totalCapturadas)} />
                        <Kpi label="Em ambos" value={String(data.resumo.emAmbos)} accent="success" />
                        <Kpi label="NÃO escrituradas" value={String(data.resumo.naoEscrituradas)} accent={data.resumo.naoEscrituradas ? 'danger' : 'success'} />
                        <Kpi label="Sem captura" value={String(data.resumo.semCaptura)} accent={data.resumo.semCaptura ? 'warning' : undefined} />
                        <Kpi label="Valor diverge" value={String(data.resumo.divergenciasValor)} accent={data.resumo.divergenciasValor ? 'danger' : 'success'} />
                        {capturadasInfo && capturadasInfo.descartadas > 0 && (
                            <Kpi label="Capturadas s/ chave (descartadas)" value={String(capturadasInfo.descartadas)} />
                        )}
                    </div>

                    {data.achados.length === 0 ? (
                        <div className="p-4 rounded-xl text-sm" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: 'var(--success)' }}>
                            ✓ Nenhuma divergência — todas as NF-e capturadas estão na escrituração com o valor correto.
                        </div>
                    ) : (
                        <div className="p-2 rounded-xl" style={card}>
                            <div className="flex gap-1 text-xs p-2">
                                {(['todos', 'erro', 'aviso'] as const).map(f => (
                                    <button key={f} onClick={() => setFiltro(f)} className="px-3 py-1.5 rounded-lg font-bold"
                                        style={{ background: filtro === f ? 'var(--accent)' : 'var(--bg-card)', color: filtro === f ? '#fff' : 'var(--text-muted)', border: `1px solid ${filtro === f ? 'var(--accent)' : 'var(--border-default)'}` }}>
                                        {f === 'todos' ? `Todos (${data.achados.length})` : f === 'erro' ? `Erros (${data.achados.filter(a => a.severidade === 'erro').length})` : `Avisos (${data.achados.filter(a => a.severidade === 'aviso').length})`}
                                    </button>
                                ))}
                            </div>
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-default)' }}>
                                        <th className="py-2 px-2">Tipo</th>
                                        <th className="py-2 px-2">Nota</th>
                                        <th className="py-2 px-2 text-right">SPED</th>
                                        <th className="py-2 px-2 text-right">Capturado</th>
                                        <th className="py-2 px-2 text-right">Diferença</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {achadosFiltrados.slice(0, 500).map((a, i) => (
                                        <tr key={a.chave + i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                            <td className="py-2 px-2">
                                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ color: '#fff', background: tipoCor[a.tipo] }}>{tipoLabel[a.tipo]}</span>
                                            </td>
                                            <td className="py-2 px-2">
                                                <div style={{ color: 'var(--text-primary)' }}>nº {a.numDoc || '—'}{a.direcao && <span className="text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>({a.direcao})</span>}</div>
                                                <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{a.chave}</div>
                                            </td>
                                            <td className="py-2 px-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{a.vlSped ? brl(a.vlSped) : '—'}</td>
                                            <td className="py-2 px-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{a.vlCapturado ? brl(a.vlCapturado) : '—'}</td>
                                            <td className="py-2 px-2 text-right font-mono" style={{ color: tipoCor[a.tipo] }}>{a.diferenca ? brl(a.diferenca) : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {achadosFiltrados.length > 500 && (
                                <p className="text-[11px] p-2" style={{ color: 'var(--text-muted)' }}>Mostrando 500 de {achadosFiltrados.length} achados.</p>
                            )}
                        </div>
                    )}

                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        Comparação por chave de 44 dígitos (modelo 55). NFS-e não entra. Notas
                        canceladas/denegadas/inutilizadas ficam de fora dos dois lados. Tolerância R$ 0,01.
                    </p>
                </>
            )}
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

export default CruzarComCapturadas;
