/**
 * Painel "saúde geral do sistema" — agrega as 4 frentes de diagnóstico
 * (cadastros, documentos, certificados, configurações) numa única tela.
 *
 * O mesmo endpoint backend serve pra cron noturno disparar email
 * "tem N problemas críticos hoje" sem precisar bater em 4 endpoints.
 */
import React, { useEffect, useState } from 'react';
import { getHealthConsolidado, type HealthConsolidadoResposta, type StatusGlobal } from '../../services/healthConsolidadoService';
import { SearchType } from '../../types';

interface Props {
    onShowToast?: (msg: string) => void;
    /** Callback pro App.tsx trocar de aba — usado nos botões "Ver detalhes"
     *  de cada seção. Sem isso o painel vira beco sem saída: usuário vê
     *  N críticos mas não tem como descer ao detalhe. */
    onNavegar?: (destino: SearchType) => void;
}

const statusCor: Record<StatusGlobal, string> = {
    ok: 'var(--success)',
    medio: 'var(--warning)',
    alto: '#ea580c',
    critico: 'var(--danger)',
    degraded: 'var(--text-muted)',
};
const statusLabel: Record<StatusGlobal, string> = {
    ok: 'TUDO OK',
    medio: 'ATENÇÃO',
    alto: 'ALTO',
    critico: 'CRÍTICO',
    degraded: 'DEGRADADO',
};

const SaudeGeralPanel: React.FC<Props> = ({ onShowToast: _onShowToast, onNavegar }) => {
    const [data, setData] = useState<HealthConsolidadoResposta | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);

    const carregar = async () => {
        setLoading(true); setErro(null);
        try { setData(await getHealthConsolidado()); }
        catch (e: any) { setErro(e?.message || 'Falha ao carregar'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, []);

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Status global gigante */}
            {data && (
                <div className="p-8 rounded-xl text-center" style={{ background: `linear-gradient(135deg, ${statusCor[data.status]}15, var(--bg-elevated))`, border: `2px solid ${statusCor[data.status]}` }}>
                    <p className="text-xs uppercase font-bold tracking-wider" style={{ color: 'var(--text-muted)' }}>Saúde do sistema</p>
                    <p className="text-5xl font-bold mt-2" style={{ color: statusCor[data.status] }}>{statusLabel[data.status]}</p>
                    {data.totais.critico > 0 && (
                        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                            <b>{data.totais.critico}</b> problema(s) crítico(s) e <b>{data.totais.alto}</b> alto(s)
                        </p>
                    )}
                    {data.status === 'ok' && (
                        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                            Cadastros, documentos, certificados e configurações: tudo verde.
                        </p>
                    )}
                </div>
            )}

            <div className="flex justify-end">
                <button onClick={carregar} disabled={loading}
                    className="px-3 py-2 text-xs font-bold rounded-lg"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                    {loading ? 'Carregando…' : 'Recarregar'}
                </button>
            </div>

            {erro && (
                <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)' }}>{erro}</div>
            )}

            {data && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Cadastros */}
                    <SecaoCard
                        titulo="📋 Cadastros"
                        cor={data.secoes.cadastros?.criticos ? 'var(--danger)' : 'var(--success)'}
                        card={card}
                        detalhes={onNavegar ? () => onNavegar(SearchType.DIAGNOSTICO_CADASTROS) : undefined}
                    >
                        {data.secoes.cadastros ? (
                            <Linhas linhas={[
                                ['Total empresas', String(data.secoes.cadastros.total)],
                                ['Críticos (sem UF/IBGE/CNPJ)', String(data.secoes.cadastros.criticos), data.secoes.cadastros.criticos > 0 ? 'var(--danger)' : undefined],
                                ['Altos (sem anexo/tipo)', String(data.secoes.cadastros.altos), data.secoes.cadastros.altos > 0 ? '#ea580c' : undefined],
                                ['Médios (CNAE/nome)', String(data.secoes.cadastros.medios)],
                                ['OK', String(data.secoes.cadastros.ok), 'var(--success)'],
                            ]} />
                        ) : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Indisponível</p>}
                    </SecaoCard>

                    {/* Documentos */}
                    <SecaoCard
                        titulo="📄 Documentos fiscais"
                        cor={(data.secoes.documentos?.semChave || 0) > 0 ? '#ea580c' : 'var(--success)'}
                        card={card}
                        detalhes={onNavegar ? () => onNavegar(SearchType.DIAGNOSTICO_DOCS) : undefined}
                    >
                        {data.secoes.documentos ? (
                            <Linhas linhas={[
                                ['Total docs', String(data.secoes.documentos.total)],
                                ['Sem chave (não cruza)', String(data.secoes.documentos.semChave), data.secoes.documentos.semChave > 0 ? 'var(--danger)' : undefined],
                                ['Sem competência', String(data.secoes.documentos.semCompetencia), data.secoes.documentos.semCompetencia > 0 ? '#ea580c' : undefined],
                                ['Sem direção', String(data.secoes.documentos.semDirecao)],
                                ['Sem valorTotal', String(data.secoes.documentos.semValor)],
                                ['Sem empresa', String(data.secoes.documentos.semEmpresa), data.secoes.documentos.semEmpresa > 0 ? 'var(--danger)' : undefined],
                                ['Duplicadas (chave em 2+)', String(data.secoes.documentos.duplicadas), data.secoes.documentos.duplicadas > 0 ? '#ea580c' : undefined],
                            ]} />
                        ) : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Indisponível</p>}
                    </SecaoCard>

                    {/* Certificados */}
                    <SecaoCard
                        titulo="🔐 Certificados digitais"
                        cor={(data.secoes.certificados?.expirados || 0) > 0 ? 'var(--danger)' : 'var(--success)'}
                        card={card}
                        detalhes={onNavegar ? () => onNavegar(SearchType.CERT_MONITOR) : undefined}
                    >
                        {data.secoes.certificados ? (
                            <Linhas linhas={[
                                ['Total certs', String(data.secoes.certificados.total)],
                                ['EXPIRADOS', String(data.secoes.certificados.expirados), data.secoes.certificados.expirados > 0 ? 'var(--danger)' : undefined],
                                ['Críticos (≤3d)', String(data.secoes.certificados.criticos), data.secoes.certificados.criticos > 0 ? 'var(--danger)' : undefined],
                                ['Urgentes (≤7d)', String(data.secoes.certificados.urgentes), data.secoes.certificados.urgentes > 0 ? '#ea580c' : undefined],
                                ['Atenção (≤30d)', String(data.secoes.certificados.atencao)],
                                ['OK (>30d)', String(data.secoes.certificados.ok), 'var(--success)'],
                            ]} />
                        ) : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Indisponível</p>}
                    </SecaoCard>

                    {/* Configurações */}
                    <SecaoCard
                        titulo="⚙ Configurações operacionais"
                        cor={(data.secoes.configuracoes?.criticos || 0) > 0 ? 'var(--danger)' : 'var(--success)'}
                        card={card}
                        detalhes={onNavegar ? () => onNavegar(SearchType.DIAGNOSTICO_CONFIG) : undefined}
                    >
                        {data.secoes.configuracoes ? (
                            <Linhas linhas={[
                                ['Total verificadas', String(data.secoes.configuracoes.total)],
                                ['Críticas faltando', String(data.secoes.configuracoes.criticos), data.secoes.configuracoes.criticos > 0 ? 'var(--danger)' : undefined],
                                ['Altas faltando', String(data.secoes.configuracoes.altos), data.secoes.configuracoes.altos > 0 ? '#ea580c' : undefined],
                                ['Médias faltando', String(data.secoes.configuracoes.medios)],
                            ]} />
                        ) : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Indisponível</p>}
                    </SecaoCard>
                </div>
            )}

            {data && data._erros.length > 0 && (
                <div className="p-3 rounded-xl text-sm" style={{ background: 'var(--warning-soft)', border: '1px solid var(--warning-soft-border)', borderLeft: '4px solid var(--warning)', color: 'var(--text-secondary)' }}>
                    <b style={{ color: 'var(--warning)' }}>⚠ Leitura parcial:</b> {data._erros.length} seção(ões) falharam.
                    <ul className="mt-1 ml-4 text-xs list-disc">
                        {data._erros.map((e, i) => <li key={i}><b>{e.secao}</b>: {e.erro}</li>)}
                    </ul>
                </div>
            )}

            {data && (
                <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>
                    Mesmo endpoint /api/admin/health-consolidado pode ser usado pelo cron noturno
                    pra disparar email automático. Retorna HTTP <b>503</b> se status=crítico,
                    <b>200</b> caso contrário.
                </p>
            )}
        </div>
    );
};

function SecaoCard({ titulo, cor, card, children, detalhes }: {
    titulo: string;
    cor: string;
    card: React.CSSProperties;
    children: React.ReactNode;
    /** Quando informado, mostra botão "Ver detalhes →" no cabeçalho. */
    detalhes?: () => void;
}) {
    return (
        <div className="p-4 rounded-xl" style={{ ...card, borderLeft: `4px solid ${cor}` }}>
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{titulo}</h3>
                {detalhes && (
                    <button
                        onClick={detalhes}
                        className="text-[11px] font-bold px-2.5 py-1 rounded transition-colors hover:opacity-80"
                        style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-soft-border, transparent)' }}
                        title="Abre a aba específica com a lista detalhada e filtros"
                    >
                        Ver detalhes →
                    </button>
                )}
            </div>
            {children}
        </div>
    );
}

function Linhas({ linhas }: { linhas: Array<[string, string, string?]> }) {
    return (
        <table className="w-full text-sm">
            <tbody>
                {linhas.map(([label, valor, cor], i) => (
                    <tr key={i} style={{ borderTop: i === 0 ? undefined : '1px solid var(--border-subtle)' }}>
                        <td className="py-1 text-xs" style={{ color: 'var(--text-muted)' }}>{label}</td>
                        <td className="py-1 text-right font-bold font-mono" style={{ color: cor || 'var(--text-primary)' }}>{valor}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default SaudeGeralPanel;
