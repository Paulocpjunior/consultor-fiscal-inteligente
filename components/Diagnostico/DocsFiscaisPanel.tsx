/**
 * Painel de diagnóstico de saúde dos documentos_fiscais.
 *
 * Detecta notas com campos faltando que quebram o SPED gerador, cruzamentos
 * e pipelines: sem chave, sem competência, sem direção, sem valor, sem
 * empresaCnpj, e chave duplicada em 2+ docs.
 *
 * Roda sob demanda (pesa Firestore reads). Filtro opcional por empresa
 * pra restringir varredura. Só admin.
 */
import React, { useState } from 'react';
import {
    getDiagnosticoDocsFiscais,
    type DiagnosticoResposta, type AmostraDoc, type AmostraDuplicada,
} from '../../services/diagnosticoDocsFiscaisService';

interface Props { onShowToast?: (msg: string) => void; }

const problemaLabel: Record<string, string> = {
    sem_chave: 'Sem chave válida (44 díg)',
    sem_competencia: 'Sem competência YYYY-MM',
    sem_direcao: 'Sem direção (entrada/saída)',
    sem_valor: 'Sem valorTotal (ou 0)',
    sem_empresa: 'Sem empresaCnpj/empresaId',
    duplicada: 'Chave duplicada em 2+ docs',
};

const problemaImpacto: Record<string, string> = {
    sem_chave: 'Não cruza com SPED/XML capturado; não dedupplica.',
    sem_competencia: 'SPED gerador não inclui essa nota.',
    sem_direcao: 'Decisão entrada/saída quebra; itens não viram C170.',
    sem_valor: 'Cruzamentos de valor mostram divergência fake.',
    sem_empresa: 'Não aparece em nenhum painel de cobertura/análise.',
    duplicada: 'NF-e contada 2x — cruzamentos inflam valor.',
};

const DocsFiscaisPanel: React.FC<Props> = ({ onShowToast: _onShowToast }) => {
    const [empresaId, setEmpresaId] = useState('');
    const [data, setData] = useState<DiagnosticoResposta | null>(null);
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [tipoAberto, setTipoAberto] = useState<string | null>(null);

    const rodar = async () => {
        setLoading(true); setErro(null);
        try { setData(await getDiagnosticoDocsFiscais(empresaId.trim() || undefined)); }
        catch (e: any) { setErro(e?.message || 'Falha ao rodar diagnóstico'); }
        finally { setLoading(false); }
    };

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Diagnóstico — documentos_fiscais</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Varredura de saúde dos dados: notas com campos faltando que quebram
                    SPED gerador, cruzamentos e pipelines. Pesa Firestore reads — rode
                    sob demanda. Filtro por <b>empresaId</b> restringe a varredura.
                </p>
            </div>

            <div className="p-4 rounded-xl flex flex-wrap items-center gap-3" style={card}>
                <input type="text" placeholder="empresaId (opcional — em branco varre TUDO)"
                    value={empresaId} onChange={e => setEmpresaId(e.target.value)}
                    className="flex-1 min-w-[200px] p-2.5 text-sm rounded-lg outline-none"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                <button onClick={rodar} disabled={loading}
                    className="btn-press px-5 py-2.5 text-sm font-bold rounded-lg text-white"
                    style={{ background: 'var(--accent)' }}>
                    {loading ? 'Varrendo…' : 'Rodar diagnóstico'}
                </button>
            </div>

            {erro && (
                <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)' }}>{erro}</div>
            )}

            {data && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Kpi label="Docs analisados" value={String(data.totalDocs)} />
                        <Kpi label="Problemas detectados" value={String(data.totalProblemas)} accent={data.totalProblemas > 0 ? 'danger' : 'success'} />
                        <Kpi label="% com problema" value={data.totalDocs > 0 ? `${((data.totalProblemas / data.totalDocs) * 100).toFixed(1)}%` : '0%'} />
                        <Kpi label="Filtro" value={data.empresaIdFiltro || 'Todas'} />
                    </div>

                    <div className="space-y-2">
                        {Object.entries(data.problemas).map(([tipo, p]) => (
                            <div key={tipo} className="p-3 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderLeft: `4px solid ${p.count > 0 ? 'var(--danger)' : 'var(--success)'}` }}>
                                <button onClick={() => setTipoAberto(tipoAberto === tipo ? null : tipo)}
                                    className="w-full flex items-center justify-between gap-3 text-left">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{problemaLabel[tipo]}</p>
                                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{problemaImpacto[tipo]}</p>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xl font-bold" style={{ color: p.count > 0 ? 'var(--danger)' : 'var(--success)' }}>{p.count}</span>
                                        {p.amostras.length > 0 && (
                                            <span className="text-[10px] block" style={{ color: 'var(--text-muted)' }}>{tipoAberto === tipo ? '▲ ocultar' : '▼ ver amostras'}</span>
                                        )}
                                    </div>
                                </button>

                                {tipoAberto === tipo && p.amostras.length > 0 && (
                                    <div className="mt-3 overflow-x-auto">
                                        {tipo === 'duplicada' ? (
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr style={{ color: 'var(--text-muted)' }}>
                                                        <th className="py-1 px-2 text-left">Chave</th>
                                                        <th className="py-1 px-2 text-left">DocIds</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(p.amostras as AmostraDuplicada[]).map((a, i) => (
                                                        <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                                            <td className="py-1 px-2 font-mono">{a.chave} <span style={{ color: 'var(--text-muted)' }}>×{a.qtd}</span></td>
                                                            <td className="py-1 px-2 font-mono" style={{ color: 'var(--text-muted)' }}>{a.docIds.join(' · ')}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <table className="w-full text-xs">
                                                <thead>
                                                    <tr style={{ color: 'var(--text-muted)' }}>
                                                        <th className="py-1 px-2 text-left">DocId</th>
                                                        <th className="py-1 px-2 text-left">Empresa</th>
                                                        <th className="py-1 px-2 text-left">CNPJ</th>
                                                        <th className="py-1 px-2 text-left">Chave</th>
                                                        <th className="py-1 px-2 text-left">Competência</th>
                                                        <th className="py-1 px-2 text-left">Direção</th>
                                                        <th className="py-1 px-2 text-right">Valor</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(p.amostras as AmostraDoc[]).map((a, i) => (
                                                        <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                                            <td className="py-1 px-2 font-mono" style={{ color: 'var(--text-muted)' }}>{a.docId}</td>
                                                            <td className="py-1 px-2">{a.empresaNome || '—'}</td>
                                                            <td className="py-1 px-2 font-mono" style={{ color: 'var(--text-muted)' }}>{a.empresaCnpj || '—'}</td>
                                                            <td className="py-1 px-2 font-mono" style={{ color: 'var(--text-muted)' }}>{a.chave || '—'}</td>
                                                            <td className="py-1 px-2 font-mono">{a.competencia || '—'}</td>
                                                            <td className="py-1 px-2">{a.direcao || '—'}</td>
                                                            <td className="py-1 px-2 text-right font-mono">{a.valor ?? '—'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                        {p.count > p.amostras.length && (
                                            <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                                                Mostrando {p.amostras.length} de {p.count} ocorrências.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}
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

export default DocsFiscaisPanel;
