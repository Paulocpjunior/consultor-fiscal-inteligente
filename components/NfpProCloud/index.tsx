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
import {
    gerarPerfilTributario,
    inferirAtividadePorCnae,
    inferirRegimePorFonte,
    regimeLabel,
    atividadeLabel,
    type TaxProfile,
    type RegimeTributario,
} from '../../services/nfpTaxRulesEngine';

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
    // Federal
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
    // Estadual
    { nome: 'GIA', sigla: 'GIA', esfera: 'estadual' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'DeSTDA', sigla: 'DeSTDA', esfera: 'estadual' as NfpEsfera, periodicidade: 'mensal' as const },
    { nome: 'SINTEGRA', sigla: 'SINTEGRA', esfera: 'estadual' as NfpEsfera, periodicidade: 'mensal' as const },
    // Municipal
    { nome: 'ISS Digital', sigla: 'ISS', esfera: 'municipal' as NfpEsfera, periodicidade: 'mensal' as const },
];

const CERTIDOES_BASE = [
    // Federal (Automático via SERPRO)
    { orgao: 'Receita Federal / PGFN', tipo: 'CND Federal', esfera: 'federal' as NfpEsfera, fonte: 'automatico' as const },
    { orgao: 'Caixa Econômica Federal', tipo: 'CRF (FGTS)', esfera: 'federal' as NfpEsfera, fonte: 'automatico' as const },
    { orgao: 'Justiça do Trabalho (TST)', tipo: 'CNDT (Trabalhista)', esfera: 'federal' as NfpEsfera, fonte: 'automatico' as const },
    // Estadual (Manual)
    { orgao: 'Sefaz Estadual (ICMS)', tipo: 'CND Estadual', esfera: 'estadual' as NfpEsfera, fonte: 'manual' as const },
    // Municipal (Manual)
    { orgao: 'Prefeitura Municipal (ISS)', tipo: 'CND Municipal', esfera: 'municipal' as NfpEsfera, fonte: 'manual' as const },
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
    opcaoSimples?: boolean | null;
    opcaoMei?: boolean | null;
    porte?: string;
    naturezaJuridica?: string;
}

const NfpProCloud: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [tab, setTab] = useState<Tab>('dashboard');
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [selectedEmpresaId, setSelectedEmpresaId] = useState<string>('');
    const [analise, setAnalise] = useState<NfpAnaliseEmpresa | null>(null);
    const [loading, setLoading] = useState(false);
    const [taxaSelic, setTaxaSelic] = useState(13.25);
    const [exportingPdf, setExportingPdf] = useState(false);

    // Análise tab state
    const [fonteAnalise, setFonteAnalise] = useState<'certificado_escritorio' | 'certificado_cliente' | 'offline'>('certificado_escritorio');
    const [analiseRealLoading, setAnaliseRealLoading] = useState(false);

    // Prospect mode state
    const [prospectMode, setProspectMode] = useState(false);
    const [prospectCnpjInput, setProspectCnpjInput] = useState('');
    const [prospectLoading, setProspectLoading] = useState(false);
    const [prospectError, setProspectError] = useState('');
    const [prospectData, setProspectData] = useState<ProspectData | null>(null);

    // Tax rules engine state
    const [taxProfile, setTaxProfile] = useState<TaxProfile | null>(null);
    const [prospectRegime, setProspectRegime] = useState<RegimeTributario>('simples_nacional');

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

    // Compute tax profile when empresa changes (non-prospect mode)
    useEffect(() => {
        if (!selectedEmpresa) { setTaxProfile(null); return; }
        // Try to get CNAE from the empresa data — look up from Simples or Lucro
        // The empresa list comes from xmlFiscalService and has fonte ('simples'|'lucro')
        const regime = inferirRegimePorFonte(selectedEmpresa.fonte);
        // CNAE is not available on EmpresaXmlOption directly; will be populated
        // from analysis or prospect. For now, create a basic profile.
        const profile = gerarPerfilTributario({ cnae: '', regime });
        setTaxProfile(profile);
    }, [selectedEmpresa]);

    // Derived helpers for prospect mode
    const prospectCnpjClean = useMemo(() => prospectCnpjInput.replace(/\D/g, ''), [prospectCnpjInput]);
    const activeEmpresaId = prospectMode && prospectData ? `prospect_${prospectData.cnpj}` : selectedEmpresaId;
    const activeCnpj = prospectMode && prospectData ? prospectData.cnpj : (selectedEmpresa?.cnpj || '');
    const activeNome = prospectMode && prospectData ? (prospectData.nomeFantasia || prospectData.razaoSocial) : (selectedEmpresa?.nome || '');
    const activeUf = prospectMode && prospectData ? (prospectData.uf || '') : (selectedEmpresa?.uf || '');
    const activeMunicipio = prospectMode && prospectData ? (prospectData.municipio || '') : (selectedEmpresa?.municipio || '');
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

    // Compute tax profile when prospect data or prospect regime changes
    useEffect(() => {
        if (!prospectMode || !prospectData) { return; }
        const cnae = prospectData.cnaePrincipal?.codigo || '';
        const desc = prospectData.cnaePrincipal?.descricao || '';
        const profile = gerarPerfilTributario({ cnae, descricaoCnae: desc, regime: prospectRegime });
        setTaxProfile(profile);
    }, [prospectMode, prospectData, prospectRegime]);

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
            const token = await auth?.currentUser?.getIdToken();
            const resp = await fetch(`/api/admin/cnpj-lookup/${cnpj}`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || `Erro ${resp.status}`);
            }
            const raw = await resp.json();

            const situacao = String(raw.situacao_cadastral ?? '');
            let descSituacao = raw.descricao_situacao_cadastral || '';
            if (!descSituacao) {
                const map: Record<string, string> = { '2': 'Ativa', '3': 'Suspensa', '4': 'Inapta', '8': 'Baixada' };
                descSituacao = map[situacao] || situacao;
            }

            const opcaoSimples = raw.opcao_simples ?? raw.opcao_pelo_simples ?? null;
            const opcaoMei = raw.opcao_mei ?? null;
            const porte = raw.porte || raw.descricao_porte || '';
            const naturezaJuridica = raw.natureza_juridica || '';

            const data: ProspectData = {
                razaoSocial: raw.razao_social || raw.nome_fantasia || '',
                nomeFantasia: raw.nome_fantasia || '',
                cnaePrincipal: {
                    codigo: raw.cnae_fiscal?.toString() || '',
                    descricao: raw.cnae_fiscal_descricao || '',
                },
                cnaesSecundarios: (raw.cnaes_secundarios || []).map((c: any) => ({
                    codigo: c.codigo?.toString() || '',
                    descricao: c.descricao || '',
                })),
                logradouro: raw.logradouro || '',
                numero: raw.numero || '',
                bairro: raw.bairro || '',
                municipio: raw.municipio || '',
                uf: raw.uf || '',
                cep: raw.cep || '',
                dataAbertura: raw.data_inicio_atividade || '',
                cnpj,
                situacaoCadastral: situacao,
                descricaoSituacaoCadastral: descSituacao,
                opcaoSimples,
                opcaoMei,
                porte,
                naturezaJuridica,
            };
            setProspectData(data);

            // Auto-infer regime from API response
            if (opcaoMei === true) {
                setProspectRegime('mei');
            } else if (opcaoSimples === true) {
                setProspectRegime('simples_nacional');
            } else {
                setProspectRegime('lucro_presumido');
            }

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

    const createEmptyAnalise = useCallback((): NfpAnaliseEmpresa => {
        // When a TaxProfile is available, use its rules-driven lists
        const certidoesSrc = taxProfile
            ? taxProfile.certidoesObrigatorias.map(c => ({
                esfera: c.esfera as NfpEsfera,
                orgao: c.orgao,
                tipo: c.tipo,
            }))
            : CERTIDOES_BASE.map(c => ({ esfera: c.esfera, orgao: c.orgao, tipo: c.tipo }));

        const obrigacoesSrc = taxProfile
            ? taxProfile.obrigacoesObrigatorias.map(o => ({
                nome: o.nome,
                sigla: o.sigla,
                esfera: o.esfera as NfpEsfera,
                periodicidade: o.periodicidade as 'mensal' | 'trimestral' | 'anual' | 'eventual',
            }))
            : OBRIGACOES_BASE.map(o => ({ nome: o.nome, sigla: o.sigla, esfera: o.esfera, periodicidade: o.periodicidade }));

        return {
            empresaId: activeEmpresaId,
            empresaNome: activeNome,
            empresaCnpj: activeCnpj,
            dataAnalise: new Date().toISOString(),
            analisadoPor: currentUser?.name || '',
            fonte: fonteAnalise,
            debitos: [],
            parcelamentos: [],
            certidoes: certidoesSrc.map(c => ({
                id: uid(),
                empresaId: activeEmpresaId,
                esfera: c.esfera,
                orgao: c.orgao,
                tipo: c.tipo,
                status: 'nao_consultada' as NfpStatusCertidao,
            })),
            obrigacoes: obrigacoesSrc.map(o => ({
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
        };
    }, [activeEmpresaId, activeNome, activeCnpj, currentUser, fonteAnalise, taxProfile]);

    // ─── Esfera Section Helpers ────────────────────────────────────────────

    const esferaIcon = (esf: NfpEsfera) => {
        if (esf === 'federal') return '\u{1F3DB}'; // classical building
        if (esf === 'estadual') return '\u{1F3E2}'; // office building
        return '\u{1F3E0}'; // house
    };

    const renderEsferaSectionHeader = (esf: NfpEsfera, sublabel?: string) => {
        const labels: Record<NfpEsfera, string> = { federal: 'Federal', estadual: 'Estadual', municipal: 'Municipal' };
        return (
            <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.5rem 0', marginTop: '0.75rem', marginBottom: '0.25rem',
                borderBottom: '1px solid var(--border-subtle)',
            }}>
                <span style={{ fontSize: '1.1rem' }}>{esferaIcon(esf)}</span>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{labels[esf]}</span>
                {sublabel && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>({sublabel})</span>
                )}
            </div>
        );
    };

    const renderFonteBadge = (tipo: 'automatico' | 'manual') => {
        const isAuto = tipo === 'automatico';
        return (
            <span style={{
                padding: '1px 8px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 600,
                background: isAuto ? 'var(--accent)18' : 'var(--text-muted)18',
                color: isAuto ? 'var(--accent)' : 'var(--text-muted)',
                border: `1px solid ${isAuto ? 'var(--accent)' : 'var(--text-muted)'}33`,
                whiteSpace: 'nowrap' as const,
            }}>
                {isAuto ? 'Automatico (SERPRO)' : 'Manual'}
            </span>
        );
    };

    // ─── Render Helpers ─────────────────────────────────────────────────────

    const renderTaxProfileCard = () => {
        if (!taxProfile) return null;

        const regimeBadgeColors: Record<RegimeTributario, string> = {
            simples_nacional: 'var(--success)',
            lucro_presumido: 'var(--accent)',
            lucro_real: '#9333ea',
            mei: 'var(--text-muted)',
        };
        const badgeColor = regimeBadgeColors[taxProfile.regime] || 'var(--text-muted)';

        return (
            <div style={{
                ...cardStyle, marginBottom: '1rem',
                borderLeft: `4px solid ${badgeColor}`,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{
                        padding: '3px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700,
                        background: badgeColor + '22', color: badgeColor,
                        border: `1px solid ${badgeColor}44`,
                    }}>
                        {regimeLabel(taxProfile.regime)}
                    </span>
                    <span style={{
                        padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600,
                        background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                        border: '1px solid var(--border-default)',
                    }}>
                        {atividadeLabel(taxProfile.atividadeTipo)}
                    </span>
                    {taxProfile.cnae && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            CNAE {taxProfile.cnae}{taxProfile.descricaoCnae ? ` - ${taxProfile.descricaoCnae}` : ''}
                        </span>
                    )}
                </div>

                {taxProfile.impostosAplicaveis.length > 0 && (
                    <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
                            Impostos Aplicaveis
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.4rem' }}>
                            {taxProfile.impostosAplicaveis.map((imp, i) => (
                                <span key={i} title={imp.aliquotaBase || ''} style={{
                                    padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 500,
                                    background: imp.esfera === 'federal' ? 'var(--accent)11' : imp.esfera === 'estadual' ? 'var(--warning)11' : 'var(--success)11',
                                    color: imp.esfera === 'federal' ? 'var(--accent)' : imp.esfera === 'estadual' ? 'var(--warning)' : 'var(--success)',
                                    border: `1px solid ${imp.esfera === 'federal' ? 'var(--accent)' : imp.esfera === 'estadual' ? 'var(--warning)' : 'var(--success)'}33`,
                                    cursor: imp.aliquotaBase ? 'help' : 'default',
                                }}>
                                    {imp.nome}{imp.aliquotaBase ? ` (${imp.aliquotaBase})` : ''}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {taxProfile.observacoes.length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                        {taxProfile.observacoes.map((obs, i) => (
                            <p key={i} style={{ margin: '2px 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {obs}
                            </p>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const exportarRelatorioPdf = useCallback(async () => {
        if (!analise) return;
        setExportingPdf(true);
        try {
            const { default: jsPDF } = await import('jspdf');
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const pageW = pdf.internal.pageSize.getWidth();   // 210
            const pageH = pdf.internal.pageSize.getHeight();  // 297
            const margin = 15;
            const contentW = pageW - margin * 2;
            let y = margin;

            const debitos = nfpService.atualizarDebitosSelic(analise.debitos, taxaSelic);
            const debitosAbertos = debitos.filter(d => d.status === 'aberto');
            const certNeg = analise.certidoes.filter(c => c.status === 'negativa').length;
            const certPos = analise.certidoes.filter(c => c.status === 'positiva').length;
            const certPEN = analise.certidoes.filter(c => c.status === 'positiva_efeitos_negativa').length;
            const obrigPend = analise.obrigacoes.filter(o => o.status === 'pendente' || o.status === 'atrasada').length;
            const acoesAtivas = analise.acoes.filter(a => a.status === 'em_andamento').length;
            const parcelAtivos = analise.parcelamentos.filter(p => p.status === 'ativo');

            // Determine traffic-light status
            type Semaforo = 'verde' | 'amarelo' | 'vermelho';
            let semaforo: Semaforo = 'verde';
            if (debitosAbertos.length > 0 || certPos > 0) {
                semaforo = 'vermelho';
            } else if (obrigPend > 0 || certPEN > 0 || acoesAtivas > 0) {
                semaforo = 'amarelo';
            }
            const semaforoColors: Record<Semaforo, [number, number, number]> = {
                verde: [34, 197, 94],
                amarelo: [245, 158, 11],
                vermelho: [239, 68, 68],
            };
            const semaforoLabels: Record<Semaforo, string> = {
                verde: 'SITUACAO REGULAR',
                amarelo: 'ATENCAO NECESSARIA',
                vermelho: 'SITUACAO CRITICA',
            };

            const fmtCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const dataHoje = new Date().toLocaleDateString('pt-BR');
            const dataAnalise = analise.dataAnalise ? new Date(analise.dataAnalise).toLocaleDateString('pt-BR') : dataHoje;

            // Helper: check page break
            const checkPage = (needed: number) => {
                if (y + needed > pageH - margin) {
                    pdf.addPage();
                    y = margin;
                }
            };

            // Helper: draw horizontal line
            const hLine = (yPos: number) => {
                pdf.setDrawColor(200, 200, 200);
                pdf.setLineWidth(0.3);
                pdf.line(margin, yPos, pageW - margin, yPos);
            };

            // Helper: section title
            const sectionTitle = (title: string) => {
                checkPage(20);
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(14);
                pdf.setTextColor(30, 30, 30);
                pdf.text(title, margin, y);
                y += 2;
                hLine(y);
                y += 8;
            };

            // Helper: draw table header row
            const tableHeader = (cols: { label: string; x: number; w: number }[]) => {
                checkPage(12);
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(8);
                pdf.setTextColor(80, 80, 80);
                pdf.setFillColor(245, 245, 245);
                pdf.rect(margin, y - 4, contentW, 8, 'F');
                cols.forEach(c => {
                    pdf.text(c.label, c.x, y, { maxWidth: c.w });
                });
                y += 6;
                hLine(y);
                y += 3;
            };

            // Helper: draw table data row (returns new y)
            const tableRow = (cols: { text: string; x: number; w: number; color?: [number, number, number] }[]) => {
                checkPage(10);
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(8);
                cols.forEach(c => {
                    if (c.color) pdf.setTextColor(c.color[0], c.color[1], c.color[2]);
                    else pdf.setTextColor(50, 50, 50);
                    pdf.text(c.text || '-', c.x, y, { maxWidth: c.w });
                });
                y += 6;
            };

            // Helper: color for status text
            const statusColor = (status: string): [number, number, number] => {
                if (['aberto', 'positiva', 'atrasada', 'inadimplente', 'alta'].includes(status)) return [239, 68, 68];
                if (['parcelado', 'pendente', 'positiva_efeitos_negativa', 'em_andamento', 'media', 'em_analise'].includes(status)) return [245, 158, 11];
                if (['quitado', 'negativa', 'entregue', 'concluida', 'ativo'].includes(status)) return [34, 197, 94];
                return [120, 120, 120];
            };

            // ===== PAGE 1: COVER =====
            // Background accent stripe
            pdf.setFillColor(30, 58, 95);
            pdf.rect(0, 0, pageW, 100, 'F');

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(24);
            pdf.setTextColor(255, 255, 255);
            pdf.text('RELATORIO DE', margin, 40);
            pdf.text('SITUACAO FISCAL', margin, 52);

            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(200, 215, 235);
            pdf.text('Preparado por SP Assessoria Contabil', margin, 68);
            pdf.text(dataHoje, margin, 76);

            // Company info below the stripe
            y = 120;
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(16);
            pdf.setTextColor(30, 30, 30);
            pdf.text(analise.empresaNome || 'Empresa', margin, y);
            y += 10;

            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(11);
            pdf.setTextColor(80, 80, 80);
            const cnpjFormatted = analise.empresaCnpj ? applyCnpjMask(analise.empresaCnpj) : '-';
            pdf.text(`CNPJ: ${cnpjFormatted}`, margin, y);
            y += 8;
            pdf.text(`Data da Analise: ${dataAnalise}`, margin, y);
            y += 8;

            if (taxProfile) {
                pdf.text(`Regime Tributario: ${regimeLabel(taxProfile.regime)}`, margin, y);
                y += 8;
                if (taxProfile.cnae) {
                    pdf.text(`CNAE: ${taxProfile.cnae}${taxProfile.descricaoCnae ? ' - ' + taxProfile.descricaoCnae : ''}`, margin, y);
                    y += 8;
                }
            }

            // Traffic light on cover
            y += 10;
            const [sr, sg, sb] = semaforoColors[semaforo];
            pdf.setFillColor(sr, sg, sb);
            pdf.roundedRect(margin, y, contentW, 20, 3, 3, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(14);
            pdf.setTextColor(255, 255, 255);
            pdf.text(semaforoLabels[semaforo], margin + contentW / 2, y + 13, { align: 'center' });

            // ===== PAGE 2: EXECUTIVE SUMMARY =====
            pdf.addPage();
            y = margin;

            sectionTitle('Resumo Executivo');

            // Traffic light badge
            pdf.setFillColor(sr, sg, sb);
            pdf.roundedRect(margin, y, 60, 10, 2, 2, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(9);
            pdf.setTextColor(255, 255, 255);
            const semaforoEmoji = semaforo === 'verde' ? 'VERDE' : semaforo === 'amarelo' ? 'AMARELO' : 'VERMELHO';
            pdf.text(`Status: ${semaforoEmoji}`, margin + 30, y + 7, { align: 'center' });
            y += 16;

            // KPI grid
            const kpis = [
                { label: 'Debitos Abertos', value: String(debitosAbertos.length), detail: fmtCurrency(debitosAbertos.reduce((s, d) => s + (d.valorAtualizado || d.valorOriginal), 0)) },
                { label: 'Certidoes Negativas', value: `${certNeg}/${analise.certidoes.length}`, detail: certPos > 0 ? `${certPos} positiva(s)` : 'Sem impedimentos' },
                { label: 'Obrigacoes Pendentes', value: String(obrigPend), detail: `de ${analise.obrigacoes.length} totais` },
                { label: 'Acoes em Andamento', value: String(acoesAtivas), detail: `de ${analise.acoes.length} totais` },
                { label: 'Parcelamentos Ativos', value: String(parcelAtivos.length), detail: fmtCurrency(parcelAtivos.reduce((s, p) => s + p.valorTotal, 0)) },
            ];

            const kpiW = contentW / 3;
            kpis.forEach((kpi, i) => {
                const col = i % 3;
                if (i > 0 && col === 0) y += 22;
                checkPage(22);
                const kx = margin + col * kpiW;
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(8);
                pdf.setTextColor(120, 120, 120);
                pdf.text(kpi.label, kx, y);
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(16);
                pdf.setTextColor(30, 30, 30);
                pdf.text(kpi.value, kx, y + 8);
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(8);
                pdf.setTextColor(100, 100, 100);
                pdf.text(kpi.detail, kx, y + 14);
            });
            y += 28;

            // Key findings
            checkPage(30);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(11);
            pdf.setTextColor(30, 30, 30);
            pdf.text('Principais Constatacoes', margin, y);
            y += 8;

            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            pdf.setTextColor(50, 50, 50);

            const findings: string[] = [];
            if (debitosAbertos.length > 0) {
                findings.push(`Existem ${debitosAbertos.length} debito(s) em aberto totalizando ${fmtCurrency(debitosAbertos.reduce((s, d) => s + (d.valorAtualizado || d.valorOriginal), 0))}.`);
            } else {
                findings.push('Nao ha debitos em aberto registrados.');
            }
            if (certPos > 0) {
                findings.push(`${certPos} certidao(oes) com status positivo (irregular) identificada(s).`);
            } else if (certNeg === analise.certidoes.length && analise.certidoes.length > 0) {
                findings.push('Todas as certidoes estao com status negativo (regular).');
            }
            if (obrigPend > 0) {
                findings.push(`${obrigPend} obrigacao(oes) acessoria(s) pendente(s) ou atrasada(s).`);
            } else {
                findings.push('Obrigacoes acessorias em dia.');
            }

            findings.forEach(f => {
                checkPage(8);
                pdf.text(`  •  ${f}`, margin, y, { maxWidth: contentW });
                y += 7;
            });

            // ===== PAGE 3: DEBITOS =====
            pdf.addPage();
            y = margin;
            sectionTitle('Debitos');

            if (debitos.length === 0) {
                pdf.setFont('helvetica', 'italic');
                pdf.setFontSize(10);
                pdf.setTextColor(120, 120, 120);
                pdf.text('Nenhum debito registrado.', margin, y);
                y += 10;
            } else {
                const dCols = [
                    { label: 'Esfera', x: margin, w: 20 },
                    { label: 'Orgao', x: margin + 22, w: 30 },
                    { label: 'Descricao', x: margin + 54, w: 45 },
                    { label: 'Valor Original', x: margin + 101, w: 28 },
                    { label: 'Valor Atualizado', x: margin + 131, w: 28 },
                    { label: 'Status', x: margin + 161, w: 20 },
                ];
                tableHeader(dCols);

                debitos.forEach(d => {
                    tableRow([
                        { text: d.esfera, x: margin, w: 20 },
                        { text: d.orgao || '-', x: margin + 22, w: 30 },
                        { text: d.descricao || '-', x: margin + 54, w: 45 },
                        { text: fmtCurrency(d.valorOriginal), x: margin + 101, w: 28 },
                        { text: fmtCurrency(d.valorAtualizado || d.valorOriginal), x: margin + 131, w: 28 },
                        { text: d.status.replace('_', ' '), x: margin + 161, w: 20, color: statusColor(d.status) },
                    ]);
                });

                // Total
                y += 2;
                hLine(y);
                y += 6;
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(9);
                pdf.setTextColor(30, 30, 30);
                const totalOriginal = debitos.reduce((s, d) => s + d.valorOriginal, 0);
                const totalAtualizado = debitos.reduce((s, d) => s + (d.valorAtualizado || d.valorOriginal), 0);
                pdf.text('TOTAL', margin, y);
                pdf.text(fmtCurrency(totalOriginal), margin + 101, y);
                pdf.text(fmtCurrency(totalAtualizado), margin + 131, y);
                y += 10;
            }

            // ===== PAGE 4: CERTIDOES =====
            pdf.addPage();
            y = margin;
            sectionTitle('Certidoes');

            if (analise.certidoes.length === 0) {
                pdf.setFont('helvetica', 'italic');
                pdf.setFontSize(10);
                pdf.setTextColor(120, 120, 120);
                pdf.text('Nenhuma certidao registrada.', margin, y);
                y += 10;
            } else {
                const cCols = [
                    { label: 'Esfera', x: margin, w: 20 },
                    { label: 'Orgao', x: margin + 22, w: 42 },
                    { label: 'Tipo', x: margin + 66, w: 38 },
                    { label: 'Status', x: margin + 106, w: 32 },
                    { label: 'Validade', x: margin + 140, w: 22 },
                    { label: 'Impedimento', x: margin + 164, w: 18 },
                ];
                tableHeader(cCols);

                analise.certidoes.forEach(c => {
                    const statusLabel = certidaoLabel(c.status);
                    tableRow([
                        { text: c.esfera, x: margin, w: 20 },
                        { text: c.orgao || '-', x: margin + 22, w: 42 },
                        { text: c.tipo || '-', x: margin + 66, w: 38 },
                        { text: statusLabel, x: margin + 106, w: 32, color: statusColor(c.status) },
                        { text: c.dataValidade ? new Date(c.dataValidade).toLocaleDateString('pt-BR') : '-', x: margin + 140, w: 22 },
                        { text: c.motivoImpedimento || '-', x: margin + 164, w: 18 },
                    ]);
                });
            }

            // ===== PAGE 5: OBRIGACOES =====
            pdf.addPage();
            y = margin;
            sectionTitle('Obrigacoes Acessorias');

            if (analise.obrigacoes.length === 0) {
                pdf.setFont('helvetica', 'italic');
                pdf.setFontSize(10);
                pdf.setTextColor(120, 120, 120);
                pdf.text('Nenhuma obrigacao registrada.', margin, y);
                y += 10;
            } else {
                const oCols = [
                    { label: 'Esfera', x: margin, w: 22 },
                    { label: 'Sigla', x: margin + 24, w: 22 },
                    { label: 'Nome', x: margin + 48, w: 48 },
                    { label: 'Status', x: margin + 98, w: 28 },
                    { label: 'Competencia', x: margin + 128, w: 26 },
                    { label: 'Entrega', x: margin + 156, w: 26 },
                ];
                tableHeader(oCols);

                analise.obrigacoes.forEach(o => {
                    tableRow([
                        { text: o.esfera, x: margin, w: 22 },
                        { text: o.sigla || '-', x: margin + 24, w: 22 },
                        { text: o.nome || '-', x: margin + 48, w: 48 },
                        { text: o.status.replace('_', ' '), x: margin + 98, w: 28, color: statusColor(o.status) },
                        { text: o.competencia || '-', x: margin + 128, w: 26 },
                        { text: o.dataEntrega ? new Date(o.dataEntrega).toLocaleDateString('pt-BR') : '-', x: margin + 156, w: 26 },
                    ]);
                });
            }

            // ===== PARCELAMENTOS (conditional page) =====
            if (analise.parcelamentos.length > 0) {
                pdf.addPage();
                y = margin;
                sectionTitle('Parcelamentos');

                const pCols = [
                    { label: 'Programa', x: margin, w: 45 },
                    { label: 'Esfera', x: margin + 47, w: 22 },
                    { label: 'Parcelas', x: margin + 71, w: 28 },
                    { label: 'Progresso', x: margin + 101, w: 28 },
                    { label: 'Valor Total', x: margin + 131, w: 28 },
                    { label: 'Status', x: margin + 161, w: 20 },
                ];
                tableHeader(pCols);

                analise.parcelamentos.forEach(p => {
                    const pct = p.parcelas > 0 ? Math.round((p.parcelasPagas / p.parcelas) * 100) : 0;
                    tableRow([
                        { text: p.programa || '-', x: margin, w: 45 },
                        { text: p.esfera, x: margin + 47, w: 22 },
                        { text: `${p.parcelasPagas}/${p.parcelas}`, x: margin + 71, w: 28 },
                        { text: `${pct}%`, x: margin + 101, w: 28 },
                        { text: fmtCurrency(p.valorTotal), x: margin + 131, w: 28 },
                        { text: p.status, x: margin + 161, w: 20, color: statusColor(p.status) },
                    ]);
                });
            }

            // ===== LAST PAGE: PLANO DE ACAO =====
            pdf.addPage();
            y = margin;
            sectionTitle('Plano de Acao');

            if (analise.planoAcao.length === 0) {
                pdf.setFont('helvetica', 'italic');
                pdf.setFontSize(10);
                pdf.setTextColor(120, 120, 120);
                pdf.text('Nenhuma acao registrada no plano.', margin, y);
                y += 10;
            } else {
                const sorted = [...analise.planoAcao].sort((a, b) => {
                    const order: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
                    return (order[a.gravidade] ?? 2) - (order[b.gravidade] ?? 2);
                });

                const aCols = [
                    { label: 'Gravidade', x: margin, w: 22 },
                    { label: 'Descricao', x: margin + 24, w: 65 },
                    { label: 'Esfera', x: margin + 91, w: 22 },
                    { label: 'Prazo', x: margin + 115, w: 24 },
                    { label: 'Responsavel', x: margin + 141, w: 24 },
                    { label: 'Status', x: margin + 167, w: 18 },
                ];
                tableHeader(aCols);

                sorted.forEach(a => {
                    tableRow([
                        { text: a.gravidade.toUpperCase(), x: margin, w: 22, color: statusColor(a.gravidade) },
                        { text: a.descricao || '-', x: margin + 24, w: 65 },
                        { text: a.esfera, x: margin + 91, w: 22 },
                        { text: a.prazo ? new Date(a.prazo).toLocaleDateString('pt-BR') : '-', x: margin + 115, w: 24 },
                        { text: a.responsavel || '-', x: margin + 141, w: 24 },
                        { text: a.status.replace('_', ' '), x: margin + 167, w: 18, color: statusColor(a.status) },
                    ]);
                });
            }

            // Footer on every page
            const totalPages = pdf.getNumberOfPages();
            for (let i = 1; i <= totalPages; i++) {
                pdf.setPage(i);
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(7);
                pdf.setTextColor(160, 160, 160);
                pdf.text(`SP Assessoria Contabil  |  ${analise.empresaNome}  |  ${dataHoje}`, margin, pageH - 8);
                pdf.text(`Pagina ${i} de ${totalPages}`, pageW - margin, pageH - 8, { align: 'right' });
            }

            // Save
            const nomeArquivo = (analise.empresaNome || 'empresa').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
            const dataArquivo = new Date().toISOString().slice(0, 10);
            pdf.save(`relatorio-fiscal-${nomeArquivo}-${dataArquivo}.pdf`);
            onShowToast?.('Relatorio fiscal exportado em PDF.');
        } catch (e) {
            console.error('Erro ao gerar PDF:', e);
            onShowToast?.('Falha ao gerar o relatorio PDF.');
        } finally {
            setExportingPdf(false);
        }
    }, [analise, taxaSelic, taxProfile, onShowToast]);

    const renderDashboard = () => {
        if (!analise) return <p style={{ color: 'var(--text-muted)' }}>Selecione uma empresa e inicie uma análise na aba "Análise".</p>;
        const debitosAbertos = analise.debitos.filter(d => d.status === 'aberto');
        const certNeg = analise.certidoes.filter(c => c.status === 'negativa').length;
        const certPos = analise.certidoes.filter(c => c.status === 'positiva').length;
        const obrigPend = analise.obrigacoes.filter(o => o.status === 'pendente' || o.status === 'atrasada').length;
        const acoesAtivas = analise.acoes.filter(a => a.status === 'em_andamento').length;
        const planoAlta = analise.planoAcao.filter(p => p.gravidade === 'alta' && p.status !== 'concluida').length;

        return (
            <div>
                {(analise as any)?._serproMock && (
                    <div style={{
                        padding: '10px 16px', marginBottom: '1rem', borderRadius: '8px',
                        background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
                        color: 'var(--warning)', fontSize: '0.85rem', fontWeight: 600,
                    }}>
                        DADOS SIMULADOS — SERPRO em modo teste (DRY_RUN). Os valores exibidos nao correspondem a situacao real da empresa.
                    </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                    <button
                        onClick={exportarRelatorioPdf}
                        disabled={exportingPdf}
                        style={{
                            ...btnStyleSave,
                            opacity: exportingPdf ? 0.6 : 1,
                            cursor: exportingPdf ? 'not-allowed' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                        }}
                    >
                        {exportingPdf ? 'Gerando PDF...' : 'Exportar Relatorio PDF'}
                    </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                    <DashCard title="Débitos Abertos" value={String(debitosAbertos.length)} sub={formatCurrency(debitosAbertos.reduce((s, d) => s + (d.valorAtualizado || d.valorOriginal), 0))} color="var(--danger)" />
                    <DashCard title="Certidões Negativas" value={`${certNeg}/${analise.certidoes.length}`} sub={certPos > 0 ? `${certPos} positiva(s)` : 'Sem impedimentos'} color={certPos > 0 ? 'var(--danger)' : 'var(--success)'} />
                    <DashCard title="Obrigações Pendentes" value={String(obrigPend)} sub={`de ${analise.obrigacoes.length} totais`} color={obrigPend > 0 ? 'var(--warning)' : 'var(--success)'} />
                    <DashCard title="Ações em Andamento" value={String(acoesAtivas)} sub={`de ${analise.acoes.length} totais`} color={acoesAtivas > 0 ? 'var(--warning)' : 'var(--success)'} />
                    <DashCard title="Plano de Ação (Alta)" value={String(planoAlta)} sub={`de ${analise.planoAcao.length} itens`} color={planoAlta > 0 ? 'var(--danger)' : 'var(--success)'} />
                    <DashCard title="Parcelamentos Ativos" value={String(analise.parcelamentos.filter(p => p.status === 'ativo').length)} sub={formatCurrency(analise.parcelamentos.filter(p => p.status === 'ativo').reduce((s, p) => s + p.valorTotal, 0))} color="var(--accent)" />
                </div>
            </div>
        );
    };

    const renderDebitos = () => {
        if (!analise) return null;
        const debitos = nfpService.atualizarDebitosSelic(analise.debitos, taxaSelic);

        const addDebito = (esfera: NfpEsfera = 'federal') => {
            const novo: NfpDebito = {
                id: uid(), empresaId: activeEmpresaId, esfera,
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

        // Determine fonte: debitos from SERPRO analysis have orgao 'Receita Federal' or 'PGFN'
        const getDebitoFonte = (d: NfpDebito): 'automatico' | 'manual' => {
            if (d.esfera === 'federal' && (d.orgao === 'Receita Federal' || d.orgao === 'PGFN')) return 'automatico';
            return 'manual';
        };

        const renderDebitoFonteBadge = (fonte: 'automatico' | 'manual') => {
            const isAuto = fonte === 'automatico';
            return (
                <span style={{
                    padding: '1px 8px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 600,
                    background: isAuto ? 'var(--accent)18' : 'var(--text-muted)18',
                    color: isAuto ? 'var(--accent)' : 'var(--text-muted)',
                    border: `1px solid ${isAuto ? 'var(--accent)' : 'var(--text-muted)'}33`,
                    whiteSpace: 'nowrap' as const,
                }}>
                    {isAuto ? 'SERPRO' : 'Manual'}
                </span>
            );
        };

        const renderDebitoCard = (d: NfpDebito) => (
            <div key={d.id} style={cardStyle}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto auto', gap: '0.5rem', alignItems: 'center' }}>
                    <input placeholder="Descricao" value={d.descricao} onChange={e => updateDebito(d.id, { descricao: e.target.value })} style={inputStyle} />
                    <select value={d.esfera} onChange={e => updateDebito(d.id, { esfera: e.target.value as NfpEsfera })} style={inputStyle}>
                        <option value="federal">Federal</option><option value="estadual">Estadual</option><option value="municipal">Municipal</option>
                    </select>
                    <select value={d.status} onChange={e => updateDebito(d.id, { status: e.target.value as NfpStatusDebito })} style={inputStyle}>
                        <option value="aberto">Aberto</option><option value="parcelado">Parcelado</option><option value="em_analise">Em analise</option><option value="quitado">Quitado</option><option value="prescrito">Prescrito</option>
                    </select>
                    {renderDebitoFonteBadge(getDebitoFonte(d))}
                    <button onClick={() => removeDebito(d.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <label style={labelSmall}>Orgao<input value={d.orgao} onChange={e => updateDebito(d.id, { orgao: e.target.value })} style={inputStyle} /></label>
                    <label style={labelSmall}>Valor Original<input type="number" value={d.valorOriginal} onChange={e => updateDebito(d.id, { valorOriginal: Number(e.target.value) })} style={inputStyle} /></label>
                    <label style={labelSmall}>Vencimento<input type="date" value={d.dataVencimento} onChange={e => updateDebito(d.id, { dataVencimento: e.target.value })} style={inputStyle} /></label>
                    <div style={labelSmall}>Valor Atualizado<div style={{ fontWeight: 700, color: 'var(--danger)', marginTop: '4px' }}>{formatCurrency(d.valorAtualizado || d.valorOriginal)}</div></div>
                </div>
            </div>
        );

        const federais = debitos.filter(d => d.esfera === 'federal');
        const estaduais = debitos.filter(d => d.esfera === 'estadual');
        const municipais = debitos.filter(d => d.esfera === 'municipal');

        return (
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        Taxa Selic (% a.a.):
                        <input type="number" value={taxaSelic} onChange={e => setTaxaSelic(Number(e.target.value))} step="0.01"
                            style={{ marginLeft: '0.5rem', width: '80px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-default)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
                    </label>
                    <button onClick={() => addDebito('federal')} style={btnStyle}>+ Adicionar Debito</button>
                    <button onClick={() => { updateAnalise({ debitos: analise.debitos }); saveAnalise({ ...analise, debitos: analise.debitos }); }} style={btnStyleSave}>Salvar</button>
                </div>
                {debitos.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhum debito registrado.</p>}

                {federais.length > 0 && (
                    <>
                        {renderEsferaSectionHeader('federal')}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.5rem' }}>
                            {federais.map(renderDebitoCard)}
                        </div>
                    </>
                )}

                {estaduais.length > 0 && (
                    <>
                        {renderEsferaSectionHeader('estadual', activeUf || undefined)}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.5rem' }}>
                            {estaduais.map(renderDebitoCard)}
                        </div>
                    </>
                )}

                {municipais.length > 0 && (
                    <>
                        {renderEsferaSectionHeader('municipal', activeMunicipio || undefined)}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.5rem' }}>
                            {municipais.map(renderDebitoCard)}
                        </div>
                    </>
                )}
            </div>
        );
    };

    const renderObrigacoes = () => {
        if (!analise) return null;

        const updateObrigacao = (id: string, patch: Partial<NfpObrigacao>) => {
            updateAnalise({ obrigacoes: analise.obrigacoes.map(o => o.id === id ? { ...o, ...patch } : o) });
        };

        const removeObrigacao = (id: string) => {
            updateAnalise({ obrigacoes: analise.obrigacoes.filter(o => o.id !== id) });
        };

        const addObrigacao = () => {
            const nova: NfpObrigacao = {
                id: uid(), empresaId: activeEmpresaId, nome: '', sigla: '',
                esfera: 'federal', periodicidade: 'mensal', status: 'nao_verificada',
            };
            updateAnalise({ obrigacoes: [...analise.obrigacoes, nova] });
        };

        const isCustomObrigacao = (o: NfpObrigacao): boolean => {
            return !OBRIGACOES_BASE.some(b => b.sigla === o.sigla && b.esfera === o.esfera);
        };

        const statusBadge = (s: NfpStatusObrigacao) => {
            const colors: Record<NfpStatusObrigacao, string> = {
                entregue: 'var(--success)', pendente: 'var(--warning)', atrasada: 'var(--danger)', dispensada: 'var(--text-muted)', nao_verificada: 'var(--border-default)',
            };
            return <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: colors[s] + '22', color: colors[s], border: `1px solid ${colors[s]}44` }}>{s.replace('_', ' ')}</span>;
        };

        const renderObrigacaoCard = (o: NfpObrigacao) => {
            const custom = isCustomObrigacao(o);
            return (
                <div key={o.id} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {custom ? (
                                <>
                                    <input placeholder="Sigla" value={o.sigla} onChange={e => updateObrigacao(o.id, { sigla: e.target.value })}
                                        style={{ ...inputStyle, width: '80px', fontWeight: 700 }} />
                                    <input placeholder="Nome" value={o.nome} onChange={e => updateObrigacao(o.id, { nome: e.target.value })}
                                        style={{ ...inputStyle, width: '160px', fontSize: '0.85rem' }} />
                                </>
                            ) : (
                                <>
                                    <strong style={{ color: 'var(--text-primary)' }}>{o.sigla}</strong>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{o.nome} ({o.periodicidade})</span>
                                </>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            {statusBadge(o.status)}
                            <select value={o.status} onChange={e => updateObrigacao(o.id, { status: e.target.value as NfpStatusObrigacao })} style={{ ...inputStyle, width: 'auto', fontSize: '0.8rem' }}>
                                <option value="entregue">Entregue</option><option value="pendente">Pendente</option><option value="atrasada">Atrasada</option><option value="dispensada">Dispensada</option><option value="nao_verificada">Nao verificada</option>
                            </select>
                            {custom && (
                                <button onClick={() => removeObrigacao(o.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
                            )}
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                        <label style={labelSmall}>Competencia<input value={o.competencia || ''} onChange={e => updateObrigacao(o.id, { competencia: e.target.value })} placeholder="MM/AAAA" style={inputStyle} /></label>
                        <label style={labelSmall}>Data Entrega<input type="date" value={o.dataEntrega || ''} onChange={e => updateObrigacao(o.id, { dataEntrega: e.target.value })} style={inputStyle} /></label>
                    </div>
                </div>
            );
        };

        const federais = analise.obrigacoes.filter(o => o.esfera === 'federal');
        const estaduais = analise.obrigacoes.filter(o => o.esfera === 'estadual');
        const municipais = analise.obrigacoes.filter(o => o.esfera === 'municipal');

        return (
            <div>
                <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                    <button onClick={addObrigacao} style={btnStyle}>+ Adicionar Obrigacao</button>
                    <button onClick={() => saveAnalise(analise)} style={btnStyleSave}>Salvar</button>
                </div>

                {federais.length > 0 && (
                    <>
                        {renderEsferaSectionHeader('federal')}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            {federais.map(renderObrigacaoCard)}
                        </div>
                    </>
                )}

                {estaduais.length > 0 && (
                    <>
                        {renderEsferaSectionHeader('estadual', activeUf || undefined)}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            {estaduais.map(renderObrigacaoCard)}
                        </div>
                    </>
                )}

                {municipais.length > 0 && (
                    <>
                        {renderEsferaSectionHeader('municipal', activeMunicipio || undefined)}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            {municipais.map(renderObrigacaoCard)}
                        </div>
                    </>
                )}
            </div>
        );
    };

    const renderCertidoes = () => {
        if (!analise) return null;

        const updateCertidao = (id: string, patch: Partial<NfpCertidao>) => {
            updateAnalise({ certidoes: analise.certidoes.map(c => c.id === id ? { ...c, ...patch } : c) });
        };

        const removeCertidao = (id: string) => {
            updateAnalise({ certidoes: analise.certidoes.filter(c => c.id !== id) });
        };

        const addCertidao = () => {
            const nova: NfpCertidao = {
                id: uid(), empresaId: activeEmpresaId, esfera: 'federal',
                orgao: '', tipo: '', status: 'nao_consultada',
            };
            updateAnalise({ certidoes: [...analise.certidoes, nova] });
        };

        // Check if a certidao is from the base list (automatico for federal ones)
        const getCertidaoFonte = (c: NfpCertidao): 'automatico' | 'manual' => {
            const base = CERTIDOES_BASE.find(b => b.tipo === c.tipo && b.esfera === c.esfera);
            return base?.fonte || 'manual';
        };

        const isCustomCertidao = (c: NfpCertidao): boolean => {
            return !CERTIDOES_BASE.some(b => b.tipo === c.tipo && b.esfera === c.esfera);
        };

        const renderCertidaoCard = (c: NfpCertidao) => (
            <div key={c.id} style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {isCustomCertidao(c) ? (
                            <input placeholder="Tipo" value={c.tipo} onChange={e => updateCertidao(c.id, { tipo: e.target.value })}
                                style={{ ...inputStyle, width: 'auto', fontWeight: 700 }} />
                        ) : (
                            <strong style={{ color: 'var(--text-primary)' }}>{c.tipo}</strong>
                        )}
                        {isCustomCertidao(c) ? (
                            <input placeholder="Orgao" value={c.orgao} onChange={e => updateCertidao(c.id, { orgao: e.target.value })}
                                style={{ ...inputStyle, width: 'auto', fontSize: '0.85rem' }} />
                        ) : (
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{c.orgao}</span>
                        )}
                        {renderFonteBadge(getCertidaoFonte(c))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, background: certidaoColor(c.status) + '22', color: certidaoColor(c.status), border: `1px solid ${certidaoColor(c.status)}44` }}>
                            {certidaoLabel(c.status)}
                        </span>
                        <select value={c.status} onChange={e => updateCertidao(c.id, { status: e.target.value as NfpStatusCertidao })} style={{ ...inputStyle, width: 'auto', fontSize: '0.8rem' }}>
                            <option value="negativa">Negativa</option><option value="positiva_efeitos_negativa">Positiva c/ Efeitos Negativa</option><option value="positiva">Positiva</option><option value="indisponivel">Indisponivel</option><option value="nao_consultada">Nao consultada</option>
                        </select>
                        {isCustomCertidao(c) && (
                            <button onClick={() => removeCertidao(c.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
                        )}
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <label style={labelSmall}>Data Consulta<input type="date" value={c.dataConsulta || ''} onChange={e => updateCertidao(c.id, { dataConsulta: e.target.value })} style={inputStyle} /></label>
                    <label style={labelSmall}>Validade<input type="date" value={c.dataValidade || ''} onChange={e => updateCertidao(c.id, { dataValidade: e.target.value })} style={inputStyle} /></label>
                </div>
                {c.status === 'positiva' && (
                    <div style={{ marginTop: '0.5rem' }}>
                        <input placeholder="Motivo do impedimento" value={c.motivoImpedimento || ''} onChange={e => updateCertidao(c.id, { motivoImpedimento: e.target.value })}
                            style={{ ...inputStyle, width: '100%' }} />
                    </div>
                )}
            </div>
        );

        const federais = analise.certidoes.filter(c => c.esfera === 'federal');
        const estaduais = analise.certidoes.filter(c => c.esfera === 'estadual');
        const municipais = analise.certidoes.filter(c => c.esfera === 'municipal');

        return (
            <div>
                <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                    <button onClick={addCertidao} style={btnStyle}>+ Adicionar Certidao</button>
                    <button onClick={() => saveAnalise(analise)} style={btnStyleSave}>Salvar</button>
                </div>

                {federais.length > 0 && (
                    <>
                        {renderEsferaSectionHeader('federal')}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.5rem' }}>
                            {federais.map(renderCertidaoCard)}
                        </div>
                    </>
                )}

                {estaduais.length > 0 && (
                    <>
                        {renderEsferaSectionHeader('estadual', activeUf || undefined)}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.5rem' }}>
                            {estaduais.map(renderCertidaoCard)}
                        </div>
                    </>
                )}

                {municipais.length > 0 && (
                    <>
                        {renderEsferaSectionHeader('municipal', activeMunicipio || undefined)}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.5rem' }}>
                            {municipais.map(renderCertidaoCard)}
                        </div>
                    </>
                )}
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

            const isMock = resp.situacaoFiscal?.fonte === 'mock' || resp.certidoes?.fonte === 'mock';
            if (isMock) {
                (updated as any)._serproMock = true;
            }

            setAnalise(updated);
            if (!prospectMode) {
                await saveAnalise(updated);
            }
            onShowToast?.(isMock
                ? 'Análise concluída com DADOS SIMULADOS (SERPRO em modo teste)'
                : 'Análise real SERPRO concluída com sucesso');
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
                <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.5rem', margin: 0 }}>Consulta Situação Fiscal</h2>
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
                    {/* Tax Profile summary card for selected empresa */}
                    {selectedEmpresa && taxProfile && (
                        <div style={{ marginTop: '0.75rem' }}>{renderTaxProfileCard()}</div>
                    )}
                </div>
            )}

            {/* Prospect regime selector + Tax Profile card */}
            {prospectMode && prospectData && (
                <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Regime Tributario:</span>
                        {(['simples_nacional', 'lucro_presumido', 'lucro_real', 'mei'] as RegimeTributario[]).map(r => {
                            const colors: Record<RegimeTributario, string> = {
                                simples_nacional: 'var(--success)',
                                lucro_presumido: 'var(--accent)',
                                lucro_real: '#9333ea',
                                mei: 'var(--text-muted)',
                            };
                            const isActive = prospectRegime === r;
                            return (
                                <button
                                    key={r}
                                    onClick={() => setProspectRegime(r)}
                                    style={{
                                        padding: '4px 12px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                                        border: isActive ? `2px solid ${colors[r]}` : '1px solid var(--border-default)',
                                        background: isActive ? colors[r] + '18' : 'transparent',
                                        color: isActive ? colors[r] : 'var(--text-muted)',
                                    }}
                                >
                                    {regimeLabel(r)}
                                </button>
                            );
                        })}
                    </div>
                    {taxProfile && renderTaxProfileCard()}
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
