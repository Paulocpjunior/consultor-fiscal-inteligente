/**
 * NFP Pro Cloud — Painel de compliance tributário.
 *
 * Abas: Dashboard | Débitos | Obrigações | Certidões | Parcelamentos |
 *       Ações Judiciais | Plano de Ação | Análise
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import type {
    User,
    NfpAnaliseEmpresa,
    NfpDebito,
    NfpParcelamento,
    NfpCertidao,
    NfpObrigacao,
    NfpAcaoJudicial,
    NfpPlanoAcao,
    NfpEsfera,
    NfpGravidade,
    NfpStatusDebito,
    NfpStatusCertidao,
    NfpStatusObrigacao,
    NfpTipoAcao,
} from '../../types';
import { getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import * as nfpService from '../../services/nfpProCloudService';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

type Tab = 'dashboard' | 'debitos' | 'obrigacoes' | 'certidoes' | 'parcelamentos' | 'acoes' | 'plano' | 'analise';

const TABS: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'debitos', label: 'Débitos' },
    { key: 'obrigacoes', label: 'Obrigações' },
    { key: 'certidoes', label: 'Certidões' },
    { key: 'parcelamentos', label: 'Parcelamentos' },
    { key: 'acoes', label: 'Ações Judiciais' },
    { key: 'plano', label: 'Plano de Ação' },
    { key: 'analise', label: 'Análise' },
];

const OBRIGACOES_BASE = [
    { nome: 'DEFIS', sigla: 'DEFIS', esfera: 'federal' as NfpEsfera, periodicidade: 'anual' as const },
    { nome: 'ECD', sigla: 'ECD', esfera: 'federal' as NfpEsfera, periodicidade: 'anual' as const },
    { nome: 'ECF', sigla: 'ECF', esfera: 'federal' as NfpEsfera, periodicidade: 'anual' as const },
    { nome: 'SPED Fiscal', sigla: 'EFD', esfera: 'federal' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'SPED Contribuições', sigla: 'EFD-C', esfera: 'federal' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'eSocial', sigla: 'eSocial', esfera: 'federal' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'FGTS Digital', sigla: 'FGTS', esfera: 'federal' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'DCTFWeb', sigla: 'DCTFWeb', esfera: 'federal' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'DIRF', sigla: 'DIRF', esfera: 'federal' as NfpEsfera, periodicidade: 'anual' as const },
    { nome: 'RAIS', sigla: 'RAIS', esfera: 'federal' as NfpEsfera, periodicidade: 'anual' as const },
];

const CERTIDOES_BASE = [
    { orgao: 'Receita Federal / PGFN', tipo: 'CND Federal', esfera: 'federal' as NfpEsfera },
    { orgao: 'Secretaria da Fazenda Estadual', tipo: 'CND Estadual', esfera: 'estadual' as NfpEsfera },
    { orgao: 'Prefeitura Municipal', tipo: 'CND Municipal', esfera: 'municipal' as NfpEsfera },
    { orgao: 'Caixa Econômica Federal', tipo: 'CRF (FGTS)', esfera: 'federal' as NfpEsfera },
    { orgao: 'Justiça do Trabalho', tipo: 'CNDT (Trabalhista)', esfera: 'federal' as NfpEsfera },
];

function uid(): string {
    return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

function formatCurrency(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function gravityColor(g: NfpGravidade): string {
    if (g === 'alta') return 'var(--danger)';
    if (g === 'media') return 'var(--warning)';
    return 'var(--accent)';
}

function certidaoColor(status: NfpStatusCertidao): string {
    if (status === 'negativa') return 'var(--success)';
    if (status === 'positiva_efeitos_negativa') return 'var(--warning)';
    if (status === 'positiva') return 'var(--danger)';
    return 'var(--text-muted)';
}

function certidaoLabel(status: NfpStatusCertidao): string {
    if (status === 'negativa') return 'Negativa';
    if (status === 'positiva_efeitos_negativa') return 'Positiva c/ Efeitos Negativa';
    if (status === 'positiva') return 'Positiva';
    if (status === 'indisponivel') return 'Indisponível';
    return 'Não consultada';
}

const NfpProCloud: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [tab, setTab] = useState<Tab>('dashboard');
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [selectedEmpresaId, setSelectedEmpresaId] = useState<string>('');
    const [analise, setAnalise] = useState<NfpAnaliseEmpresa | null>(null);
    const [loading, setLoading] = useState(false);
    const [taxaSelic, setTaxaSelic] = useState(13.25);

    // Análise tab state
    const [fonteAnalise, setFonteAnalise] = useState<'certificado_escritorio' | 'certificado_cliente' | 'offline'>('certificado_escritorio');

    useEffect(() => {
        getEmpresasDisponiveis(currentUser).then(setEmpresas).catch(() => {});
    }, [currentUser]);

    // Load analysis when empresa changes
    useEffect(() => {
        if (!selectedEmpresaId) { setAnalise(null); return; }
        setLoading(true);
        nfpService.getAnalise(selectedEmpresaId)
            .then(a => setAnalise(a))
            .catch(() => setAnalise(null))
            .finally(() => setLoading(false));
    }, [selectedEmpresaId]);

    const selectedEmpresa = useMemo(() => empresas.find(e => e.id === selectedEmpresaId), [empresas, selectedEmpresaId]);

    // Helpers to mutate analysis in state
    const updateAnalise = useCallback((patch: Partial<NfpAnaliseEmpresa>) => {
        setAnalise(prev => {
            if (!prev) return prev;
            return { ...prev, ...patch };
        });
    }, []);

    const saveAnalise = useCallback(async (a: NfpAnaliseEmpresa) => {
        if (!currentUser) return;
        try {
            await nfpService.salvarAnalise(a, currentUser);
            onShowToast?.('Análise salva com sucesso');
        } catch (e: any) {
            onShowToast?.('Erro ao salvar: ' + (e?.message || 'desconhecido'));
        }
    }, [currentUser, onShowToast]);

    const createEmptyAnalise = useCallback((): NfpAnaliseEmpresa => ({
        empresaId: selectedEmpresaId,
        empresaNome: selectedEmpresa?.nome || '',
        empresaCnpj: selectedEmpresa?.cnpj || '',
        dataAnalise: new Date().toISOString(),
        analisadoPor: currentUser?.name || '',
        fonte: fonteAnalise,
        debitos: [],
        parcelamentos: [],
        certidoes: CERTIDOES_BASE.map(c => ({
            id: uid(),
            empresaId: selectedEmpresaId,
            esfera: c.esfera,
            orgao: c.orgao,
            tipo: c.tipo,
            status: 'nao_consultada' as NfpStatusCertidao,
        })),
        obrigacoes: OBRIGACOES_BASE.map(o => ({
            id: uid(),
            empresaId: selectedEmpresaId,
            nome: o.nome,
            sigla: o.sigla,
            esfera: o.esfera,
            periodicidade: o.periodicidade,
            status: 'nao_verificada' as NfpStatusObrigacao,
        })),
        acoes: [],
        planoAcao: [],
    }), [selectedEmpresaId, selectedEmpresa, currentUser, fonteAnalise]);

    // ─── Render Helpers ─────────────────────────────────────────────────────

    const renderDashboard = () => {
        if (!analise) return <p style={{ color: 'var(--text-muted)' }}>Selecione uma empresa e inicie uma análise na aba "Análise".</p>;
        const debitosAbertos = analise.debitos.filter(d => d.status === 'aberto');
        const certNeg = analise.certidoes.filter(c => c.status === 'negativa').length;
        const certPos = analise.certidoes.filter(c => c.status === 'positiva').length;
        const obrigPend = analise.obrigacoes.filter(o => o.status === 'pendente' || o.status === 'atrasada').length;
        const acoesAtivas = analise.acoes.filter(a => a.status === 'em_andamento').length;
        const planoAlta = analise.planoAcao.filter(p => p.gravidade === 'alta' && p.status !== 'concluida').length;

        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                <DashCard title="Débitos Abertos" value={String(debitosAbertos.length)} sub={formatCurrency(debitosAbertos.reduce((s, d) => s + (d.valorAtualizado || d.valorOriginal), 0))} color="var(--danger)" />
                <DashCard title="Certidões Negativas" value={`${certNeg}/${analise.certidoes.length}`} sub={certPos > 0 ? `${certPos} positiva(s)` : 'Sem impedimentos'} color={certPos > 0 ? 'var(--danger)' : 'var(--success)'} />
                <DashCard title="Obrigações Pendentes" value={String(obrigPend)} sub={`de ${analise.obrigacoes.length} totais`} color={obrigPend > 0 ? 'var(--warning)' : 'var(--success)'} />
                <DashCard title="Ações em Andamento" value={String(acoesAtivas)} sub={`de ${analise.acoes.length} totais`} color={acoesAtivas > 0 ? 'var(--warning)' : 'var(--success)'} />
                <DashCard title="Plano de Ação (Alta)" value={String(planoAlta)} sub={`de ${analise.planoAcao.length} itens`} color={planoAlta > 0 ? 'var(--danger)' : 'var(--success)'} />
                <DashCard title="Parcelamentos Ativos" value={String(analise.parcelamentos.filter(p => p.status === 'ativo').length)} sub={formatCurrency(analise.parcelamentos.filter(p => p.status === 'ativo').reduce((s, p) => s + p.valorTotal, 0))} color="var(--accent)" />
            </div>
        );
    };

    const renderDebitos = () => {
        if (!analise) return null;
        const debitos = nfpService.atualizarDebitosSelic(analise.debitos, taxaSelic);

        const addDebito = () => {
            const novo: NfpDebito = {
                id: uid(), empresaId: selectedEmpresaId, esfera: 'federal',
                orgao: '', descricao: '', valorOriginal: 0, dataVencimento: new Date().toISOString().slice(0, 10), status: 'aberto',
            };
            const updated = { ...analise, debitos: [...analise.debitos, novo] };
            setAnalise(updated);
        };

        const removeDebito = (id: string) => {
            const updated = { ...analise, debitos: analise.debitos.filter(d => d.id !== id) };
            setAnalise(updated);
        };

        const updateDebito = (id: string, patch: Partial<NfpDebito>) => {
            const updated = { ...analise, debitos: analise.debitos.map(d => d.id === id ? { ...d, ...patch } : d) };
            setAnalise(updated);
        };

        return (
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        Taxa Selic (% a.a.):
                        <input type="number" value={taxaSelic} onChange={e => setTaxaSelic(Number(e.target.value))} step="0.01"
                            style={{ marginLeft: '0.5rem', width: '80px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
                    </label>
                    <button onClick={addDebito} style={btnStyle}>+ Adicionar Débito</button>
                    <button onClick={() => { updateAnalise({ debitos: analise.debitos }); saveAnalise({ ...analise, debitos: analise.debitos }); }} style={btnStyleSave}>Salvar</button>
                </div>
                {debitos.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhum débito registrado.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {debitos.map(d => (
                        <div key={d.id} style={cardStyle}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'center' }}>
                                <input placeholder="Descrição" value={d.descricao} onChange={e => updateDebito(d.id, { descricao: e.target.value })} style={inputStyle} />
                                <select value={d.esfera} onChange={e => updateDebito(d.id, { esfera: e.target.value as NfpEsfera })} style={inputStyle}>
                                    <option value="federal">Federal</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option>
                                </select>
                                <select value={d.status} onChange={e => updateDebito(d.id, { status: e.target.value as NfpStatusDebito })} style={inputStyle}>
                                    <option value="aberto">Aberto</option><option value="parcelado">Parcelado</option><option value="em_analise">Em análise</option><option value="quitado">Quitado</option><option value="prescrito">Prescrito</option>
                                </select>
                                <button onClick={() => removeDebito(d.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <label style={labelSmall}>Órgão<input value={d.orgao} onChange={e => updateDebito(d.id, { orgao: e.target.value })} style={inputStyle} /></label>
                                <label style={labelSmall}>Valor Original<input type="number" value={d.valorOriginal} onChange={e => updateDebito(d.id, { valorOriginal: Number(e.target.value) })} style={inputStyle} /></label>
                                <label style={labelSmall}>Vencimento<input type="date" value={d.dataVencimento} onChange={e => updateDebito(d.id, { dataVencimento: e.target.value })} style={inputStyle} /></label>
                                <div style={labelSmall}>Valor Atualizado<div style={{ fontWeight: 700, color: 'var(--danger)', marginTop: '4px' }}>{formatCurrency(d.valorAtualizado || d.valorOriginal)}</div></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderObrigacoes = () => {
        if (!analise) return null;

        const updateObrigacao = (id: string, status: NfpStatusObrigacao) => {
            updateAnalise({ obrigacoes: analise.obrigacoes.map(o => o.id === id ? { ...o, status } : o) });
        };

        const statusBadge = (s: NfpStatusObrigacao) => {
            const colors: Record<NfpStatusObrigacao, string> = {
                entregue: 'var(--success)', pendente: 'var(--warning)', atrasada: 'var(--danger)', dispensada: 'var(--text-muted)', nao_verificada: 'var(--border-default)',
            };
            return <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: colors[s] + '22', color: colors[s], border: `1px solid ${colors[s]}44` }}>{s.replace('_', ' ')}</span>;
        };

        return (
            <div>
                <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => saveAnalise(analise)} style={btnStyleSave}>Salvar</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {analise.obrigacoes.map(o => (
                        <div key={o.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                                <strong style={{ color: 'var(--text-primary)' }}>{o.sigla}</strong>
                                <span style={{ marginLeft: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{o.nome} ({o.periodicidade})</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                {statusBadge(o.status)}
                                <select value={o.status} onChange={e => updateObrigacao(o.id, e.target.value as NfpStatusObrigacao)} style={{ ...inputStyle, width: 'auto', fontSize: '0.8rem' }}>
                                    <option value="entregue">Entregue</option><option value="pendente">Pendente</option><option value="atrasada">Atrasada</option><option value="dispensada">Dispensada</option><option value="nao_verificada">Não verificada</option>
                                </select>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderCertidoes = () => {
        if (!analise) return null;

        const updateCertidao = (id: string, patch: Partial<NfpCertidao>) => {
            updateAnalise({ certidoes: analise.certidoes.map(c => c.id === id ? { ...c, ...patch } : c) });
        };

        return (
            <div>
                <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => saveAnalise(analise)} style={btnStyleSave}>Salvar</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {analise.certidoes.map(c => (
                        <div key={c.id} style={cardStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                                <div>
                                    <strong style={{ color: 'var(--text-primary)' }}>{c.tipo}</strong>
                                    <span style={{ marginLeft: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{c.orgao}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <span style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, background: certidaoColor(c.status) + '22', color: certidaoColor(c.status), border: `1px solid ${certidaoColor(c.status)}44` }}>
                                        {certidaoLabel(c.status)}
                                    </span>
                                    <select value={c.status} onChange={e => updateCertidao(c.id, { status: e.target.value as NfpStatusCertidao })} style={{ ...inputStyle, width: 'auto', fontSize: '0.8rem' }}>
                                        <option value="negativa">Negativa</option><option value="positiva_efeitos_negativa">Positiva c/ Efeitos Negativa</option><option value="positiva">Positiva</option><option value="indisponivel">Indisponível</option><option value="nao_consultada">Não consultada</option>
                                    </select>
                                </div>
                            </div>
                            {c.status === 'positiva' && (
                                <div style={{ marginTop: '0.5rem' }}>
                                    <input placeholder="Motivo do impedimento" value={c.motivoImpedimento || ''} onChange={e => updateCertidao(c.id, { motivoImpedimento: e.target.value })}
                                        style={{ ...inputStyle, width: '100%' }} />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderParcelamentos = () => {
        if (!analise) return null;

        const addParcelamento = () => {
            const novo: NfpParcelamento = {
                id: uid(), empresaId: selectedEmpresaId, esfera: 'federal',
                programa: '', valorTotal: 0, parcelas: 1, parcelasPagas: 0, valorParcela: 0, status: 'ativo', dataInicio: new Date().toISOString().slice(0, 10),
            };
            updateAnalise({ parcelamentos: [...analise.parcelamentos, novo] });
        };

        const updateParc = (id: string, patch: Partial<NfpParcelamento>) => {
            updateAnalise({ parcelamentos: analise.parcelamentos.map(p => p.id === id ? { ...p, ...patch } : p) });
        };

        const removeParc = (id: string) => {
            updateAnalise({ parcelamentos: analise.parcelamentos.filter(p => p.id !== id) });
        };

        return (
            <div>
                <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                    <button onClick={addParcelamento} style={btnStyle}>+ Adicionar</button>
                    <button onClick={() => saveAnalise(analise)} style={btnStyleSave}>Salvar</button>
                </div>
                {analise.parcelamentos.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhum parcelamento.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {analise.parcelamentos.map(p => {
                        const pct = p.parcelas > 0 ? Math.round((p.parcelasPagas / p.parcelas) * 100) : 0;
                        return (
                            <div key={p.id} style={cardStyle}>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'center' }}>
                                    <input placeholder="Programa" value={p.programa} onChange={e => updateParc(p.id, { programa: e.target.value })} style={inputStyle} />
                                    <select value={p.status} onChange={e => updateParc(p.id, { status: e.target.value as any })} style={inputStyle}>
                                        <option value="ativo">Ativo</option><option value="inadimplente">Inadimplente</option><option value="quitado">Quitado</option><option value="cancelado">Cancelado</option>
                                    </select>
                                    <select value={p.esfera} onChange={e => updateParc(p.id, { esfera: e.target.value as NfpEsfera })} style={inputStyle}>
                                        <option value="federal">Federal</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option>
                                    </select>
                                    <button onClick={() => removeParc(p.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                                    <label style={labelSmall}>Valor Total<input type="number" value={p.valorTotal} onChange={e => updateParc(p.id, { valorTotal: Number(e.target.value) })} style={inputStyle} /></label>
                                    <label style={labelSmall}>Parcelas<input type="number" value={p.parcelas} onChange={e => updateParc(p.id, { parcelas: Number(e.target.value) })} style={inputStyle} /></label>
                                    <label style={labelSmall}>Pagas<input type="number" value={p.parcelasPagas} onChange={e => updateParc(p.id, { parcelasPagas: Number(e.target.value) })} style={inputStyle} /></label>
                                    <label style={labelSmall}>Valor Parcela<input type="number" value={p.valorParcela} onChange={e => updateParc(p.id, { valorParcela: Number(e.target.value) })} style={inputStyle} /></label>
                                </div>
                                <div style={{ marginTop: '0.5rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: 'var(--border-default)' }}>
                                            <div style={{ width: `${pct}%`, height: '100%', borderRadius: '4px', background: pct === 100 ? 'var(--success)' : 'var(--accent)', transition: 'width 0.3s' }} />
                                        </div>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: '45px' }}>{pct}%</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const renderAcoes = () => {
        if (!analise) return null;

        const addAcao = () => {
            const nova: NfpAcaoJudicial = {
                id: uid(), empresaId: selectedEmpresaId, tipo: 'tributaria', descricao: '', status: 'em_andamento',
            };
            updateAnalise({ acoes: [...analise.acoes, nova] });
        };

        const updateAcao = (id: string, patch: Partial<NfpAcaoJudicial>) => {
            updateAnalise({ acoes: analise.acoes.map(a => a.id === id ? { ...a, ...patch } : a) });
        };

        const removeAcao = (id: string) => {
            updateAnalise({ acoes: analise.acoes.filter(a => a.id !== id) });
        };

        return (
            <div>
                <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                    <button onClick={addAcao} style={btnStyle}>+ Adicionar</button>
                    <button onClick={() => saveAnalise(analise)} style={btnStyleSave}>Salvar</button>
                </div>
                {analise.acoes.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhuma ação judicial registrada.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {analise.acoes.map(a => (
                        <div key={a.id} style={cardStyle}>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'center' }}>
                                <input placeholder="Descrição" value={a.descricao} onChange={e => updateAcao(a.id, { descricao: e.target.value })} style={inputStyle} />
                                <select value={a.tipo} onChange={e => updateAcao(a.id, { tipo: e.target.value as NfpTipoAcao })} style={inputStyle}>
                                    <option value="civil">Civil</option><option value="trabalhista">Trabalhista</option><option value="tributaria">Tributária</option><option value="criminal">Criminal</option>
                                </select>
                                <select value={a.status} onChange={e => updateAcao(a.id, { status: e.target.value as any })} style={inputStyle}>
                                    <option value="em_andamento">Em andamento</option><option value="encerrada">Encerrada</option><option value="arquivada">Arquivada</option>
                                </select>
                                <button onClick={() => removeAcao(a.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <label style={labelSmall}>Numero<input value={a.numero || ''} onChange={e => updateAcao(a.id, { numero: e.target.value })} style={inputStyle} /></label>
                                <label style={labelSmall}>Vara<input value={a.vara || ''} onChange={e => updateAcao(a.id, { vara: e.target.value })} style={inputStyle} /></label>
                                <label style={labelSmall}>Valor Causa<input type="number" value={a.valorCausa || 0} onChange={e => updateAcao(a.id, { valorCausa: Number(e.target.value) })} style={inputStyle} /></label>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderPlanoAcao = () => {
        if (!analise) return null;

        const sorted = [...analise.planoAcao].sort((a, b) => {
            const order: Record<NfpGravidade, number> = { alta: 0, media: 1, baixa: 2 };
            return order[a.gravidade] - order[b.gravidade];
        });

        const addPlano = () => {
            const novo: NfpPlanoAcao = {
                id: uid(), empresaId: selectedEmpresaId, descricao: '', gravidade: 'media', esfera: 'federal', status: 'pendente',
            };
            updateAnalise({ planoAcao: [...analise.planoAcao, novo] });
        };

        const updatePlano = (id: string, patch: Partial<NfpPlanoAcao>) => {
            updateAnalise({ planoAcao: analise.planoAcao.map(p => p.id === id ? { ...p, ...patch } : p) });
        };

        const removePlano = (id: string) => {
            updateAnalise({ planoAcao: analise.planoAcao.filter(p => p.id !== id) });
        };

        return (
            <div>
                <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                    <button onClick={addPlano} style={btnStyle}>+ Adicionar</button>
                    <button onClick={() => saveAnalise(analise)} style={btnStyleSave}>Salvar</button>
                </div>
                {sorted.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhum item no plano de acao.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {sorted.map(p => (
                        <div key={p.id} style={{ ...cardStyle, borderLeft: `4px solid ${gravityColor(p.gravidade)}` }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'center' }}>
                                <input placeholder="Descrição da ação" value={p.descricao} onChange={e => updatePlano(p.id, { descricao: e.target.value })} style={inputStyle} />
                                <select value={p.gravidade} onChange={e => updatePlano(p.id, { gravidade: e.target.value as NfpGravidade })} style={inputStyle}>
                                    <option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option>
                                </select>
                                <select value={p.esfera} onChange={e => updatePlano(p.id, { esfera: e.target.value as NfpEsfera })} style={inputStyle}>
                                    <option value="federal">Federal</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option>
                                </select>
                                <select value={p.status} onChange={e => updatePlano(p.id, { status: e.target.value as any })} style={inputStyle}>
                                    <option value="pendente">Pendente</option><option value="em_andamento">Em andamento</option><option value="concluida">Concluída</option>
                                </select>
                                <button onClick={() => removePlano(p.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <label style={labelSmall}>Prazo<input type="date" value={p.prazo || ''} onChange={e => updatePlano(p.id, { prazo: e.target.value })} style={inputStyle} /></label>
                                <label style={labelSmall}>Responsável<input value={p.responsavel || ''} onChange={e => updatePlano(p.id, { responsavel: e.target.value })} style={inputStyle} /></label>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderAnalise = () => (
        <div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Inicie uma nova análise de compliance para a empresa selecionada. Escolha a fonte dos dados e clique em "Iniciar Análise".
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '400px' }}>
                <label style={labelSmall}>
                    Fonte de Dados
                    <select value={fonteAnalise} onChange={e => setFonteAnalise(e.target.value as any)} style={{ ...inputStyle, width: '100%', marginTop: '4px' }}>
                        <option value="certificado_escritorio">Certificado Digital do Escritório</option>
                        <option value="certificado_cliente">Certificado Digital do Cliente</option>
                        <option value="offline">Offline (lançamento manual)</option>
                    </select>
                </label>
                <button
                    disabled={!selectedEmpresaId}
                    onClick={() => {
                        const nova = createEmptyAnalise();
                        setAnalise(nova);
                        saveAnalise(nova);
                        setTab('dashboard');
                    }}
                    style={{ ...btnStyle, opacity: selectedEmpresaId ? 1 : 0.5 }}
                >
                    Iniciar Análise
                </button>
                {analise && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        Última análise: {new Date(analise.dataAnalise).toLocaleDateString('pt-BR')} por {analise.analisadoPor} (fonte: {analise.fonte})
                    </p>
                )}
            </div>
        </div>
    );

    // ─── Main Render ────────────────────────────────────────────────────────

    return (
        <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
            <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.5rem', marginBottom: '0.5rem' }}>NFP Pro Cloud</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>Compliance tributário: débitos, certidões, obrigações, parcelamentos e plano de ação.</p>

            {/* Empresa selector */}
            <div style={{ marginBottom: '1.5rem' }}>
                <select
                    value={selectedEmpresaId}
                    onChange={e => setSelectedEmpresaId(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-default)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.9rem', minWidth: '300px' }}
                >
                    <option value="">Selecione uma empresa...</option>
                    {empresas.map(e => (
                        <option key={e.id} value={e.id}>{e.nome} ({e.cnpj})</option>
                    ))}
                </select>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '2px', marginBottom: '1.5rem', overflowX: 'auto', borderBottom: '2px solid var(--border-subtle)', paddingBottom: '0' }}>
                {TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        style={{
                            padding: '8px 14px',
                            fontSize: '0.85rem',
                            fontWeight: tab === t.key ? 700 : 500,
                            color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            marginBottom: '-2px',
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            {loading && <p style={{ color: 'var(--text-muted)' }}>Carregando...</p>}
            {!loading && !selectedEmpresaId && <p style={{ color: 'var(--text-muted)' }}>Selecione uma empresa para visualizar a análise de compliance.</p>}
            {!loading && selectedEmpresaId && (
                <div>
                    {tab === 'dashboard' && renderDashboard()}
                    {tab === 'debitos' && renderDebitos()}
                    {tab === 'obrigacoes' && renderObrigacoes()}
                    {tab === 'certidoes' && renderCertidoes()}
                    {tab === 'parcelamentos' && renderParcelamentos()}
                    {tab === 'acoes' && renderAcoes()}
                    {tab === 'plano' && renderPlanoAcao()}
                    {tab === 'analise' && renderAnalise()}
                </div>
            )}
        </div>
    );
};

// ─── Dashboard Card Component ────────────────────────────────────────────────

const DashCard: React.FC<{ title: string; value: string; sub: string; color: string }> = ({ title, value, sub, color }) => (
    <div style={{ padding: '1rem', borderRadius: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>{title}</span>
        <span style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{sub}</span>
    </div>
);

// ─── Shared Styles ───────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
    padding: '1rem',
    borderRadius: '10px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border-subtle)',
};

const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid var(--border-default)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
    width: '100%',
};

const labelSmall: React.CSSProperties = {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
};

const btnStyle: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '8px',
    border: '1px solid var(--accent)',
    background: 'transparent',
    color: 'var(--accent)',
    fontWeight: 600,
    fontSize: '0.85rem',
    cursor: 'pointer',
};

const btnStyleSave: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '8px',
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    fontWeight: 600,
    fontSize: '0.85rem',
    cursor: 'pointer',
};

export default NfpProCloud;
