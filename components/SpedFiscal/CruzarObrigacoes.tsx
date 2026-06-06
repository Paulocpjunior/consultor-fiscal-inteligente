/**
 * CruzarObrigacoes — cruzamento SPED Fiscal (EFD ICMS/IPI) × SPED Contribuições
 * (EFD PIS/COFINS) da MESMA empresa/competência.
 *
 * As NF-e (C100) são escrituradas nas duas obrigações; a mesma chave deve
 * aparecer nos dois arquivos com o mesmo VL_DOC. O painel sobe os dois .txt,
 * parseia local (módulos puros) e mostra: divergências de valor (erro), notas
 * presentes só em uma das obrigações (aviso) e o resumo.
 */
import React, { useState } from 'react';
import { parseSped, cruzarObrigacoes, type CruzamentoObrigacoes } from '../../services/spedFiscalExcelEditor';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const tipoCor: Record<string, string> = {
    DIVERGENCIA_VALOR: 'var(--danger)',
    SO_FISCAL: 'var(--warning)',
    SO_CONTRIB: '#ea580c',
};
const tipoLabel: Record<string, string> = {
    DIVERGENCIA_VALOR: 'Valor diverge',
    SO_FISCAL: 'Só no Fiscal',
    SO_CONTRIB: 'Só no Contrib.',
};

const CruzarObrigacoes: React.FC = () => {
    const [arqFiscal, setArqFiscal] = useState<File | null>(null);
    const [arqContrib, setArqContrib] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [data, setData] = useState<CruzamentoObrigacoes | null>(null);
    const [filtro, setFiltro] = useState<'todos' | 'erro' | 'aviso'>('todos');

    const handleCruzar = async () => {
        if (!arqFiscal || !arqContrib) { setErro('Selecione os DOIS arquivos: SPED Fiscal e SPED Contribuições.'); return; }
        setLoading(true); setErro(null); setData(null);
        try {
            const [txtA, txtB] = await Promise.all([arqFiscal.text(), arqContrib.text()]);
            const [pa, pb] = await Promise.all([parseSped(txtA), parseSped(txtB)]);
            const r = await cruzarObrigacoes(pa, pb);
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
                <p className="text-xs font-bold" style={{ color: 'var(--accent)' }}>Cruzamento entre obrigações</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Suba o <b>SPED Fiscal</b> e o <b>SPED Contribuições</b> da mesma empresa e competência.
                    Comparamos as NF-e (C100) por chave: notas com valor divergente entre as duas obrigações
                    são <b>erro</b>; notas presentes em só uma delas são <b>aviso</b> (pode ser legítimo —
                    o contador decide). Processado 100% no navegador.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <UploadBox titulo="SPED Fiscal (EFD ICMS/IPI)" arquivo={arqFiscal} onPick={f => { setArqFiscal(f); setData(null); }} />
                <UploadBox titulo="SPED Contribuições (EFD PIS/COFINS)" arquivo={arqContrib} onPick={f => { setArqContrib(f); setData(null); }} />
            </div>

            <div className="flex justify-center">
                <button
                    onClick={handleCruzar}
                    disabled={loading || !arqFiscal || !arqContrib}
                    className="btn-press px-8 py-4 text-white font-bold text-base rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'var(--accent)', minWidth: '280px' }}
                >
                    {loading
                        ? <span className="flex items-center justify-center gap-3"><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Cruzando…</span>
                        : 'Cruzar obrigações'}
                </button>
            </div>

            {erro && (
                <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)' }}>
                    {erro}
                </div>
            )}

            {data?.aplicavel && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Kpi label="NF-e no Fiscal" value={String(data.resumo.totalFiscal)} />
                        <Kpi label="NF-e no Contrib." value={String(data.resumo.totalContrib)} />
                        <Kpi label="Em ambos" value={String(data.resumo.emAmbos)} accent="success" />
                        <Kpi label="Valor diverge" value={String(data.resumo.divergenciasValor)} accent={data.resumo.divergenciasValor ? 'danger' : 'success'} />
                        <Kpi label="Só no Fiscal" value={String(data.resumo.soFiscal)} accent={data.resumo.soFiscal ? 'warning' : undefined} />
                        <Kpi label="Só no Contrib." value={String(data.resumo.soContrib)} accent={data.resumo.soContrib ? 'warning' : undefined} />
                        {(data.resumo.semChaveFiscal > 0 || data.resumo.semChaveContrib > 0) && (
                            <Kpi label="Sem chave (não cruzadas)" value={`${data.resumo.semChaveFiscal + data.resumo.semChaveContrib}`} />
                        )}
                    </div>

                    {data.achados.length === 0 ? (
                        <div className="p-4 rounded-xl text-sm" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: 'var(--success)' }}>
                            ✓ Nenhuma divergência — todas as NF-e batem entre as duas obrigações.
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
                                        <th className="py-2 px-2 text-right">Fiscal</th>
                                        <th className="py-2 px-2 text-right">Contrib.</th>
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
                                                <div style={{ color: 'var(--text-primary)' }}>nº {a.numDoc || '—'}</div>
                                                <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{a.chave}</div>
                                            </td>
                                            <td className="py-2 px-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{a.vlFiscal ? brl(a.vlFiscal) : '—'}</td>
                                            <td className="py-2 px-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{a.vlContrib ? brl(a.vlContrib) : '—'}</td>
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
                </>
            )}
        </div>
    );
};

function UploadBox({ titulo, arquivo, onPick }: { titulo: string; arquivo: File | null; onPick: (f: File | null) => void }) {
    return (
        <label className="flex flex-col items-center justify-center gap-1 p-5 rounded-xl cursor-pointer border-2 border-dashed transition-colors"
            style={{ borderColor: arquivo ? 'var(--accent)' : 'var(--border-default)', background: 'var(--bg-card)' }}>
            <span className="text-2xl">{arquivo ? '✅' : '📄'}</span>
            <span className="text-xs font-bold text-center" style={{ color: 'var(--text-primary)' }}>{titulo}</span>
            <span className="text-[11px] font-mono text-center truncate max-w-full" style={{ color: 'var(--text-muted)' }}>
                {arquivo ? arquivo.name : 'clique para selecionar o .txt'}
            </span>
            <input type="file" accept=".txt" className="hidden" onChange={e => onPick(e.target.files?.[0] || null)} />
        </label>
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

export default CruzarObrigacoes;
