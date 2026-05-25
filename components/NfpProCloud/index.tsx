/**
 * NFP Pro Cloud — Painel de compliance tributário.
 *
 * Abas: Dashboard | Débitos | Obrigações | Certidões | Parcelamentos |
 *       Ações Judiciais | Plano de Ação | Análise
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import type {
    User,
    CnpjData,
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
import { auth } from '../../services/firebaseConfig';
import { fetchCnpjFromBrasilAPI } from '../../services/externalApiService';
import CertificadoEmpresaUpload from '../CertificadoEmpresaUpload';

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

/** Aplica máscara XX.XXX.XXX/XXXX-XX ao digitar. */
function applyCnpjMask(raw: string): string {
    const digits = raw.replace(/\D/g, '').slice(0, 14);
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
    if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
    if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

/** Dados estendidos do prospect (BrasilAPI retorna situacao_cadastral). */
interface ProspectData extends CnpjData {
    cnpj: string;
    situacaoCadastral: string;
    descricaoSituacaoCadastral: string;
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
    const [analiseRealLoading, setAnaliseRealLoading] = useState(false);

    // Prospect mode state
    const [prospectMode, setProspectMode] = useState(false);
    const [prospectCnpjInput, setProspectCnpjInput] = useState('');
    const [prospectLoading, setProspectLoading] = useState(false);
    const [prospectError, setProspectError] = useState('');
    const [prospectData, setProspectData] = useState<ProspectData | null>(null);

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

    // Derived helpers for prospect mode
    const prospectCnpjClean = useMemo(() => prospectCnpjInput.replace(/\D/g, ''), [prospectCnpjInput]);
    const activeEmpresaId = prospectMode && prospectData ? `prospect_${prospectData.cnpj}` : selectedEmpresaId;
    const activeCnpj = prospectMode && prospectData ? prospectData.cnpj : (selectedEmpresa?.cnpj || '');
    const activeNome = prospectMode && prospectData ? (prospectData.nomeFantasia || prospectData.razaoSocial) : (selectedEmpresa?.nome || '');
    const hasActiveSelection = prospectMode ? !!prospectData : !!selectedEmpresaId;

    // Reset prospect state when toggling modes
    useEffect(() => {
        if (!prospectMode) {
            setProspectData(null);
            setProspectCnpjInput('');
            setProspectError('');
        } else {
            setSelectedEmpresaId('');
            setAnalise(null);
        }
    }, [prospectMode]);

    // When prospect mode, default fonte to certificado_cliente
    useEffect(() => {
        if (prospectMode) {
            setFonteAnalise('certificado_cliente');
        }
    }, [prospectMode]);

    /** Consultar CNPJ do prospect via BrasilAPI. */
    const handleProspectLookup = useCallback(async () => {
        const cnpj = prospectCnpjInput.replace(/\D/g, '');
        if (cnpj.length !== 14) {
            setProspectError('CNPJ deve conter 14 dígitos.');
            return;
        }
        setProspectLoading(true);
        setProspectError('');
        setProspectData(null);
        setAnalise(null);

        try {
            // Fetch full company data from BrasilAPI (with fallback to CNPJ.ws)
            const parsed = await fetchCnpjFromBrasilAPI(cnpj);

            // Also fetch raw BrasilAPI response for situacao_cadastral
            let situacao = '';
            let descSituacao = '';
            try {
                const rawResp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
                    headers: { 'Accept': 'application/json' },
                });
                if (rawResp.ok) {
                    const raw = await rawResp.json();
                    situacao = String(raw.situacao_cadastral ?? raw.descricao_situacao_cadastral ?? '');
                    descSituacao = raw.descricao_situacao_cadastral || '';
                    // BrasilAPI uses numeric codes: 2 = Ativa, 3 = Suspensa, 4 = Inapta, 8 = Baixada
                    if (!descSituacao) {
                        const map: Record<string, string> = { '2': 'Ativa', '3': 'Suspensa', '4': 'Inapta', '8': 'Baixada' };
                        descSituacao = map[situacao] || situacao;
                    }
                }
            } catch { /* situacao stays empty */ }

            const data: ProspectData = {
                ...parsed,
                cnpj,
                situacaoCadastral: situacao,
                descricaoSituacaoCadastral: descSituacao,
            };
            setProspectData(data);
            onShowToast?.(`Empresa encontrada: ${data.razaoSocial}`);
        } catch (e: any) {
            setProspectError(e?.message || 'Erro ao consultar CNPJ.');
        } finally {
            setProspectLoading(false);
        }
    }, [prospectCnpjInput, onShowToast]);

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
        empresaId: activeEmpresaId,
        empresaNome: activeNome,
        empresaCnpj: activeCnpj,
        dataAnalise: new Date().toISOString(),
        analisadoPor: currentUser?.name || '',
        fonte: fonteAnalise,
        debitos: [],
        parcelamentos: [],
        certidoes: CERTIDOES_BASE.map(c => ({
            id: uid(),
            empresaId: activeEmpresaId,
            esfera: c.esfera,
            orgao: c.orgao,
            tipo: c.tipo,
            status: 'nao_consultada' as NfpStatusCertidao,
        })),
        obrigacoes: OBRIGACOES_BASE.map(o => ({
            id: uid(),
            empresaId: activeEmpresaId,
            nome: o.nome,
            sigla: o.sigla,
            esfera: o.esfera,
            periodicidade: o.periodicidade,
            status: 'nao_verificada' as NfpStatusObrigacao,
        })),
        acoes: [],
        planoAcao: [],
    }), [activeEmpresaId, activeNome, activeCnpj, currentUser, fonteAnalise]);

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

    const handleAnaliseReal = useCallback(async () => {
        if (!activeCnpj) return;
        setAnaliseRealLoading(true);
        try {
            const resp = await nfpService.analisarEmpresaCompleta(activeCnpj);
            // Create or update analysis from SERPRO response
            const base = analise || createEmptyAnalise();

            // Populate debitos from situacaoFiscal + dividaAtiva
            const debitos: NfpDebito[] = [];
            if (resp.situacaoFiscal?.ok && resp.situacaoFiscal.debitos) {
                for (const d of resp.situacaoFiscal.debitos) {
                    debitos.push({
                        id: uid(), empresaId: activeEmpresaId, esfera: 'federal' as NfpEsfera,
                        orgao: 'Receita Federal', descricao: d.tributo || d.descricao || 'Débito Federal',
                        valorOriginal: Number(d.valorOriginal || 0), dataVencimento: d.competencia || new Date().toISOString().slice(0, 10),
                        status: (d.status === 'quitado' ? 'quitado' : 'aberto') as NfpStatusDebito,
                    });
                }
            }
            if (resp.dividaAtiva?.ok && resp.dividaAtiva.inscricoes) {
                for (const i of resp.dividaAtiva.inscricoes) {
                    debitos.push({
                        id: uid(), empresaId: activeEmpresaId, esfera: 'federal' as NfpEsfera,
                        orgao: 'PGFN', descricao: `Dívida Ativa ${i.numero || ''}`.trim(),
                        valorOriginal: Number(i.valorConsolidado || 0), dataVencimento: i.dataInscricao || new Date().toISOString().slice(0, 10),
                        status: 'aberto' as NfpStatusDebito,
                    });
                }
            }

            // Populate certidoes
            const certidoes: NfpCertidao[] = CERTIDOES_BASE.map(c => {
                const match = resp.certidoes?.certidoes?.find((rc: any) => {
                    const esf = String(rc.esfera || '').toLowerCase();
                    if (c.esfera === 'federal' && c.tipo.includes('CND Federal') && esf === 'federal') return true;
                    if (c.esfera === 'estadual' && esf === 'estadual') return true;
                    if (c.tipo.includes('CNDT') && esf === 'trabalhista') return true;
                    if (c.tipo.includes('FGTS') && esf === 'fgts') return true;
                    return false;
                });
                return {
                    id: uid(), empresaId: activeEmpresaId, esfera: c.esfera,
                    orgao: c.orgao, tipo: c.tipo,
                    status: (match?.status as NfpStatusCertidao) || 'nao_consultada',
                    dataValidade: match?.validade || undefined,
                    motivoImpedimento: match?.motivo || undefined,
                };
            });

            // Populate obrigacoes
            const obrigacoes: NfpObrigacao[] = OBRIGACOES_BASE.map(o => {
                const match = resp.obrigacoes?.obrigacoes?.find((ro: any) =>
                    (ro.sigla || '').toUpperCase() === o.sigla.toUpperCase()
                );
                return {
                    id: uid(), empresaId: activeEmpresaId,
                    nome: o.nome, sigla: o.sigla, esfera: o.esfera, periodicidade: o.periodicidade,
                    status: (match?.status as NfpStatusObrigacao) || 'nao_verificada',
                    competencia: match?.competencia || undefined,
                };
            });

            // Populate parcelamentos
            const parcelamentos: NfpParcelamento[] = [];
            if (resp.parcelamentos?.ok && resp.parcelamentos.parcelamentos) {
                for (const p of resp.parcelamentos.parcelamentos) {
                    parcelamentos.push({
                        id: uid(), empresaId: activeEmpresaId, esfera: 'federal' as NfpEsfera,
                        programa: p.programa || '', valorTotal: Number(p.valorTotal || 0),
                        parcelas: Number(p.parcelas || 0), parcelasPagas: Number(p.parcelasPagas || 0),
                        valorParcela: p.parcelas > 0 ? Math.round((p.valorTotal / p.parcelas) * 100) / 100 : 0,
                        status: (p.status || 'ativo') as any, dataInicio: p.dataInicio || new Date().toISOString().slice(0, 10),
                    });
                }
            }

            const updated: NfpAnaliseEmpresa = {
                ...base,
                dataAnalise: new Date().toISOString(),
                analisadoPor: currentUser?.name || '',
                fonte: fonteAnalise,
                debitos: debitos.length > 0 ? debitos : base.debitos,
                certidoes: resp.certidoes?.ok ? certidoes : base.certidoes,
                obrigacoes: resp.obrigacoes?.ok ? obrigacoes : base.obrigacoes,
                parcelamentos: parcelamentos.length > 0 ? parcelamentos : base.parcelamentos,
            };

            setAnalise(updated);
            if (!prospectMode) {
                await saveAnalise(updated);
            }
            onShowToast?.('Análise real SERPRO concluída com sucesso');
            setTab('dashboard');
        } catch (e: any) {
            onShowToast?.('Erro na análise real: ' + (e?.message || 'desconhecido'));
        } finally {
            setAnaliseRealLoading(false);
        }
    }, [activeCnpj, activeEmpresaId, analise, createEmptyAnalise, currentUser, fonteAnalise, prospectMode, saveAnalise, onShowToast]);

    const renderAnalise = () => {
        const canStart = hasActiveSelection;
        const canStartReal = hasActiveSelection && !!activeCnpj && !analiseRealLoading;

        return (
            <div>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                    Inicie uma nova análise de compliance para {prospectMode ? 'o prospect' : 'a empresa selecionada'}.
                    Escolha a fonte dos dados e clique em "Iniciar Análise".
                </p>

                {prospectMode && (
                    <span style={{
                        display: 'inline-block', marginBottom: '1rem', padding: '3px 10px',
                        borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700,
                        background: 'var(--accent)22', color: 'var(--accent)',
                        border: '1px solid var(--accent)44',
                    }}>
                        Modo Prospect
                    </span>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '500px' }}>
                    <label style={labelSmall}>
                        Fonte de Dados
                        <select value={fonteAnalise} onChange={e => setFonteAnalise(e.target.value as any)} style={{ ...inputStyle, width: '100%', marginTop: '4px' }}>
                            <option value="certificado_escritorio">Certificado Digital do Escritorio</option>
                            <option value="certificado_cliente">Certificado Digital do Cliente</option>
                            <option value="offline">Offline (lancamento manual)</option>
                        </select>
                    </label>

                    {/* Certificate upload for prospect mode */}
                    {prospectMode && prospectData && fonteAnalise === 'certificado_cliente' && (
                        <div style={{ ...cardStyle, borderLeft: '4px solid var(--accent)' }}>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                                Upload do Certificado Digital A1 (necessario para analise real via SEFAZ)
                            </p>
                            <CertificadoEmpresaUpload
                                empresaId={`prospect_${prospectData.cnpj}`}
                                empresaNome={prospectData.nomeFantasia || prospectData.razaoSocial}
                                empresaCnpj={prospectData.cnpj}
                            />
                        </div>
                    )}

                    <button
                        disabled={!canStart}
                        onClick={() => {
                            const nova = createEmptyAnalise();
                            setAnalise(nova);
                            if (!prospectMode) saveAnalise(nova);
                            setTab('dashboard');
                        }}
                        style={{ ...btnStyle, opacity: canStart ? 1 : 0.5 }}
                    >
                        Iniciar Analise
                    </button>
                    <button
                        disabled={!canStartReal}
                        onClick={handleAnaliseReal}
                        style={{
                            ...btnStyleSave,
                            opacity: canStartReal ? 1 : 0.5,
                        }}
                    >
                        {analiseRealLoading ? 'Consultando SERPRO...' : 'Iniciar Analise Real'}
                    </button>
                    {analiseRealLoading && (
                        <p style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>
                            Consultando situacao fiscal, divida ativa, certidoes, obrigacoes e parcelamentos via SERPRO...
                        </p>
                    )}
                    {analise && (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            Ultima analise: {new Date(analise.dataAnalise).toLocaleDateString('pt-BR')} por {analise.analisadoPor} (fonte: {analise.fonte})
                        </p>
                    )}
                </div>
            </div>
        );
    };

    // ─── Main Render ────────────────────────────────────────────────────────

    return (
        <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.5rem', margin: 0 }}>NFP Pro Cloud</h2>
                {prospectMode && (
                    <span style={{
                        padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700,
                        background: 'var(--accent)22', color: 'var(--accent)', border: '1px solid var(--accent)44',
                    }}>
                        Modo Prospect
                    </span>
                )}
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                Compliance tributario: debitos, certidoes, obrigacoes, parcelamentos e plano de acao.
            </p>

            {/* Mode toggle: Cliente cadastrado vs Prospect */}
            <div style={{
                marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '10px',
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
            }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Modo:</span>
                <button
                    onClick={() => setProspectMode(false)}
                    style={{
                        padding: '6px 14px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                        border: !prospectMode ? '2px solid var(--accent)' : '1px solid var(--border-default)',
                        background: !prospectMode ? 'var(--accent)11' : 'transparent',
                        color: !prospectMode ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                >
                    Analisar cliente cadastrado
                </button>
                <button
                    onClick={() => setProspectMode(true)}
                    style={{
                        padding: '6px 14px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                        border: prospectMode ? '2px solid var(--accent)' : '1px solid var(--border-default)',
                        background: prospectMode ? 'var(--accent)11' : 'transparent',
                        color: prospectMode ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                >
                    Analisar por CNPJ (prospect)
                </button>
            </div>

            {/* Prospect CNPJ input */}
            {prospectMode && (
                <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                            placeholder="XX.XXX.XXX/XXXX-XX"
                            value={prospectCnpjInput}
                            onChange={e => setProspectCnpjInput(applyCnpjMask(e.target.value))}
                            onKeyDown={e => { if (e.key === 'Enter') handleProspectLookup(); }}
                            style={{
                                ...inputStyle, width: 'auto', minWidth: '220px',
                                fontFamily: 'monospace', fontSize: '0.95rem', letterSpacing: '0.5px',
                            }}
                        />
                        <button
                            onClick={handleProspectLookup}
                            disabled={prospectLoading || prospectCnpjClean.length !== 14}
                            style={{
                                ...btnStyleSave,
                                opacity: (prospectLoading || prospectCnpjClean.length !== 14) ? 0.5 : 1,
                            }}
                        >
                            {prospectLoading ? 'Consultando...' : 'Consultar'}
                        </button>
                    </div>
                    {prospectError && (
                        <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '0.5rem' }}>{prospectError}</p>
                    )}

                    {/* Prospect company info card */}
                    {prospectData && (
                        <div style={{
                            ...cardStyle, marginTop: '1rem',
                            borderLeft: '4px solid var(--accent)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                <div>
                                    <h3 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', margin: 0 }}>
                                        {prospectData.razaoSocial}
                                    </h3>
                                    {prospectData.nomeFantasia && (
                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                            {prospectData.nomeFantasia}
                                        </span>
                                    )}
                                </div>
                                {prospectData.descricaoSituacaoCadastral && (() => {
                                    const sit = prospectData.descricaoSituacaoCadastral.toLowerCase();
                                    const isAtiva = sit === 'ativa' || prospectData.situacaoCadastral === '2';
                                    const badgeColor = isAtiva ? 'var(--success)' : 'var(--danger)';
                                    return (
                                        <span style={{
                                            padding: '3px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700,
                                            background: badgeColor + '22', color: badgeColor,
                                            border: `1px solid ${badgeColor}44`,
                                        }}>
                                            {prospectData.descricaoSituacaoCadastral}
                                        </span>
                                    );
                                })()}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem', fontSize: '0.85rem' }}>
                                <div>
                                    <span style={{ color: 'var(--text-muted)' }}>CNPJ: </span>
                                    <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{applyCnpjMask(prospectData.cnpj)}</span>
                                </div>
                                <div>
                                    <span style={{ color: 'var(--text-muted)' }}>CNAE: </span>
                                    <span style={{ color: 'var(--text-primary)' }}>{prospectData.cnaePrincipal.codigo} - {prospectData.cnaePrincipal.descricao}</span>
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Endereco: </span>
                                    <span style={{ color: 'var(--text-primary)' }}>
                                        {[prospectData.logradouro, prospectData.numero, prospectData.bairro, `${prospectData.municipio}/${prospectData.uf}`].filter(Boolean).join(', ')}
                                        {prospectData.cep ? ` - CEP ${prospectData.cep}` : ''}
                                    </span>
                                </div>
                                {prospectData.dataAbertura && (
                                    <div>
                                        <span style={{ color: 'var(--text-muted)' }}>Abertura: </span>
                                        <span style={{ color: 'var(--text-primary)' }}>
                                            {new Date(prospectData.dataAbertura + 'T00:00:00').toLocaleDateString('pt-BR')}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Empresa selector (only in non-prospect mode) */}
            {!prospectMode && (
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
            )}

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
            {!loading && !hasActiveSelection && (
                <p style={{ color: 'var(--text-muted)' }}>
                    {prospectMode
                        ? 'Digite um CNPJ acima e clique em "Consultar" para analisar um prospect.'
                        : 'Selecione uma empresa para visualizar a analise de compliance.'}
                </p>
            )}
            {!loading && hasActiveSelection && (
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
